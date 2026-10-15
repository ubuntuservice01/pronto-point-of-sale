-- Atomic batch CSV import. Refuses partial success and foreign-tenant access.
create table if not exists pronto_private.pronto_product_imports (
 business_id uuid not null references public.pronto_businesses(id),
 branch_id uuid not null references public.pronto_branches(id),
 idempotency_key uuid not null,
 request_hash text not null,
 imported_count integer not null,
 created_at timestamptz not null default now(),
 primary key(business_id,idempotency_key)
);
revoke all on pronto_private.pronto_product_imports from public,anon,authenticated;
alter table pronto_private.pronto_product_imports enable row level security;
create or replace function pronto_private.import_products_csv(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());
 v_business uuid;v_branch uuid;v_key uuid;v_items jsonb;v_hash text;
 v_role text;v_item jsonb;v_created jsonb;v_qty numeric;v_price bigint;v_cost bigint;
 v_count integer:=0;v_previous record;v_product uuid;v_name text;v_code text;v_unit text;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>170000 then raise exception 'invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_branch:=nullif(p_data->>'branch_id','')::uuid;
 v_key:=nullif(p_data->>'idempotency_key','')::uuid;
 v_items:=p_data->'items';
 if v_business is null or v_branch is null or v_key is null or
  pg_catalog.jsonb_typeof(v_items)<>'array' or
  pg_catalog.jsonb_array_length(v_items) not between 1 and 100 then
   raise exception 'invalid_import_batch' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null or v_role not in('owner','manager','stock') then
  raise exception 'import_permission' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches where id=v_branch and business_id=v_business and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 v_hash:=pg_catalog.md5(p_data::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csv-import:'||v_business::text||':'||v_key::text,0));
 select * into v_previous from pronto_private.pronto_product_imports
  where business_id=v_business and idempotency_key=v_key;
 if found then
  if v_previous.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='22023';end if;
  return pg_catalog.jsonb_build_object('imported_count',v_previous.imported_count,'duplicate',true);
 end if;
 -- In PostgreSQL, exception in any row rolls back the complete batch.
 for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
  v_name:=btrim(v_item->>'name');
  v_code:=coalesce(v_item->>'code','');
  v_unit:=v_item->>'unit';
  v_price:=(v_item->>'price_cents')::bigint;
  v_qty:=coalesce((v_item->>'stock')::numeric,0);
  v_cost:=nullif(v_item->>'unit_cost_cents','')::bigint;
  if v_name is null or length(v_name) not between 1 and 200 or v_qty<0 or v_qty>1000000 or
   v_qty<>round(v_qty,3) or v_price is null or v_price<=0 or v_cost is not null and v_cost<0 then
    raise exception 'invalid_import_line' using errcode='22023';end if;
  v_created:=pronto_private.merchant_action('product_create',pg_catalog.jsonb_build_object(
   'business_id',v_business,'branch_id',v_branch,'name',v_name,'code',v_code,
   'category',coalesce(v_item->>'category','Geral'),
   'unit',v_unit,'price_cents',v_price,'min_stock',coalesce((v_item->>'min_stock')::numeric,0)));
  v_product:=(v_created->>'product_id')::uuid;
  if v_qty>0 then
   perform pronto_private.merchant_action('stock_receive',pg_catalog.jsonb_build_object(
    'business_id',v_business,'branch_id',v_branch,'product_id',v_product,
    'quantity',v_qty,'lot_number',nullif(v_item->>'lot_number',''),
    'expires_on',nullif(v_item->>'expires_on',''),'unit_cost_cents',v_cost));
  end if;
  v_count:=v_count+1;
 end loop;
 insert into pronto_private.pronto_product_imports(business_id,branch_id,idempotency_key,request_hash,imported_count)
  values(v_business,v_branch,v_key,v_hash,v_count);
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'stock.csv_import',
   pg_catalog.jsonb_build_object('branch_id',v_branch,'imported_count',v_count,'key',v_key));
 return pg_catalog.jsonb_build_object('imported_count',v_count,'duplicate',false);
end $$;
revoke all on function pronto_private.import_products_csv(jsonb) from public,anon,authenticated;
grant execute on function pronto_private.import_products_csv(jsonb) to authenticated;
create or replace function public.pronto_import_products_csv(p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.import_products_csv(p_data);$$;
revoke all on function public.pronto_import_products_csv(jsonb) from public,anon,authenticated;
grant execute on function public.pronto_import_products_csv(jsonb) to authenticated;
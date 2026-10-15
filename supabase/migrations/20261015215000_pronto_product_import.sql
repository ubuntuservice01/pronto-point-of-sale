-- Atomic and idempotent import of up to 100 validated product rows.
-- Does not import stock quantity; real entries require a purchase/stock receipt.
create table public.pronto_product_imports(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 branch_id uuid not null references public.pronto_branches(id),
 actor_id uuid not null references auth.users(id),
 idempotency_key uuid not null,
 request_hash text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 unique(business_id,idempotency_key)
);
alter table public.pronto_product_imports enable row level security;
revoke all on public.pronto_product_imports from public,anon,authenticated;
grant select on public.pronto_product_imports to authenticated;
create policy "pronto_product_imports_read" on public.pronto_product_imports
 for select to authenticated using(pronto_private.member_role(business_id) in('owner','manager','stock'));

create or replace function pronto_private.product_import(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;v_role text;
 v_key uuid:=(p_data->>'idempotency_key')::uuid;
 v_items jsonb:=p_data->'items';v_hash text;v_result jsonb:='[]'::jsonb;
 v_item jsonb;v_row record;v_existing record;v_count int;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or
  pg_catalog.pg_column_size(p_data)>131072 or v_business is null or v_branch is null or
  v_key is null or pg_catalog.jsonb_typeof(v_items)<>'array' or
  pg_catalog.jsonb_array_length(v_items) not between 1 and 100 then
  raise exception 'invalid_import_request' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in('owner','manager','stock') or v_role is null then
  raise exception 'stock_permission' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches
  where business_id=v_business and id=v_branch and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 v_hash:=pg_catalog.md5(v_items::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('productimport:'||v_business::text||':'||v_key::text,0));
 select id,request_hash,result into v_existing from public.pronto_product_imports
  where business_id=v_business and idempotency_key=v_key;
 if found then
  if v_existing.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='22023';end if;
  return pg_catalog.jsonb_build_object('duplicate',true,'rows',v_existing.result,
   'count',pg_catalog.jsonb_array_length(v_existing.result));
 end if;
 v_count:=0;
 for v_row in select el as item from pg_catalog.jsonb_array_elements(v_items) el loop
  if pg_catalog.jsonb_typeof(v_row.item)<>'object' then raise exception 'invalid_import_row' using errcode='22023';end if;
  v_count:=v_count+1;
  -- Scope keys are enforced *after* user fields to defeat cross-tenant payloads.
  v_item:=v_row.item||pg_catalog.jsonb_build_object('business_id',v_business,'branch_id',v_branch);
  v_result:=v_result||pg_catalog.jsonb_build_array(public.pronto_merchant_action('product_create',v_item));
 end loop;
 insert into public.pronto_product_imports(business_id,branch_id,actor_id,idempotency_key,request_hash,result)
  values(v_business,v_branch,v_actor,v_key,v_hash,v_result);
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'inventory.product_import',pg_catalog.jsonb_build_object('count',v_count,'idempotency_key',v_key));
 return pg_catalog.jsonb_build_object('duplicate',false,'count',v_count,'rows',v_result);
end $$;
revoke all on function pronto_private.product_import(jsonb) from public,anon,authenticated;
grant execute on function pronto_private.product_import(jsonb) to authenticated;
create or replace function public.pronto_product_import(p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.product_import(p_data);$$;
revoke all on function public.pronto_product_import(jsonb) from public,anon,authenticated;
grant execute on function public.pronto_product_import(jsonb) to authenticated;

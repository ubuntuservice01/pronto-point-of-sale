-- Inventory operations and read-only alerts: tenants remain isolated by authenticated
-- Supabase RPC. No direct browser UPDATE/INSERT on product, batch or stock ledger.
create or replace function pronto_private.inventory_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;v_product uuid:=(p_data->>'product_id')::uuid;
 v_role text;v_p public.pronto_products%rowtype;v_revision integer;
 v_qty numeric(16,3);v_delta numeric(16,3);v_remaining numeric(16,3);
 v_name text;v_category text;v_unit text;v_reason text;v_active boolean;
 v_price bigint;v_min numeric(16,3);v_batch uuid;v_lot record;v_take numeric(16,3);
 v_expiry date;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
   or pg_catalog.pg_column_size(p_data)>16384 or v_business is null or v_branch is null
   or v_product is null then raise exception 'invalid_inventory_request' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in ('owner','manager','stock') or v_role is null then
  raise exception 'inventory_permission' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches b
   where b.id=v_branch and b.business_id=v_business and b.active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 select * into v_p from public.pronto_products p where p.id=v_product
  and p.business_id=v_business and p.branch_id=v_branch for update;
 if not found then raise exception 'product_unavailable' using errcode='22023';end if;
 v_revision:=(p_data->>'expected_revision')::integer;
 if v_revision is null or v_revision<>v_p.revision then
  raise exception 'product_revision_conflict' using errcode='22023';end if;
 if p_action='product_update' then
  if v_role not in('owner','manager') then raise exception 'price_permission' using errcode='42501';end if;
  v_name:=pg_catalog.btrim(p_data->>'name');
  v_category:=coalesce(nullif(pg_catalog.btrim(p_data->>'category'),''),'Geral');
  v_unit:=p_data->>'unit';v_price:=(p_data->>'price_cents')::bigint;
  v_min:=(p_data->>'min_stock')::numeric;
  v_active:=coalesce((p_data->>'active')::boolean,v_p.active);
  if v_name is null or length(v_name) not between 2 and 200 or
   length(v_category)>100 or v_unit not in('un','m','m²','kg','g','l','ml','caixa','pacote','saco','rolo','par','conjunto')
   or v_price is null or v_price<=0 or v_price>999999999999 or
   v_min is null or v_min<0 or v_min>1000000 then
   raise exception 'invalid_product_update' using errcode='22023';end if;
  if v_unit<>v_p.unit and (v_p.stock<>0 or exists(
   select 1 from public.pronto_sale_items si where si.business_id=v_business and si.product_id=v_product
  )) then raise exception 'unit_change_with_history' using errcode='22023';end if;
  update public.pronto_products set name=v_name,category=v_category,unit=v_unit,
   price_cents=v_price,min_stock=v_min,active=v_active,revision=revision+1
   where id=v_product;
  v_delta:=0;
 elsif p_action in('inventory_adjust','inventory_count') then
  v_reason:=pg_catalog.btrim(p_data->>'reason');
  if v_reason is null or length(v_reason) not between 3 and 180 then
   raise exception 'inventory_reason_required' using errcode='22023';end if;
  if p_action='inventory_count' then
   v_qty:=(p_data->>'counted_qty')::numeric;
   if v_qty is null or v_qty<0 or v_qty>1000000 or v_qty<>pg_catalog.round(v_qty,3) then
    raise exception 'invalid_inventory_count' using errcode='22023';end if;
   v_delta:=v_qty-v_p.stock;
  else
   v_delta:=(p_data->>'delta')::numeric;
  end if;
  if v_delta is null or abs(v_delta)>1000000 or v_delta<>pg_catalog.round(v_delta,3) or
   (v_p.unit in('un','caixa','pacote','saco','rolo','par','conjunto') and v_delta<>pg_catalog.trunc(v_delta)) or
   v_p.stock+v_delta<0 then raise exception 'invalid_inventory_adjustment' using errcode='22023';end if;
  if v_delta>0 then
   v_expiry:=nullif(p_data->>'expires_on','')::date;
   insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty)
    values(v_business,v_product,'AJ-'+left(pg_catalog.gen_random_uuid()::text,8),v_expiry,v_delta)
    returning id into v_batch;
   insert into public.pronto_stock_movements(business_id,product_id,batch_id,actor_id,kind,qty_delta,reason)
    values(v_business,v_product,v_batch,v_actor,'adjust',v_delta,v_reason);
  elsif v_delta<0 then
   v_remaining:=-v_delta;
   -- Consume oldest/expired batches first for physical loss, never create a negative lot.
   for v_lot in select id,qty from public.pronto_batches
     where business_id=v_business and product_id=v_product and qty>0
     order by expires_on asc nulls last,received_at,id for update loop
    exit when v_remaining<=0;
    v_take:=least(v_lot.qty,v_remaining);
    update public.pronto_batches set qty=qty-v_take where id=v_lot.id;
    insert into public.pronto_stock_movements(business_id,product_id,batch_id,actor_id,kind,qty_delta,reason)
      values(v_business,v_product,v_lot.id,v_actor,'adjust',-v_take,v_reason);
    v_remaining:=v_remaining-v_take;
   end loop;
   if v_remaining>0 then raise exception 'inventory_lots_insufficient' using errcode='22023';end if;
  end if;
  update public.pronto_products set stock=stock+v_delta,revision=revision+1 where id=v_product;
 else raise exception 'unknown_inventory_action' using errcode='22023';end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'inventory.'||p_action,
   pg_catalog.jsonb_build_object('product_id',v_product,'delta',v_delta,
    'previous_revision',v_revision,'reason',v_reason));
 return pg_catalog.jsonb_build_object('product_id',v_product,'previous_revision',v_revision,
   'revision',v_revision+1,'stock',v_p.stock+v_delta,'delta',v_delta);
end $$;
revoke all on function pronto_private.inventory_action(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.inventory_action(text,jsonb) to authenticated;
create or replace function public.pronto_inventory_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.inventory_action(p_action,p_data);$$;
revoke all on function public.pronto_inventory_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_inventory_action(text,jsonb) to authenticated;

create or replace function pronto_private.inventory_snapshot(p_business uuid,p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text;v_today date:=(now() at time zone 'Africa/Maputo')::date;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role not in ('owner','manager','stock','finance') or v_role is null then
  raise exception 'inventory_permission' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches
  where business_id=p_business and id=p_branch and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 return pg_catalog.jsonb_build_object(
  'today',v_today,'generated_at',now(),
  'products',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id,'name',p.name,'code',p.code,'unit',p.unit,'category',p.category,
    'price_cents',p.price_cents,'stock',p.stock,'min_stock',p.min_stock,
    'revision',p.revision,'active',p.active,'photo_path',p.photo_path)
    order by lower(p.name),p.id)
   from (select * from public.pronto_products where business_id=p_business
    and branch_id=p_branch order by lower(name),id limit 2000) p),'[]'::jsonb),
  'batches',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',b.id,'product_id',b.product_id,'lot_number',b.lot_number,
    'expires_on',b.expires_on,'qty',b.qty,'unit_cost_cents',b.unit_cost_cents)
    order by b.expires_on nulls last)
   from (select ba.* from public.pronto_batches ba
    join public.pronto_products p on p.id=ba.product_id and p.business_id=ba.business_id
    where ba.business_id=p_business and p.branch_id=p_branch and ba.qty>0
    order by ba.expires_on asc nulls last limit 2000) b),'[]'::jsonb),
  'movements',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',m.id,'product_id',m.product_id,'kind',m.kind,'qty_delta',m.qty_delta,
    'reason',m.reason,'created_at',m.created_at)
    order by m.created_at desc)
   from (select m.* from public.pronto_stock_movements m
    join public.pronto_products p on p.id=m.product_id and p.business_id=m.business_id
    where m.business_id=p_business and p.branch_id=p_branch
    order by m.created_at desc limit 300) m),'[]'::jsonb),
  'suggestions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'product_id',x.id,'name',x.name,'available_qty',x.available_qty,
    'min_stock',x.min_stock,'sold_last_30_days',x.sold30,
    'suggested_qty',greatest(0,pg_catalog.ceil(greatest(x.min_stock,x.sold30*14.0/30.0)-x.available_qty)),
    'low_stock',x.available_qty<=x.min_stock)
    order by x.name)
   from (select p.id,p.name,p.min_stock,
    coalesce((select sum(b.qty) from public.pronto_batches b where b.business_id=p_business
      and b.product_id=p.id and (b.expires_on is null or b.expires_on>v_today)),0) available_qty,
    coalesce((select sum(i.qty) from public.pronto_sale_items i
      join public.pronto_sales s on s.id=i.sale_id and s.business_id=i.business_id
      where i.business_id=p_business and i.product_id=p.id
       and s.branch_id=p_branch and s.created_at>=now()-interval '30 days'
       and s.status in('completed','refunded')),0) sold30
    from public.pronto_products p where p.business_id=p_business
      and p.branch_id=p_branch and p.active order by p.name limit 1000) x),'[]'::jsonb)
 );
end $$;
revoke all on function pronto_private.inventory_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function pronto_private.inventory_snapshot(uuid,uuid) to authenticated;
create or replace function public.pronto_inventory_snapshot(p_business uuid,p_branch uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.inventory_snapshot(p_business,p_branch);$$;
revoke all on function public.pronto_inventory_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pronto_inventory_snapshot(uuid,uuid) to authenticated;

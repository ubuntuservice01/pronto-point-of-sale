-- Retry-safe general cash-in/cash-out, without changing existing ledger rows.
alter table public.pronto_cash_movements
 add column if not exists idempotency_key uuid,
 add column if not exists request_hash text;
create unique index if not exists pronto_cash_movements_unique_request
 on public.pronto_cash_movements(business_id,idempotency_key)
 where idempotency_key is not null;

create or replace function pronto_private.hold_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;v_role text;v_cart jsonb;v_customer uuid;
 v_key uuid;v_item record;v_product uuid;v_qty numeric(16,3);v_seen uuid[]:='{}'::uuid[];
 v_count int;v_current record;v_amount bigint;v_direction text;v_reason text;v_cash uuid;v_movement uuid;
 v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or
  pg_catalog.pg_column_size(p_data)>32768 or v_business is null or v_branch is null then
  raise exception 'invalid_request' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in('owner','manager','cashier') or v_role is null then
  raise exception 'cashier_permission_required' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches where id=v_branch and business_id=v_business and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 if p_action='hold_save' then
  v_key:=(p_data->>'hold_id')::uuid;v_cart:=p_data->'cart';
  v_customer:=nullif(p_data->>'customer_id','')::uuid;
  if v_key is null or pg_catalog.jsonb_typeof(v_cart)<>'array' or
   pg_catalog.jsonb_array_length(v_cart) not between 1 and 100 then
   raise exception 'invalid_held_cart' using errcode='22023';end if;
  if v_customer is not null and not exists(select 1 from public.pronto_customers c
   where c.id=v_customer and c.business_id=v_business and c.active) then
   raise exception 'customer_unavailable' using errcode='22023';end if;
  for v_item in select el as item from pg_catalog.jsonb_array_elements(v_cart) el loop
   v_product:=(v_item.item->>'productId')::uuid;v_qty:=(v_item.item->>'quantity')::numeric;
   if v_product is null or v_product=any(v_seen) or v_qty is null or v_qty<=0
    or v_qty>1000000 or v_qty<>round(v_qty,3) or not exists(
      select 1 from public.pronto_products p where p.id=v_product
        and p.business_id=v_business and p.branch_id=v_branch and p.active)
    then raise exception 'invalid_held_cart_item' using errcode='22023';end if;
   v_seen:=pg_catalog.array_append(v_seen,v_product);
  end loop;
  select id,operator_id into v_current from public.pronto_held_sales
   where id=v_key and business_id=v_business and branch_id=v_branch for update;
  if found then
   if v_current.operator_id<>v_actor and v_role not in('owner','manager') then
    raise exception 'held_cart_access_denied' using errcode='42501';end if;
   update public.pronto_held_sales set cart=v_cart,customer_id=v_customer,
    payment_draft='{}'::jsonb where id=v_key;
  else
   select count(*) into v_count from public.pronto_held_sales
    where business_id=v_business and branch_id=v_branch;
   if v_count>=50 then raise exception 'held_cart_limit' using errcode='22023';end if;
   insert into public.pronto_held_sales(id,business_id,branch_id,operator_id,cart,customer_id,payment_draft)
    values(v_key,v_business,v_branch,v_actor,v_cart,v_customer,'{}'::jsonb);
  end if;
  v_result:=pg_catalog.jsonb_build_object('hold_id',v_key,'saved',true,'stock_reserved',false);
 elsif p_action='hold_delete' then
  v_key:=(p_data->>'hold_id')::uuid;
  delete from public.pronto_held_sales h where h.id=v_key and h.business_id=v_business
    and h.branch_id=v_branch and (h.operator_id=v_actor or v_role in('owner','manager'));
  if not found then raise exception 'held_cart_not_found' using errcode='22023';end if;
  v_result:=pg_catalog.jsonb_build_object('hold_id',v_key,'deleted',true);
 elsif p_action='cash_move' then
  v_key:=(p_data->>'idempotency_key')::uuid;
  if v_key is null then raise exception 'cash_movement_key_required' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cashmove:'||v_business::text||':'||v_key::text,0));
  select id,request_hash into v_current from public.pronto_cash_movements
   where business_id=v_business and idempotency_key=v_key;
  if found then
   if v_current.request_hash<>pg_catalog.md5(p_data::text) then raise exception 'idempotency_conflict' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('movement_id',v_current.id,'duplicate',true);
  end if;
  v_cash:=(p_data->>'session_id')::uuid;
  v_amount:=(p_data->>'amount_cents')::bigint;
  v_direction:=p_data->>'direction';v_reason:=pg_catalog.btrim(p_data->>'reason');
  if v_cash is null or v_amount is null or v_amount<=0 or v_amount>999999999999
    or v_direction not in('in','out') or v_reason is null or length(v_reason) not between 3 and 180 then
    raise exception 'invalid_cash_movement' using errcode='22023';end if;
  perform 1 from public.pronto_cash_sessions s where s.id=v_cash and s.business_id=v_business
    and s.branch_id=v_branch and s.operator_id=v_actor and s.status='open' for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  insert into public.pronto_cash_movements(business_id,session_id,actor_id,direction,amount_cents,reason,idempotency_key,request_hash)
   values(v_business,v_cash,v_actor,v_direction,v_amount,v_reason,v_key,pg_catalog.md5(p_data::text)) returning id into v_movement;
  v_result:=pg_catalog.jsonb_build_object('movement_id',v_movement,'direction',v_direction,'amount_cents',v_amount);
 else raise exception 'unknown_hold_action' using errcode='22023';
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'pos.'||p_action,v_result);
 return v_result;
end $$;;

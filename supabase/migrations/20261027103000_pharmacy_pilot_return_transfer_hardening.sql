-- Phase 7 pilot hardening: prohibit unsafe pharmacy restocking and in-transit
-- release of quarantined manufacturer lots across branches.
-- No user/business data changed by this migration.
CREATE OR REPLACE FUNCTION pronto_private.return_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Africa/Maputo'
AS $function$
declare
 v_actor uuid:=(select auth.uid());v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;v_role text;
 v_sale_id uuid:=(p_data->>'sale_id')::uuid;v_session uuid:=nullif(p_data->>'session_id','')::uuid;
 v_key uuid:=(p_data->>'idempotency_key')::uuid;
 v_reason text:=pg_catalog.btrim(p_data->>'reason');v_method text:=p_data->>'method';
 v_reference text:=nullif(pg_catalog.btrim(p_data->>'reference'),'');
 v_existing record;v_sale record;v_refund uuid;v_data jsonb:=p_data->'items';
 v_entry record;v_product uuid;v_unit text;v_qty numeric(16,3);
 v_seen uuid[]:='{}'::uuid[];v_sold numeric(16,3);v_refunded numeric(16,3);
 v_gross numeric:=0;v_total_gross numeric;v_partial_amount bigint;v_remaining bigint;
 v_amount bigint;v_cash_balance bigint;v_batch uuid;v_expiry date;
 v_everything boolean;v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>32768 or v_business is null or v_branch is null then
  raise exception 'invalid_request' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in('owner','manager') or v_role is null then
  raise exception 'return_permission' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches where business_id=v_business and id=v_branch and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 if p_action<>'return_confirm' or v_sale_id is null or v_key is null or
  v_reason is null or length(v_reason) not between 3 and 250 or
  v_method not in('cash','mpesa','emola','transfer') or
  (v_method<>'cash' and v_reference is null) or length(coalesce(v_reference,''))>128 or
  coalesce((p_data->>'manually_confirmed')::boolean,false) is not true or
  pg_catalog.jsonb_typeof(v_data)<>'array' or
  pg_catalog.jsonb_array_length(v_data) not between 1 and 100 then
  raise exception 'invalid_return' using errcode='22023';end if;

 -- Returned medicines cannot automatically become sellable stock until a
 -- supervised pharmacy reverse-logistics process is homologated.
 if exists(select 1 from public.pronto_businesses
      where id=v_business and business_type='pharmacy') and exists(
   select 1 from pg_catalog.jsonb_array_elements(v_data) e(item)
    where coalesce((e.item->>'resellable')::boolean,false)
 ) then
  raise exception 'pharmacy_return_restock_requires_quarantine' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('return:'||v_business::text||':'||v_key::text,0));
 select id,request_hash into v_existing from public.pronto_return_headers
  where business_id=v_business and idempotency_key=v_key;
 if found then
  if v_existing.request_hash<>pg_catalog.md5(p_data::text) then raise exception 'idempotency_conflict' using errcode='22023';end if;
  return pg_catalog.jsonb_build_object('return_id',v_existing.id,'duplicate',true);
 end if;
 select * into v_sale from public.pronto_sales where business_id=v_business and branch_id=v_branch and id=v_sale_id for update;
 if not found or v_sale.status<>'completed' or v_sale.method='credit' then
  raise exception 'return_sale_unavailable' using errcode='22023';end if;
 if exists(select 1 from public.pronto_refunds where business_id=v_business and sale_id=v_sale_id) then
  raise exception 'historic_refund_exists' using errcode='22023';end if;
 -- Lock products in deterministic order to protect from simultaneous inventory writes.
 for v_entry in select distinct (el->>'product_id')::uuid id from pg_catalog.jsonb_array_elements(v_data) el order by id loop
  perform 1 from public.pronto_products where business_id=v_business and branch_id=v_branch and id=v_entry.id for update;
  if not found then raise exception 'return_product_unavailable' using errcode='22023';end if;
 end loop;
 for v_entry in select el as item from pg_catalog.jsonb_array_elements(v_data) el loop
  v_product:=(v_entry.item->>'product_id')::uuid;
  v_qty:=(v_entry.item->>'quantity')::numeric;
  v_expiry:=nullif(v_entry.item->>'expires_on','')::date;
  if v_product is null or v_product=any(v_seen) or v_qty is null
   or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,3) or
   (coalesce((v_entry.item->>'resellable')::boolean,false) and
    v_expiry is not null and v_expiry<=current_date) then
   raise exception 'invalid_return_item' using errcode='22023';end if;
  v_seen:=pg_catalog.array_append(v_seen,v_product);
  select p.unit into v_unit from public.pronto_products p where p.id=v_product;
  if v_unit in('un','caixa','pacote','saco','rolo','par','conjunto') and v_qty<>trunc(v_qty) then
   raise exception 'integer_quantity_required' using errcode='22023';end if;
  select coalesce(sum(i.qty),0),coalesce(sum(i.line_total_cents),0)
   into v_sold,v_total_gross from public.pronto_sale_items i
   where i.business_id=v_business and i.sale_id=v_sale_id and i.product_id=v_product;
  select coalesce(sum(l.qty),0) into v_refunded from public.pronto_return_lines l
   join public.pronto_return_headers h on h.id=l.return_id and h.business_id=l.business_id
   where h.business_id=v_business and h.sale_id=v_sale_id and l.product_id=v_product;
  if v_sold=0 or v_refunded+v_qty>v_sold then raise exception 'return_over_sold' using errcode='22023';end if;
  v_gross:=v_gross+round(v_total_gross*v_qty/v_sold);
 end loop;
 select v_sale.total_cents-coalesce(sum(h.amount_cents),0) into v_remaining
  from public.pronto_return_headers h where h.business_id=v_business and h.sale_id=v_sale_id;
 -- Sales always have subtotal > 0; allocate existing discounts proportionally.
 v_partial_amount:=round(v_sale.total_cents*v_gross/v_sale.subtotal_cents)::bigint;
 v_amount:=least(v_remaining,v_partial_amount);
 if v_amount<=0 then raise exception 'return_value_exhausted' using errcode='22023';end if;
 if v_method='cash' then
  perform 1 from public.pronto_cash_sessions where business_id=v_business and branch_id=v_branch
   and id=v_session and operator_id=v_actor and status='open'
   and blocked_at is null and close_requested_at is null for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  -- Prevent a confirmed cash refund that would exceed the expected cash drawer balance.
  select s.opening_cash_cents+coalesce((
   select sum(p.amount_cents) from public.pronto_payment_allocations p
   join public.pronto_sales sa on sa.id=p.sale_id and sa.business_id=p.business_id
   where p.business_id=v_business and sa.session_id=v_session and p.method='cash'),0)+
   coalesce((select sum(dp.amount_cents) from public.pronto_debt_payments dp
    where dp.business_id=v_business and dp.session_id=v_session and dp.method='cash'),0)+
   coalesce((select sum(case when m.direction='in' then m.amount_cents else -m.amount_cents end)
    from public.pronto_cash_movements m where m.business_id=v_business and m.session_id=v_session),0)
   into v_cash_balance from public.pronto_cash_sessions s where s.id=v_session;
  if v_cash_balance<v_amount then raise exception 'cash_refund_exceeds_drawer' using errcode='22023';end if;
 end if;
 insert into public.pronto_return_headers(business_id,branch_id,sale_id,actor_id,session_id,
  amount_cents,method,reason,reference,idempotency_key,request_hash,manually_confirmed)
  values(v_business,v_branch,v_sale_id,v_actor,v_session,v_amount,v_method,v_reason,v_reference,v_key,pg_catalog.md5(p_data::text),true)
  returning id into v_refund;
 for v_entry in select el as item from pg_catalog.jsonb_array_elements(v_data) el loop
  v_product:=(v_entry.item->>'product_id')::uuid;
  v_qty:=(v_entry.item->>'quantity')::numeric;
  v_batch:=null;
  if coalesce((v_entry.item->>'resellable')::boolean,false) then
   v_expiry:=nullif(v_entry.item->>'expires_on','')::date;
   insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty)
    values(v_business,v_product,'DEV-'||left(v_refund::text,8),v_expiry,v_qty) returning id into v_batch;
   update public.pronto_products set stock=stock+v_qty,revision=revision+1 where id=v_product;
   insert into public.pronto_stock_movements(business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
    values(v_business,v_product,v_batch,v_actor,'refund',v_qty,v_refund,v_reason);
  end if;
  insert into public.pronto_return_lines(business_id,return_id,product_id,qty,resellable,batch_id)
   values(v_business,v_refund,v_product,v_qty,coalesce((v_entry.item->>'resellable')::boolean,false),v_batch);
 end loop;
 if v_method='cash' then
  insert into public.pronto_cash_movements(business_id,session_id,actor_id,direction,amount_cents,reason)
   values(v_business,v_session,v_actor,'out',v_amount,'Devolução: '||left(v_reason,120));
 end if;
 select not exists(
  select 1 from public.pronto_sale_items i where i.sale_id=v_sale_id and i.business_id=v_business
   and i.qty>(select coalesce(sum(l.qty),0) from public.pronto_return_lines l
    join public.pronto_return_headers h on h.id=l.return_id and h.business_id=l.business_id
    where h.sale_id=v_sale_id and h.business_id=v_business and l.product_id=i.product_id))
 into v_everything;
 if v_everything then update public.pronto_sales set status='refunded' where id=v_sale_id;end if;
 v_result:=pg_catalog.jsonb_build_object('return_id',v_refund,'amount_cents',v_amount,
  'fully_returned',v_everything,'duplicate',false,'external_refund_sent',false);
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'pos.return_confirm',v_result);
 return v_result;
end $function$
;
CREATE OR REPLACE FUNCTION pronto_private.transfer_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Africa/Maputo'
AS $function$
declare
 v_actor uuid:=(select auth.uid());v_business uuid;
 v_source uuid;v_target uuid;v_key uuid;v_transfer uuid;v_reason text;
 v_role text;v_items jsonb;v_hash text;v_current record;v_product record;v_batch record;
 v_line record;v_target_product record;v_item jsonb;
 v_product_id uuid;v_quantity numeric(16,3);v_remaining numeric(16,3);
 v_take numeric(16,3);v_lines int:=0;v_requested int:=0;v_source_code text;
 v_seen uuid[]:='{}'::uuid[];v_dest uuid;v_new_batch uuid;v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>32768 then
  raise exception 'invalid_transfer_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null or v_role not in('owner','manager','stock') then
  raise exception 'transfer_permission' using errcode='42501';end if;
 if p_action='send' then
  v_source:=nullif(p_data->>'source_branch_id','')::uuid;
  v_target:=nullif(p_data->>'target_branch_id','')::uuid;
  v_key:=nullif(p_data->>'idempotency_key','')::uuid;
  v_items:=p_data->'items';
  v_reason:=pg_catalog.btrim(p_data->>'reason');
  if v_source is null or v_target is null or v_source=v_target or
   v_key is null or v_reason is null or length(v_reason) not between 3 and 250 or
   pg_catalog.jsonb_typeof(v_items)<>'array' or
   pg_catalog.jsonb_array_length(v_items) not between 1 and 40 then
   raise exception 'invalid_transfer' using errcode='22023';end if;
  if (select count(*) from public.pronto_branches
   where business_id=v_business and id in(v_source,v_target) and active)<>2 then
   raise exception 'branch_unavailable' using errcode='22023';end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'pronto_transfer:'||v_business::text||':'||v_key::text,0));
  select * into v_current from public.pronto_stock_transfers
   where business_id=v_business and idempotency_key=v_key;
  if found then
   if v_current.request_hash<>v_hash then
    raise exception 'idempotency_conflict' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('transfer_id',v_current.id,
    'duplicate',true,'status',v_current.status);
  end if;
  -- Bloqueio determinístico, de modo a não inverter a ordem com vendas concorrentes.
  for v_product_id in select distinct (el->>'product_id')::uuid as id
   from pg_catalog.jsonb_array_elements(v_items) el order by id loop
   perform 1 from public.pronto_products p where p.business_id=v_business
    and p.branch_id=v_source and p.id=v_product_id and p.active for update;
   if not found then raise exception 'source_product_unavailable' using errcode='22023';end if;
  end loop;
  -- Recusar duplicações de produto, quantidades inválidas e lotes vencidos.
  for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
   v_product_id:=nullif(v_item->>'product_id','')::uuid;
   v_quantity:=nullif(v_item->>'quantity','')::numeric;
   if v_product_id is null or v_product_id=any(v_seen) or
    v_quantity is null or v_quantity<=0 or v_quantity>1000000 or
    v_quantity<>pg_catalog.round(v_quantity,3) then
    raise exception 'invalid_transfer_item' using errcode='22023';end if;
   select * into v_product from public.pronto_products
    where business_id=v_business and branch_id=v_source and id=v_product_id and active;
   if not found or (v_product.unit in('un','caixa','pacote','saco','rolo','par','conjunto')
    and v_quantity<>trunc(v_quantity)) then
    raise exception 'invalid_transfer_unit' using errcode='22023';end if;
   v_seen:=pg_catalog.array_append(v_seen,v_product_id);
  end loop;
  insert into public.pronto_stock_transfers
   (business_id,source_branch_id,target_branch_id,sent_by,reason,idempotency_key,request_hash)
   values(v_business,v_source,v_target,v_actor,v_reason,v_key,v_hash)
   returning id into v_transfer;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
   v_product_id:=(v_item->>'product_id')::uuid;
   v_quantity:=(v_item->>'quantity')::numeric;
   v_remaining:=v_quantity;
   for v_batch in select * from public.pronto_batches b
    where b.business_id=v_business and b.product_id=v_product_id
     and b.qty>0 and (b.expires_on is null or b.expires_on>(now() at time zone 'Africa/Maputo')::date)
     and not exists(select 1 from public.pronto_pharmacy_lot_holds h
      join public.pronto_batches held on held.business_id=h.business_id and held.id=h.batch_id
      join public.pronto_products held_p on held_p.business_id=held.business_id and held_p.id=held.product_id
      join public.pronto_products source_p on source_p.business_id=b.business_id and source_p.id=b.product_id
      where h.active and h.business_id=b.business_id and held_p.code=source_p.code
       and lower(btrim(held.lot_number))=lower(btrim(b.lot_number)))
    order by b.expires_on nulls last,b.received_at,b.id for update loop
    exit when v_remaining=0;
    v_take:=least(v_batch.qty,v_remaining);
    update public.pronto_batches set qty=qty-v_take where id=v_batch.id and qty>=v_take;
    if not found then raise exception 'batch_changed' using errcode='40001';end if;
    insert into public.pronto_stock_transfer_lines
     (business_id,transfer_id,source_product_id,source_batch_id,quantity,
      lot_number,expires_on,unit_cost_cents)
     values(v_business,v_transfer,v_product_id,v_batch.id,v_take,
      v_batch.lot_number,v_batch.expires_on,v_batch.unit_cost_cents);
    insert into public.pronto_stock_movements
     (business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
     values(v_business,v_product_id,v_batch.id,v_actor,'transfer',-v_take,v_transfer,
      'Expedição para filial '||v_target::text);
    v_remaining:=v_remaining-v_take;v_lines:=v_lines+1;
   end loop;
   if v_remaining<>0 then raise exception 'transfer_insufficient_valid_stock' using errcode='22023';end if;
   update public.pronto_products set stock=stock-v_quantity,revision=revision+1
    where id=v_product_id and business_id=v_business and branch_id=v_source
     and stock>=v_quantity;
   if not found then raise exception 'transfer_stock_changed' using errcode='40001';end if;
   v_requested:=v_requested+1;
  end loop;
  v_result:=pg_catalog.jsonb_build_object('transfer_id',v_transfer,
   'status','in_transit','products',v_requested,'lot_lines',v_lines,'duplicate',false);

 elsif p_action in('receive','cancel') then
  v_transfer:=nullif(p_data->>'transfer_id','')::uuid;
  if v_transfer is null then raise exception 'transfer_id_required' using errcode='22023';end if;
  select * into v_current from public.pronto_stock_transfers
   where id=v_transfer and business_id=v_business for update;
  if not found then raise exception 'transfer_not_found' using errcode='22023';end if;
  v_source:=v_current.source_branch_id;v_target:=v_current.target_branch_id;
  if v_current.status='received' and p_action='receive' then
   return pg_catalog.jsonb_build_object('transfer_id',v_transfer,'status','received','duplicate',true);
  end if;
  if v_current.status='cancelled' and p_action='cancel' then
   return pg_catalog.jsonb_build_object('transfer_id',v_transfer,'status','cancelled','duplicate',true);
  end if;
  if v_current.status<>'in_transit' then
   raise exception 'transfer_already_finalised' using errcode='22023';end if;

  if p_action='receive' then
   -- Recall after dispatch: deny receipt while any equivalent manufacturer's
   -- lot (same product code within this business) remains quarantined.
   if exists(
     select 1 from public.pronto_stock_transfer_lines li
     join public.pronto_products source_p on source_p.business_id=li.business_id and source_p.id=li.source_product_id
     join public.pronto_pharmacy_lot_holds h on h.business_id=li.business_id and h.active
     join public.pronto_batches held on held.business_id=h.business_id and held.id=h.batch_id
     join public.pronto_products held_p on held_p.business_id=held.business_id and held_p.id=held.product_id
     where li.business_id=v_business and li.transfer_id=v_transfer
      and held_p.code=source_p.code
      and lower(btrim(held.lot_number))=lower(btrim(li.lot_number))
   ) then raise exception 'pharmacy_transfer_quarantined_during_transit' using errcode='42501';end if;
   if not exists(select 1 from public.pronto_branches where business_id=v_business
    and id=v_target and active) then raise exception 'target_branch_inactive' using errcode='22023';end if;
   for v_product in
    select p.* from public.pronto_products p
     where p.id in(select distinct source_product_id
       from public.pronto_stock_transfer_lines where transfer_id=v_transfer)
     order by p.id
   loop
    select * into v_target_product from public.pronto_products
     where business_id=v_business and branch_id=v_target
       and lower(code)=lower(v_product.code) for update;
    if found then
     if not v_target_product.active or v_target_product.name<>v_product.name
      or v_target_product.unit<>v_product.unit or v_target_product.category<>v_product.category then
      raise exception 'destination_product_code_conflict' using errcode='22023';end if;
     v_dest:=v_target_product.id;
    else
     insert into public.pronto_products
      (business_id,branch_id,name,category,code,unit,price_cents,min_stock,stock)
      values(v_business,v_target,v_product.name,v_product.category,v_product.code,
       v_product.unit,v_product.price_cents,v_product.min_stock,0)
      returning id into v_dest;
    end if;
    update public.pronto_stock_transfer_lines set target_product_id=v_dest
     where transfer_id=v_transfer and source_product_id=v_product.id;
   end loop;
   for v_line in select * from public.pronto_stock_transfer_lines
    where transfer_id=v_transfer order by id loop
    insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty,unit_cost_cents)
     values(v_business,v_line.target_product_id,v_line.lot_number,
      v_line.expires_on,v_line.quantity,v_line.unit_cost_cents)
     returning id into v_new_batch;
    update public.pronto_products set stock=stock+v_line.quantity,revision=revision+1
     where id=v_line.target_product_id and business_id=v_business and branch_id=v_target;
    insert into public.pronto_stock_movements
     (business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
     values(v_business,v_line.target_product_id,v_new_batch,v_actor,'transfer',
      v_line.quantity,v_transfer,'Recepção da filial '||v_source::text);
   end loop;
   update public.pronto_stock_transfers set status='received',
    received_by=v_actor,received_at=now() where id=v_transfer;
   v_result:=pg_catalog.jsonb_build_object('transfer_id',v_transfer,
    'status','received','duplicate',false);
  else
   -- Restaurar lotes originais na filial de origem.
   for v_product_id in select distinct source_product_id
    from public.pronto_stock_transfer_lines where transfer_id=v_transfer order by source_product_id loop
    perform 1 from public.pronto_products where id=v_product_id
     and business_id=v_business and branch_id=v_source for update;
    if not found then raise exception 'source_product_missing' using errcode='22023';end if;
   end loop;
   for v_line in select * from public.pronto_stock_transfer_lines
    where transfer_id=v_transfer order by source_batch_id,id loop
    update public.pronto_batches set qty=qty+v_line.quantity where id=v_line.source_batch_id
     and business_id=v_business and product_id=v_line.source_product_id;
    if not found then raise exception 'source_batch_missing' using errcode='22023';end if;
    update public.pronto_products set stock=stock+v_line.quantity,revision=revision+1
     where id=v_line.source_product_id and business_id=v_business and branch_id=v_source;
    insert into public.pronto_stock_movements
     (business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
     values(v_business,v_line.source_product_id,v_line.source_batch_id,v_actor,
      'transfer',v_line.quantity,v_transfer,'Anulação da transferência');
   end loop;
   update public.pronto_stock_transfers set status='cancelled',
    cancelled_by=v_actor,cancelled_at=now() where id=v_transfer;
   v_result:=pg_catalog.jsonb_build_object('transfer_id',v_transfer,
    'status','cancelled','duplicate',false);
  end if;
 else raise exception 'invalid_transfer_action' using errcode='22023';end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'stock.transfer_'||p_action,v_result);
 return v_result;
end $function$
;
CREATE OR REPLACE FUNCTION pronto_private.guard_pharmacy_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date:=(now() at time zone 'Africa/Maputo')::date;
 v_sale public.pronto_sales%rowtype;
 v_review public.pronto_pharmacy_sale_reviews%rowtype;
 v_qty numeric;
begin
 if not exists(select 1 from public.pronto_businesses
   where id=new.business_id and business_type='pharmacy') then return new;end if;
 if new.kind='adjust' and new.qty_delta>0 then
  raise exception 'pharmacy_receive_stock_via_lot_only' using errcode='22023';end if;
 if new.kind='sale' then
  if exists(
    select 1 from public.pronto_pharmacy_lot_holds h
     join public.pronto_batches held on held.business_id=h.business_id and held.id=h.batch_id
     join public.pronto_products held_p on held_p.business_id=held.business_id and held_p.id=held.product_id
     join public.pronto_products sale_p on sale_p.business_id=new.business_id and sale_p.id=new.product_id
     join public.pronto_batches sold on sold.business_id=new.business_id and sold.id=new.batch_id
     where h.business_id=new.business_id and h.active and held_p.code=sale_p.code
       and lower(btrim(held.lot_number))=lower(btrim(sold.lot_number))
  ) then
   raise exception 'pharmacy_batch_on_hold' using errcode='42501';
  end if;
  if new.batch_id is null or not exists(select 1 from public.pronto_batches b
    where b.id=new.batch_id and b.business_id=new.business_id and b.product_id=new.product_id
      and b.lot_number is not null and btrim(b.lot_number)<>'' and b.expires_on>v_today) then
   raise exception 'pharmacy_sale_requires_valid_batch' using errcode='22023';end if;
  if not exists(select 1 from public.pronto_medicine_details
     where business_id=new.business_id and product_id=new.product_id) then
   raise exception 'pharmacy_medicine_ficha_required' using errcode='42501';end if;
  if exists(select 1 from public.pronto_medicine_details
     where business_id=new.business_id and product_id=new.product_id and requires_prescription) then
   select * into v_sale from public.pronto_sales
    where business_id=new.business_id and id=new.reference_id;
   if not found then raise exception 'pharmacy_sale_required' using errcode='42501';end if;
   select si.qty into v_qty from public.pronto_sale_items si
    where si.business_id=new.business_id and si.sale_id=v_sale.id
      and si.product_id=new.product_id;
   select * into v_review from public.pronto_pharmacy_sale_reviews q
    where q.business_id=new.business_id and q.branch_id=v_sale.branch_id
      and q.sale_key=v_sale.idempotency_key and q.product_id=new.product_id for update;
   if not found or v_review.quantity is distinct from v_qty or
      v_review.requested_by<>v_sale.seller_id or v_review.approved_by is null or
      v_review.approved_at is null or now()>v_review.expires_at or
      v_review.prescription_reference is null or
      (v_review.used_sale_id is not null and v_review.used_sale_id<>v_sale.id) or
      not pronto_private.pharmacy_verified(new.business_id,v_review.approved_by) then
    raise exception 'pharmacy_prescription_approval_required' using errcode='42501';end if;
   update public.pronto_pharmacy_sale_reviews set used_sale_id=v_sale.id
    where id=v_review.id and (used_sale_id is null or used_sale_id=v_sale.id);
  end if;
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION pronto_private.pharmacy_guard_lot_receipt_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists (
  select 1 from public.pronto_pharmacy_lot_holds h
  join public.pronto_batches existing on existing.business_id=h.business_id and existing.id=h.batch_id
  join public.pronto_products held_p on held_p.business_id=existing.business_id and held_p.id=existing.product_id
  join public.pronto_products next_p on next_p.business_id=new.business_id and next_p.id=new.product_id
  where h.active and h.business_id=new.business_id and held_p.code=next_p.code
    and lower(btrim(existing.lot_number))=lower(btrim(new.lot_number))
    and (tg_op='INSERT' or existing.id<>new.id)
 ) then raise exception 'pharmacy_lot_recalled_receipt_blocked' using errcode='42501';end if;
 return new;
end $function$
;

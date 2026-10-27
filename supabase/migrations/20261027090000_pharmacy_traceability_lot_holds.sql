
-- Fase 6: isolated pharmaceutical lot holds, dispensations and traceability.
-- A hold is NOT an official recall notice and does not remove a product from physical stock.
create table public.pronto_pharmacy_lot_holds(
 business_id uuid not null,
 batch_id uuid not null,
 active boolean not null default true,
 hold_reason text not null check(length(btrim(hold_reason)) between 12 and 500),
 held_by uuid not null references auth.users(id),
 held_at timestamptz not null default now(),
 released_by uuid references auth.users(id),
 released_at timestamptz,
 release_reason text check(release_reason is null or length(btrim(release_reason)) between 12 and 500),
 primary key(business_id,batch_id),
 foreign key(business_id,batch_id) references public.pronto_batches(business_id,id)
);
alter table public.pronto_pharmacy_lot_holds enable row level security;
revoke all on public.pronto_pharmacy_lot_holds from anon,authenticated;
create index pronto_pharmacy_holds_active_idx on public.pronto_pharmacy_lot_holds(business_id,batch_id) where active;
create index if not exists pronto_pharmacy_moves_date_idx
 on public.pronto_stock_movements(business_id,created_at desc) where kind='sale';

-- A held manufacturer's lot cannot be received again under a fresh batch ID
-- for that same product. The original FEFO lot remains in place, unavailable for sale.
create or replace function pronto_private.pharmacy_guard_lot_receipt_hold()
returns trigger language plpgsql security definer set search_path=''
as $f$
begin
 if exists (
  select 1 from public.pronto_pharmacy_lot_holds h
  join public.pronto_batches existing on existing.business_id=h.business_id and existing.id=h.batch_id
  where h.active and h.business_id=new.business_id and existing.product_id=new.product_id
    and lower(btrim(existing.lot_number))=lower(btrim(new.lot_number))
    and (tg_op='INSERT' or existing.id<>new.id)
 ) then raise exception 'pharmacy_lot_recalled_receipt_blocked' using errcode='42501';end if;
 return new;
end $f$;
revoke all on function pronto_private.pharmacy_guard_lot_receipt_hold() from public,anon,authenticated;
create trigger pronto_pharmacy_recalled_receipt_guard before insert or update of lot_number,product_id
 on public.pronto_batches for each row execute function pronto_private.pharmacy_guard_lot_receipt_hold();

-- A held batch cannot be dispatched via a branch transfer.
create or replace function pronto_private.pharmacy_guard_transfer_hold()
returns trigger language plpgsql security definer set search_path=''
as $f$
begin
 if exists(select 1 from public.pronto_pharmacy_lot_holds h
   where h.active and h.business_id=new.business_id and h.batch_id=new.source_batch_id) then
  raise exception 'pharmacy_lot_on_hold_transfer' using errcode='42501';end if;
 return new;
end $f$;
revoke all on function pronto_private.pharmacy_guard_transfer_hold() from public,anon,authenticated;
create trigger pronto_pharmacy_held_transfer_guard before insert or update of source_batch_id
 on public.pronto_stock_transfer_lines for each row execute function pronto_private.pharmacy_guard_transfer_hold();

-- Business owner/manager can hold or release one physical batch in their business.
-- Every status change is appended to the existing audit trail.
create or replace function pronto_private.pharmacy_lot_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare v_actor uuid:=(select auth.uid());v_business uuid;v_batch uuid;
 v_reason text;v_exists bool;v_active bool;v_product uuid;v_lot text;
 v_expiry date;v_state text;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>2048 or p_action not in('hold','release') then
  raise exception 'pharmacy_lot_invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_batch:=nullif(p_data->>'batch_id','')::uuid;
 v_reason:=btrim(coalesce(p_data->>'reason',''));
 if v_business is null or v_batch is null or length(v_reason) not between 12 and 500
  or coalesce(pronto_private.member_role(v_business),'') not in('owner','manager') or
  not exists(select 1 from public.pronto_businesses where id=v_business and business_type='pharmacy') then
  raise exception 'pharmacy_lot_permission_or_reason' using errcode='42501';end if;
 select b.product_id,b.lot_number,b.expires_on
  into v_product,v_lot,v_expiry from public.pronto_batches b
  where b.id=v_batch and b.business_id=v_business for update;
 if not found then raise exception 'pharmacy_batch_not_found' using errcode='22023';end if;
 select h.active into v_active from public.pronto_pharmacy_lot_holds h
  where h.business_id=v_business and h.batch_id=v_batch for update;
 v_exists:=found;
 if p_action='hold' then
  if v_exists and v_active then return jsonb_build_object('active',true,'duplicate',true);end if;
  insert into public.pronto_pharmacy_lot_holds(business_id,batch_id,active,hold_reason,held_by,held_at)
   values(v_business,v_batch,true,v_reason,v_actor,now())
   on conflict(business_id,batch_id) do update set active=true,
     hold_reason=excluded.hold_reason,held_by=excluded.held_by,held_at=now(),
     released_by=null,released_at=null,release_reason=null;
 else
  if not v_exists or not v_active then raise exception 'pharmacy_batch_not_held' using errcode='22023';end if;
  if v_expiry is null or v_expiry<=(now() at time zone 'Africa/Maputo')::date then
    raise exception 'pharmacy_expired_batch_cannot_release' using errcode='22023';end if;
  update public.pronto_pharmacy_lot_holds set active=false,released_by=v_actor,
    released_at=now(),release_reason=v_reason where business_id=v_business and batch_id=v_batch;
 end if;
 v_state:=case when p_action='hold' then 'quarantined' else 'released' end;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values(v_business,v_actor,'pharmacy.lot_'||p_action,
    jsonb_build_object('batch_id',v_batch,'product_id',v_product,'lot_number',v_lot,'reason',v_reason));
 return jsonb_build_object('active',p_action='hold','batch_id',v_batch,'state',v_state,'duplicate',false);
end $f$;
revoke all on function pronto_private.pharmacy_lot_action(text,jsonb) from public,anon;
grant execute on function pronto_private.pharmacy_lot_action(text,jsonb) to authenticated;
create or replace function public.pronto_pharmacy_lot_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $f$select pronto_private.pharmacy_lot_action(p_action,p_data)$f$;
revoke all on function public.pronto_pharmacy_lot_action(text,jsonb) from public,anon;
grant execute on function public.pronto_pharmacy_lot_action(text,jsonb) to authenticated;

-- Business-scoped operational snapshot. No patient name, contact or prescription reference.
-- Movement data is limited to the selected Maputo-local date range and latest 150 rows.
create or replace function pronto_private.pharmacy_trace_snapshot(
 p_business uuid,p_branch uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=''
as $f$
declare v_role text;v_today date:=(now() at time zone 'Africa/Maputo')::date;
 v_start timestamptz;v_end timestamptz;
begin
 v_role:=pronto_private.member_role(p_business);
 if (v_role is null or v_role not in('owner','manager','stock','finance')) or p_branch is null or
    p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or
    not exists(select 1 from public.pronto_businesses b
      where b.id=p_business and b.business_type='pharmacy') or
    not exists(select 1 from public.pronto_branches br
      where br.id=p_branch and br.business_id=p_business and br.active) then
  raise exception 'pharmacy_trace_scope' using errcode='42501';end if;
 v_start:=p_from::timestamp at time zone 'Africa/Maputo';
 v_end:=(p_to+1)::timestamp at time zone 'Africa/Maputo';
 return jsonb_build_object(
 'today',v_today,'from',p_from,'to',p_to,
 'totals',jsonb_build_object(
  'sale_movements',(select count(*) from public.pronto_stock_movements m
   join public.pronto_products p on p.id=m.product_id and p.business_id=m.business_id
   where m.business_id=p_business and p.branch_id=p_branch and m.kind='sale'
    and m.created_at>=v_start and m.created_at<v_end),
  'sale_quantity',(select coalesce(sum(-m.qty_delta),0) from public.pronto_stock_movements m
   join public.pronto_products p on p.id=m.product_id and p.business_id=m.business_id
   where m.business_id=p_business and p.branch_id=p_branch and m.kind='sale'
    and m.created_at>=v_start and m.created_at<v_end),
  'rx_dispensed',(select count(*) from public.pronto_pharmacy_dispensations d
   join public.pronto_sales s on s.id=d.sale_id and s.business_id=d.business_id
   where d.business_id=p_business and s.branch_id=p_branch
     and d.dispensed_at>=v_start and d.dispensed_at<v_end),
  'held_batches',(select count(*) from public.pronto_pharmacy_lot_holds h
   join public.pronto_batches b on b.business_id=h.business_id and b.id=h.batch_id
   join public.pronto_products p on p.id=b.product_id and p.business_id=b.business_id
   where h.business_id=p_business and p.branch_id=p_branch and h.active),
  'expired_batches',(select count(*) from public.pronto_batches b
   join public.pronto_products p on p.id=b.product_id and p.business_id=b.business_id
   where b.business_id=p_business and p.branch_id=p_branch
     and b.qty>0 and b.expires_on<=v_today)
 ),
 'lots',coalesce((select jsonb_agg(jsonb_build_object(
   'batch_id',z.id,'product_name',z.name,'product_code',z.code,
   'lot_number',z.lot_number,'expires_on',z.expires_on,'qty',z.qty,
   'held',z.held,'hold_reason',z.hold_reason,
   'held_at',z.held_at,'held_by',z.held_by) order by z.expires_on nulls first,z.id)
  from (select b.id,p.name,p.code,b.lot_number,b.expires_on,b.qty,
     coalesce(h.active,false) held,
     case when h.active then h.hold_reason else null end hold_reason,
     case when h.active then h.held_at else null end held_at,
     case when h.active then h.held_by else null end held_by
    from public.pronto_batches b
    join public.pronto_products p on p.id=b.product_id and p.business_id=b.business_id
    left join public.pronto_pharmacy_lot_holds h on h.business_id=b.business_id and h.batch_id=b.id
    where b.business_id=p_business and p.branch_id=p_branch and (b.qty>0 or coalesce(h.active,false))
    order by b.expires_on nulls first,b.id limit 200) z),'[]'::jsonb),
 'dispensations',coalesce((select jsonb_agg(jsonb_build_object(
   'date',z.created_at,'sale_id',z.sale_id,'product_name',z.name,
   'lot_number',z.lot_number,'expires_on',z.expires_on,
   'quantity',z.quantity,'requires_prescription',z.is_rx,'approved_by',z.approved_by)
   order by z.created_at desc)
  from (select m.created_at,m.reference_id sale_id,p.name,b.lot_number,b.expires_on,
    -m.qty_delta quantity,(d.id is not null) is_rx,d.approved_by
    from public.pronto_stock_movements m
    join public.pronto_products p on p.id=m.product_id and p.business_id=m.business_id
    left join public.pronto_batches b on b.business_id=m.business_id and b.id=m.batch_id
    left join public.pronto_pharmacy_dispensations d on d.business_id=m.business_id and d.movement_id=m.id
    where m.business_id=p_business and p.branch_id=p_branch and m.kind='sale'
     and m.created_at>=v_start and m.created_at<v_end
    order by m.created_at desc,m.id desc limit 150) z),'[]'::jsonb)
 );
end $f$;
revoke all on function pronto_private.pharmacy_trace_snapshot(uuid,uuid,date,date) from public,anon;
grant execute on function pronto_private.pharmacy_trace_snapshot(uuid,uuid,date,date) to authenticated;
create or replace function public.pronto_pharmacy_trace_snapshot(
 p_business uuid,p_branch uuid,p_from date,p_to date)
returns jsonb language sql stable security invoker set search_path=''
as $f$select pronto_private.pharmacy_trace_snapshot(p_business,p_branch,p_from,p_to)$f$;
revoke all on function public.pronto_pharmacy_trace_snapshot(uuid,uuid,date,date) from public,anon;
grant execute on function public.pronto_pharmacy_trace_snapshot(uuid,uuid,date,date) to authenticated;

-- Keep existing checkout business logic and FEFO ordering; exclude held batches.
CREATE OR REPLACE FUNCTION pronto_private.merchant_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'Africa/Maputo'
AS $function$
declare
 v_business uuid;
 v_branch uuid;
 v_actor uuid:=(select auth.uid());
 v_role text;
 v_result jsonb;
 v_product uuid;
 v_cash uuid;
 v_sale uuid;
 v_key uuid;
 v_hash text;
 v_hash_saved text;
 v_label text;
 v_code text;
 v_seq bigint;
 v_name text;
 v_category text;
 v_unit text;
 v_price bigint;
 v_min numeric(16,3);
 v_qty numeric(16,3);
 v_stock numeric(16,3);
 v_expiry date;
 v_lot text;
 v_batch_id uuid;
 v_avail numeric(16,3);
 v_take numeric(16,3);
 v_remaining numeric(16,3);
 v_current numeric(16,3);
 v_cost bigint;
 v_amount bigint;
 v_discount bigint;
 v_subtotal bigint:=0;
 v_total bigint;
 v_paid bigint:=0;
 v_cash_due bigint:=0;
 v_received bigint;
 v_expected bigint;
 v_counted bigint;
 v_difference bigint;
 v_kind text;
 v_method text;
 v_reference text;
 v_items jsonb;
 v_allocations jsonb;
 v_row record;
 v_batch record;
 v_line record;
 v_payment record;
 v_seen_products uuid[]:='{}'::uuid[];
 v_seen_methods text[]:='{}'::text[];
 v_method_count int:=0;
 v_found boolean;
 v_prev uuid;
begin
 if v_actor is null or p_action is null or p_data is null
    or pg_catalog.jsonb_typeof(p_data)<>'object'
    or pg_catalog.pg_column_size(p_data)>32768 then
  raise exception 'invalid_request' using errcode='22023';
 end if;
 v_business:=(p_data->>'business_id')::uuid;
 v_branch:=(p_data->>'branch_id')::uuid;
 if v_business is null or v_branch is null then raise exception 'missing_scope' using errcode='22023'; end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null then raise exception 'shop_access_required' using errcode='42501'; end if;
 perform 1 from public.pronto_branches
  where business_id=v_business and id=v_branch and active;
 if not found then raise exception 'branch_unavailable' using errcode='22023'; end if;

 if p_action='product_create' then
  if v_role not in ('owner','manager','stock') then raise exception 'stock_permission' using errcode='42501'; end if;
  v_name:=pg_catalog.btrim(p_data->>'name');
  v_category:=coalesce(pg_catalog.btrim(p_data->>'category'),'');
  v_unit:=p_data->>'unit';
  v_price:=(p_data->>'price_cents')::bigint;
  v_min:=coalesce((p_data->>'min_stock')::numeric,0);
  v_code:=nullif(pg_catalog.btrim(p_data->>'code'),'');
  if v_name is null or length(v_name) not between 1 and 200
   or length(v_category)>100 or v_unit not in
    ('un','m','m²','kg','g','l','ml','caixa','pacote','saco','rolo','par','conjunto')
   or v_price is null or v_price<=0 or v_price>999999999999
   or v_min<0 or v_min>100000000 or v_min<>round(v_min,3)
   or (v_unit in ('un','caixa','pacote','saco','rolo','par','conjunto') and v_min<>trunc(v_min))
   or length(coalesce(v_code,''))>80 then
   raise exception 'invalid_product' using errcode='22023';
  end if;
  if v_code is null then
   insert into public.pronto_product_code_counters(branch_id,last_number)
     values(v_branch,0) on conflict(branch_id) do nothing;
   loop
    update public.pronto_product_code_counters set last_number=last_number+1
      where branch_id=v_branch returning last_number into v_seq;
    if v_seq>999999999999 then raise exception 'product_code_limit' using errcode='22023'; end if;
    v_code:='PR-'||pg_catalog.lpad(v_seq::text,6,'0');
    exit when not exists(select 1 from public.pronto_products
     where branch_id=v_branch and lower(code)=lower(v_code));
   end loop;
  end if;
  insert into public.pronto_products(business_id,branch_id,name,category,code,unit,price_cents,min_stock,stock)
   values(v_business,v_branch,v_name,v_category,v_code,v_unit,v_price,v_min,0)
   returning id into v_product;
  v_result:=pg_catalog.jsonb_build_object('product_id',v_product,'code',v_code);

 elsif p_action='stock_receive' then
  if v_role not in ('owner','manager','stock') then raise exception 'stock_permission' using errcode='42501'; end if;
  v_product:=(p_data->>'product_id')::uuid;
  v_qty:=(p_data->>'quantity')::numeric;
  v_expiry:=nullif(p_data->>'expires_on','')::date;
  v_lot:=nullif(pg_catalog.btrim(p_data->>'lot_number'),'');
  v_cost:=nullif(p_data->>'unit_cost_cents','')::bigint;
  if v_qty is null or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,3)
    or length(coalesce(v_lot,''))>100 or (v_cost is not null and (v_cost<0 or v_cost>999999999999))
    or (v_expiry is not null and v_expiry<=current_date) then
   raise exception 'invalid_receipt' using errcode='22023';
  end if;
  select p.unit into v_unit from public.pronto_products p
   where p.id=v_product and p.business_id=v_business and p.branch_id=v_branch and p.active for update;
  if not found then raise exception 'product_unavailable' using errcode='22023'; end if;
  if v_unit in ('un','caixa','pacote','saco','rolo','par','conjunto') and v_qty<>trunc(v_qty) then
   raise exception 'integer_quantity_required' using errcode='22023'; end if;
  insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty,unit_cost_cents)
   values(v_business,v_product,v_lot,v_expiry,v_qty,v_cost) returning id into v_batch_id;
  update public.pronto_products set stock=stock+v_qty,revision=revision+1 where id=v_product;
  insert into public.pronto_stock_movements(business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id)
   values(v_business,v_product,v_batch_id,v_actor,'receive',v_qty,v_batch_id);
  v_result:=pg_catalog.jsonb_build_object('product_id',v_product,'batch_id',v_batch_id,'quantity',v_qty);

 elsif p_action='cash_open' then
  return pronto_private.cash_control('open',p_data);
 elsif p_action='cash_close' then
  return pronto_private.cash_control('close',p_data);
 elsif p_action='sale_complete' then
  if v_role not in ('owner','manager','cashier') then raise exception 'sale_permission' using errcode='42501'; end if;
  v_cash:=(p_data->>'session_id')::uuid;
  v_key:=(p_data->>'idempotency_key')::uuid;
  v_items:=p_data->'items';
  v_allocations:=p_data->'allocations';
  v_discount:=coalesce((p_data->>'discount_cents')::bigint,0);
  v_received:=coalesce((p_data->>'cash_received_cents')::bigint,0);
  if v_key is null
   or pg_catalog.jsonb_typeof(v_items)<>'array'
   or pg_catalog.jsonb_array_length(v_items) not between 1 and 100
   or pg_catalog.jsonb_typeof(v_allocations)<>'array'
   or pg_catalog.jsonb_array_length(v_allocations) not between 1 and 4
   or v_discount<0 or v_received<0 or v_received>999999999999 then
   raise exception 'invalid_sale' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(p_data::text);
  -- Idempotency works even when two browser tabs submit the same request at once.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_business::text||':'||v_key::text,0));
  select s.id,s.request_hash into v_prev,v_hash_saved from public.pronto_sales s
   where s.business_id=v_business and s.idempotency_key=v_key;
  if found then
   if v_hash_saved<>v_hash then raise exception 'idempotency_conflict' using errcode='22023'; end if;
   return pg_catalog.jsonb_build_object('sale_id',v_prev,'duplicate',true);
  end if;
  if v_cash is not null then
   select s.id into v_cash from public.pronto_cash_sessions s
    where s.id=v_cash and s.business_id=v_business and s.branch_id=v_branch
      and s.operator_id=v_actor and s.status='open'
      and s.blocked_at is null and s.close_requested_at is null for update;
   if not found then raise exception 'cash_session_unavailable' using errcode='22023'; end if;
  elsif coalesce((select opening_required from public.pronto_cash_policies
    where business_id=v_business and branch_id=v_branch),true) then
   raise exception 'cash_open_required' using errcode='42501';
  end if;
  -- Acquire product row locks in deterministic order to protect against overselling.
  for v_row in select distinct (el->>'product_id')::uuid id
   from pg_catalog.jsonb_array_elements(v_items) el order by id
  loop
   perform 1 from public.pronto_products p where p.id=v_row.id
    and p.business_id=v_business and p.branch_id=v_branch and p.active for update;
   if not found then raise exception 'product_unavailable' using errcode='22023'; end if;
  end loop;
  for v_line in select el as item from pg_catalog.jsonb_array_elements(v_items) el
  loop
   v_product:=(v_line.item->>'product_id')::uuid;
   v_qty:=(v_line.item->>'quantity')::numeric;
   if v_product=any(v_seen_products) or v_qty is null or v_qty<=0 or v_qty>1000000
    or v_qty<>round(v_qty,3) then raise exception 'invalid_sale_item' using errcode='22023'; end if;
   v_seen_products:=pg_catalog.array_append(v_seen_products,v_product);
   select p.price_cents,p.stock,p.unit into v_price,v_stock,v_unit
    from public.pronto_products p
    where p.id=v_product and p.business_id=v_business and p.branch_id=v_branch and p.active;
   if not found or v_stock<v_qty then raise exception 'insufficient_stock' using errcode='22023'; end if;
   if v_unit in ('un','caixa','pacote','saco','rolo','par','conjunto')
    and v_qty<>trunc(v_qty) then raise exception 'integer_quantity_required' using errcode='22023'; end if;
   v_subtotal:=v_subtotal+round(v_price*v_qty)::bigint;
  end loop;
  if v_discount>=v_subtotal then raise exception 'discount_exceeds_sale' using errcode='22023'; end if;
  v_total:=v_subtotal-v_discount;
  for v_payment in select el as item from pg_catalog.jsonb_array_elements(v_allocations) el
  loop
   v_method:=v_payment.item->>'method';
   v_amount:=(v_payment.item->>'amount_cents')::bigint;
   if v_method not in ('cash','mpesa','emola','transfer') or v_method is null
    or v_method=any(v_seen_methods) or v_amount is null or v_amount<=0 then
    raise exception 'invalid_payment' using errcode='22023'; end if;
   v_seen_methods:=pg_catalog.array_append(v_seen_methods,v_method);
   v_method_count:=v_method_count+1;
   v_paid:=v_paid+v_amount;
   if v_method='cash' then v_cash_due:=v_amount; end if;
  end loop;
  if v_paid<>v_total or v_cash_due>v_received then
   raise exception 'payment_mismatch' using errcode='22023'; end if;

  v_sale:=pg_catalog.gen_random_uuid();
  insert into public.pronto_sales(id,business_id,branch_id,seller_id,session_id,
   subtotal_cents,discount_cents,total_cents,method,idempotency_key,request_hash)
   values(v_sale,v_business,v_branch,v_actor,v_cash,v_subtotal,v_discount,v_total,
    case when v_method_count>1 then 'mixed' else v_seen_methods[1] end,v_key,v_hash);

  -- FEFO allocations and stock ledger are atomic with the sale.
  for v_line in select el as item from pg_catalog.jsonb_array_elements(v_items) el
  loop
   v_product:=(v_line.item->>'product_id')::uuid;
   v_qty:=(v_line.item->>'quantity')::numeric;
   select p.price_cents,p.name into v_price,v_name
    from public.pronto_products p where p.id=v_product;
   insert into public.pronto_sale_items(business_id,sale_id,product_id,qty,
    unit_price_cents,line_total_cents,snapshot_name)
    values(v_business,v_sale,v_product,v_qty,v_price,round(v_price*v_qty)::bigint,v_name);
   v_remaining:=v_qty;
   for v_batch in select b.id,b.qty from public.pronto_batches b
    where b.business_id=v_business and b.product_id=v_product
      and b.qty>0 and (b.expires_on is null or b.expires_on>current_date)
      and not exists (select 1 from public.pronto_pharmacy_lot_holds h
       where h.business_id=b.business_id and h.batch_id=b.id and h.active)
    order by b.expires_on asc nulls last,b.received_at,b.id for update
   loop
    exit when v_remaining<=0;
    v_take:=least(v_remaining,v_batch.qty);
    update public.pronto_batches set qty=qty-v_take where id=v_batch.id;
    insert into public.pronto_stock_movements(business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id)
     values(v_business,v_product,v_batch.id,v_actor,'sale',-v_take,v_sale);
    v_remaining:=v_remaining-v_take;
   end loop;
   if v_remaining>0 then raise exception 'insufficient_unexpired_lots' using errcode='22023'; end if;
   update public.pronto_products set stock=stock-v_qty,revision=revision+1
    where id=v_product and stock>=v_qty;
   if not found then raise exception 'insufficient_stock' using errcode='22023'; end if;
  end loop;
  for v_payment in select el as item from pg_catalog.jsonb_array_elements(v_allocations) el
  loop
   v_method:=v_payment.item->>'method';
   v_amount:=(v_payment.item->>'amount_cents')::bigint;
   v_reference:=nullif(pg_catalog.btrim(v_payment.item->>'reference'),'');
   if length(coalesce(v_reference,''))>128 then raise exception 'invalid_reference' using errcode='22023'; end if;
   insert into public.pronto_payment_allocations(business_id,sale_id,method,amount_cents,reference,confirmed_by)
    values(v_business,v_sale,v_method,v_amount,v_reference,v_actor);
  end loop;
  v_result:=pg_catalog.jsonb_build_object('sale_id',v_sale,'duplicate',false,
    'total_cents',v_total,'change_cents',v_received-v_cash_due);

 else
  raise exception 'unknown_shop_action' using errcode='22023';
 end if;

 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'pos.'||p_action,v_result);
 return v_result;
end $function$
;

-- Revalidate quarantine after locking the batch inside a checkout.
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
  if exists(select 1 from public.pronto_pharmacy_lot_holds h
     where h.business_id=new.business_id and h.batch_id=new.batch_id and h.active) then
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

-- Fail closed on unauthorised memberships: a NULL role must never satisfy NOT IN.
CREATE OR REPLACE FUNCTION pronto_private.pharmacy_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());
 v_business uuid;v_branch uuid;v_product uuid;v_key uuid;v_qty numeric;
 v_role text;v_reference text;v_license text;v_until date;v_user uuid;
 v_review public.pronto_pharmacy_sale_reviews%rowtype;v_updated integer;
begin
 if v_actor is null or p_action is null or p_data is null or
    pg_catalog.jsonb_typeof(p_data)<>'object' or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'pharmacy_invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 if v_business is null or not exists(select 1 from public.pronto_businesses
    where id=v_business and business_type='pharmacy') then
  raise exception 'pharmacy_required' using errcode='42501';end if;

 if p_action='professional_set' then
  if not pronto_private.is_ubuntu_super_admin() then
   raise exception 'admin_required' using errcode='42501';end if;
  v_user:=nullif(p_data->>'user_id','')::uuid;
  if v_user is null or not exists(select 1 from public.pronto_memberships
    where business_id=v_business and user_id=v_user and active) then
   raise exception 'professional_membership_required' using errcode='22023';end if;
  if pg_catalog.jsonb_typeof(p_data->'active')<>'boolean' then
   raise exception 'professional_invalid_status' using errcode='22023';end if;
  if (p_data->>'active')::boolean then
   v_license:=pg_catalog.btrim(coalesce(p_data->>'license_reference',''));
   v_until:=nullif(p_data->>'valid_until','')::date;
   if length(v_license) not between 4 and 100 or
    v_until is null or v_until<(now() at time zone 'Africa/Maputo')::date then
    raise exception 'professional_credential_required' using errcode='22023';end if;
   insert into public.pronto_pharmacy_professionals
    (business_id,user_id,license_reference,valid_until,verified_by,verified_at,active)
    values(v_business,v_user,v_license,v_until,v_actor,now(),true)
    on conflict(business_id,user_id) do update set
     license_reference=excluded.license_reference,valid_until=excluded.valid_until,
     verified_by=excluded.verified_by,verified_at=now(),active=true;
  else
   update public.pronto_pharmacy_professionals set active=false,verified_by=v_actor,verified_at=now()
    where business_id=v_business and user_id=v_user;
   if not found then raise exception 'professional_not_found' using errcode='22023';end if;
  end if;
  insert into public.pronto_audit_events(business_id,actor_id,event,payload) values
   (v_business,v_actor,'pharmacy.professional_set',jsonb_build_object('user_id',v_user,'active',(p_data->>'active')::boolean));
  return jsonb_build_object('saved',true,'user_id',v_user);
 end if;

 v_role:=pronto_private.member_role(v_business);
 if v_role is null or v_role not in ('owner','manager','cashier') then
  raise exception 'pharmacy_membership_required' using errcode='42501';end if;
 v_branch:=nullif(p_data->>'branch_id','')::uuid;
 if v_branch is null or not exists(select 1 from public.pronto_branches
    where id=v_branch and business_id=v_business and active) then
  raise exception 'pharmacy_branch_required' using errcode='42501';end if;
 v_key:=nullif(p_data->>'sale_key','')::uuid;
 v_product:=nullif(p_data->>'product_id','')::uuid;
 if v_key is null or v_product is null or not exists(
    select 1 from public.pronto_products where id=v_product and business_id=v_business
    and branch_id=v_branch and active
 ) then raise exception 'pharmacy_product_required' using errcode='22023';end if;

 if p_action='request' then
  v_qty:=nullif(p_data->>'quantity','')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,3) or
     not exists(select 1 from public.pronto_medicine_details m where
       m.business_id=v_business and m.product_id=v_product and m.requires_prescription) then
   raise exception 'pharmacy_rx_item_required' using errcode='22023';end if;
  insert into public.pronto_pharmacy_sale_reviews
   (business_id,branch_id,sale_key,product_id,quantity,requested_by)
   values(v_business,v_branch,v_key,v_product,v_qty,v_actor)
   on conflict (business_id,sale_key,product_id) do nothing;
  select * into v_review from public.pronto_pharmacy_sale_reviews
    where business_id=v_business and sale_key=v_key and product_id=v_product;
  if v_review.branch_id<>v_branch or v_review.requested_by<>v_actor
     or v_review.quantity<>v_qty or v_review.used_sale_id is not null or now()>v_review.expires_at then
   raise exception 'pharmacy_rx_request_conflict' using errcode='22023';end if;
  return jsonb_build_object('requested',true,'sale_key',v_key,'expires_at',v_review.expires_at);
 elsif p_action='approve' then
  if not pronto_private.pharmacy_verified(v_business,v_actor) then
   raise exception 'pharmacy_professional_not_verified' using errcode='42501';end if;
  v_reference:=pg_catalog.btrim(coalesce(p_data->>'prescription_reference',''));
  if length(v_reference) not between 4 and 100 or (p_data->>'checked')<>'true' then
   raise exception 'pharmacy_prescription_review_required' using errcode='22023';end if;
  select * into v_review from public.pronto_pharmacy_sale_reviews
   where business_id=v_business and branch_id=v_branch
    and sale_key=v_key and product_id=v_product for update;
  if not found or now()>v_review.expires_at or v_review.used_sale_id is not null or
    v_review.approved_by is not null then
   raise exception 'pharmacy_review_expired_or_used' using errcode='22023';end if;
  update public.pronto_pharmacy_sale_reviews set approved_by=v_actor,
    approved_at=now(),prescription_reference=v_reference where id=v_review.id;
  insert into public.pronto_audit_events(business_id,actor_id,event,payload)
   values(v_business,v_actor,'pharmacy.prescription_approved',
    jsonb_build_object('review_id',v_review.id,'sale_key',v_key,'product_id',v_product,'qty',v_review.quantity));
  return jsonb_build_object('approved',true,'sale_key',v_key);
 else raise exception 'pharmacy_unknown_action' using errcode='22023';end if;
end $function$
;

CREATE OR REPLACE FUNCTION pronto_private.pharmacy_snapshot(p_business uuid, p_branch uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=(select auth.uid());v_approved boolean;v_role text;
begin
 v_role:=pronto_private.member_role(p_business);
 if (v_role is null or v_role not in('owner','manager','cashier')) or not exists(
   select 1 from public.pronto_businesses where id=p_business and business_type='pharmacy')
   or not exists(select 1 from public.pronto_branches
     where business_id=p_business and id=p_branch and active) then
  raise exception 'pharmacy_scope' using errcode='42501';end if;
 v_approved:=pronto_private.pharmacy_verified(p_business,v_actor);
 return jsonb_build_object('can_approve',v_approved,'requests',
  coalesce((select jsonb_agg(jsonb_build_object('sale_key',q.sale_key,'product_id',q.product_id,
    'name',p.name,'quantity',q.quantity,'expires_at',q.expires_at,
    'approved',q.approved_by is not null,'used',q.used_sale_id is not null)
    order by q.requested_at desc)
    from (select * from public.pronto_pharmacy_sale_reviews
       where business_id=p_business and branch_id=p_branch
         and expires_at>now() and used_sale_id is null
       order by requested_at desc limit 70) q
    join public.pronto_products p on p.business_id=q.business_id and p.id=q.product_id),
   '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION pronto_private.medicine_upsert(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_business uuid; v_product uuid; v_ingredient text; v_strength text; v_form text; v_presentation text; v_manufacturer text; v_rx boolean;
begin
 if auth.uid() is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
    or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'medicine_invalid_request' using errcode='22023';
 end if;
 v_business:=(p_data->>'business_id')::uuid;
 v_product:=(p_data->>'product_id')::uuid;
 if v_business is null or v_product is null or coalesce(pronto_private.member_role(v_business),'') not in ('owner','manager') then
  raise exception 'medicine_forbidden' using errcode='42501';
 end if;
 if not exists(select 1 from public.pronto_businesses b
      where b.id=v_business and b.business_type='pharmacy' and b.status='active') then
  raise exception 'pharmacy_required' using errcode='42501';
 end if;
 if not exists(select 1 from public.pronto_products p
      where p.id=v_product and p.business_id=v_business) then
  raise exception 'medicine_product_missing' using errcode='22023';
 end if;
 v_ingredient:=pg_catalog.btrim(coalesce(p_data->>'active_ingredient',''));
 v_strength:=pg_catalog.btrim(coalesce(p_data->>'strength',''));
 v_form:=pg_catalog.btrim(coalesce(p_data->>'dosage_form',''));
 v_presentation:=pg_catalog.btrim(coalesce(p_data->>'presentation',''));
 v_manufacturer:=pg_catalog.btrim(coalesce(p_data->>'manufacturer',''));
 if char_length(v_ingredient) not between 2 and 200
  or char_length(v_strength) not between 1 and 80
  or char_length(v_form) not between 2 and 100
  or char_length(v_presentation) not between 2 and 120
  or char_length(v_manufacturer)>160
  or pg_catalog.jsonb_typeof(p_data->'requires_prescription') <> 'boolean' then
  raise exception 'medicine_invalid_fields' using errcode='22023';
 end if;
 v_rx:=(p_data->>'requires_prescription')::boolean;
 insert into public.pronto_medicine_details (
   business_id,product_id,active_ingredient,strength,dosage_form,presentation,manufacturer,requires_prescription
 ) values (v_business,v_product,v_ingredient,v_strength,v_form,v_presentation,v_manufacturer,v_rx)
 on conflict (business_id,product_id) do update set
   active_ingredient=excluded.active_ingredient,strength=excluded.strength,
   dosage_form=excluded.dosage_form,presentation=excluded.presentation,
   manufacturer=excluded.manufacturer,requires_prescription=excluded.requires_prescription,
   updated_at=now();
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values (v_business,(select auth.uid()),'medicine_details_saved',
    pg_catalog.jsonb_build_object('product_id',v_product,'requires_prescription',v_rx));
 return pg_catalog.jsonb_build_object('product_id',v_product,'saved',true);
end;
$function$
;

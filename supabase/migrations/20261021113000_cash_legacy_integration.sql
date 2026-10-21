-- Existing authenticated operations gain cash-policy enforcement; no data modifications.
-- merchant
CREATE OR REPLACE FUNCTION pronto_private.merchant_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

-- credit
CREATE OR REPLACE FUNCTION pronto_private.credit_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid; v_branch uuid; v_role text; v_result jsonb;
 v_today date:=(now() at time zone 'Africa/Maputo')::date;
 v_customer uuid; v_cust record; v_name text; v_phone text; v_note text;
 v_limit bigint; v_blocked boolean; v_revision int; v_reason text;
 v_cash uuid; v_key uuid; v_hash text; v_prev record; v_sale uuid; v_debt uuid;
 v_items jsonb; v_line record; v_row record; v_batch record;
 v_product uuid; v_qty numeric(16,3); v_price bigint; v_stock numeric(16,3); v_unit text; v_pname text;
 v_take numeric(16,3); v_remaining numeric(16,3); v_seen uuid[]:='{}'::uuid[];
 v_subtotal bigint:=0; v_discount bigint; v_total bigint; v_due date; v_outstanding bigint;
 v_amount bigint; v_method text; v_reference text; v_balance bigint; v_d record;
 v_expected bigint; v_counted bigint;
begin
 if v_actor is null or p_action is null or p_data is null
    or pg_catalog.jsonb_typeof(p_data)<>'object' or pg_catalog.pg_column_size(p_data)>32768 then
  raise exception 'invalid_request' using errcode='22023';
 end if;
 v_business:=(p_data->>'business_id')::uuid;
 v_branch:=(p_data->>'branch_id')::uuid;
 if v_business is null or v_branch is null then raise exception 'missing_scope' using errcode='22023'; end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null then raise exception 'shop_access_required' using errcode='42501'; end if;
 perform 1 from public.pronto_branches where business_id=v_business and id=v_branch and active;
 if not found then raise exception 'branch_unavailable' using errcode='22023'; end if;

 if p_action='customer_save' then
  if v_role not in ('owner','manager','cashier') then raise exception 'customer_permission' using errcode='42501'; end if;
  v_customer:=nullif(p_data->>'customer_id','')::uuid;
  v_name:=pg_catalog.btrim(p_data->>'name');
  v_phone:=nullif(pg_catalog.btrim(p_data->>'phone'),'');
  v_note:=nullif(pg_catalog.btrim(p_data->>'note'),'');
  if v_name is null or length(v_name) not between 1 and 200 or length(coalesce(v_phone,''))>40
   or length(coalesce(v_note,''))>500 then raise exception 'invalid_customer' using errcode='22023'; end if;
  if v_phone is not null and coalesce(pronto_private.normalize_phone(v_phone),'') !~ '^[0-9]{7,15}$' then
   raise exception 'invalid_phone' using errcode='22023'; end if;
  if v_customer is null then
   insert into public.pronto_customers(business_id,branch_id,name,phone,phone_normalized,note)
    values(v_business,v_branch,v_name,v_phone,pronto_private.normalize_phone(v_phone),v_note)
    returning id into v_customer;
  else
   update public.pronto_customers set name=v_name,phone=v_phone,
    phone_normalized=pronto_private.normalize_phone(v_phone),note=v_note,
    active=coalesce((p_data->>'active')::boolean,active),updated_at=now()
    where id=v_customer and business_id=v_business;
   if not found then raise exception 'customer_not_found' using errcode='22023'; end if;
  end if;
  v_result:=pg_catalog.jsonb_build_object('customer_id',v_customer);

 elsif p_action='credit_policy' then
  if v_role not in ('owner','manager') then raise exception 'credit_permission' using errcode='42501'; end if;
  v_customer:=(p_data->>'customer_id')::uuid;
  v_limit:=(p_data->>'credit_limit_cents')::bigint;
  v_blocked:=(p_data->>'credit_blocked')::boolean;
  v_revision:=(p_data->>'expected_revision')::int;
  v_reason:=pg_catalog.btrim(p_data->>'reason');
  if v_customer is null or v_limit is null or v_limit<0 or v_limit>999999999999 or v_blocked is null
   or v_revision is null or v_reason is null or length(v_reason) not between 3 and 250 then
   raise exception 'invalid_credit_policy' using errcode='22023'; end if;
  select * into v_cust from public.pronto_customers where id=v_customer and business_id=v_business for update;
  if not found then raise exception 'customer_not_found' using errcode='22023'; end if;
  if v_cust.credit_revision<>v_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
  update public.pronto_customers set credit_limit_cents=v_limit,credit_blocked=v_blocked,
   credit_revision=credit_revision+1,updated_at=now() where id=v_customer;
  v_result:=pg_catalog.jsonb_build_object('customer_id',v_customer,'revision',v_revision+1,'reason',v_reason,
   'before',pg_catalog.jsonb_build_object('credit_limit_cents',v_cust.credit_limit_cents,'credit_blocked',v_cust.credit_blocked),
   'after',pg_catalog.jsonb_build_object('credit_limit_cents',v_limit,'credit_blocked',v_blocked));

 elsif p_action='sale_complete' then
  -- Non-credit sale with an optional customer, linked in the SAME transaction.
  v_customer:=nullif(p_data->>'customer_id','')::uuid;
  if v_customer is not null then
   select * into v_cust from public.pronto_customers where id=v_customer and business_id=v_business and active;
   if not found then raise exception 'customer_not_found' using errcode='22023'; end if;
  end if;
  v_result:=pronto_private.merchant_action('sale_complete',p_data-'customer_id');
  if v_customer is not null then
   update public.pronto_sales set customer_id=v_customer,customer_name_snapshot=v_cust.name,customer_phone_snapshot=v_cust.phone
    where business_id=v_business and id=(v_result->>'sale_id')::uuid
      and (customer_id is null or customer_id=v_customer);
   if not found then raise exception 'idempotency_conflict' using errcode='22023'; end if;
  end if;
  return v_result; -- merchant_action already audited the sale

 elsif p_action='credit_sale' then
  if v_role not in ('owner','manager','cashier') then raise exception 'sale_permission' using errcode='42501'; end if;
  v_cash:=(p_data->>'session_id')::uuid;
  v_key:=(p_data->>'idempotency_key')::uuid;
  v_customer:=(p_data->>'customer_id')::uuid;
  v_items:=p_data->'items';
  v_discount:=coalesce((p_data->>'discount_cents')::bigint,0);
  v_due:=(p_data->>'due_on')::date;
  if v_key is null or v_customer is null or v_due is null
   or pg_catalog.jsonb_typeof(v_items)<>'array'
   or pg_catalog.jsonb_array_length(v_items) not between 1 and 100 or v_discount<0 then
   raise exception 'invalid_sale' using errcode='22023'; end if;
  if v_due<v_today or v_due>v_today+365 then raise exception 'debt_due_date' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_business::text||':'||v_key::text,0));
  select s.id,s.request_hash into v_prev from public.pronto_sales s
   where s.business_id=v_business and s.idempotency_key=v_key;
  if found then
   if v_prev.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='22023'; end if;
   select d.id into v_debt from public.pronto_debts d where d.business_id=v_business and d.sale_id=v_prev.id;
   return pg_catalog.jsonb_build_object('sale_id',v_prev.id,'debt_id',v_debt,'duplicate',true);
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
  -- Customer row lock serialises concurrent credit sales/limit checks for that customer.
  select * into v_cust from public.pronto_customers where id=v_customer and business_id=v_business for update;
  if not found or not v_cust.active then raise exception 'debt_customer_required' using errcode='22023'; end if;
  if v_cust.credit_blocked then raise exception 'debt_blocked' using errcode='22023'; end if;
  if exists(select 1 from public.pronto_debts d where d.business_id=v_business and d.customer_id=v_customer
    and d.status='open' and d.balance_cents>0 and d.due_on<v_today) then
   raise exception 'debt_overdue' using errcode='22023'; end if;
  for v_row in select distinct (el->>'product_id')::uuid id from pg_catalog.jsonb_array_elements(v_items) el order by id
  loop
   perform 1 from public.pronto_products p where p.id=v_row.id
    and p.business_id=v_business and p.branch_id=v_branch and p.active for update;
   if not found then raise exception 'product_unavailable' using errcode='22023'; end if;
  end loop;
  for v_line in select el as item from pg_catalog.jsonb_array_elements(v_items) el
  loop
   v_product:=(v_line.item->>'product_id')::uuid;
   v_qty:=(v_line.item->>'quantity')::numeric;
   if v_product=any(v_seen) or v_qty is null or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,3) then
    raise exception 'invalid_sale_item' using errcode='22023'; end if;
   v_seen:=pg_catalog.array_append(v_seen,v_product);
   select p.price_cents,p.stock,p.unit into v_price,v_stock,v_unit from public.pronto_products p
    where p.id=v_product and p.business_id=v_business and p.branch_id=v_branch and p.active;
   if not found or v_stock<v_qty then raise exception 'insufficient_stock' using errcode='22023'; end if;
   if v_unit in ('un','caixa','pacote','saco','rolo','par','conjunto') and v_qty<>trunc(v_qty) then
    raise exception 'integer_quantity_required' using errcode='22023'; end if;
   v_subtotal:=v_subtotal+round(v_price*v_qty)::bigint;
  end loop;
  if v_discount>=v_subtotal then raise exception 'discount_exceeds_sale' using errcode='22023'; end if;
  v_total:=v_subtotal-v_discount;
  select coalesce(sum(d.balance_cents),0) into v_outstanding from public.pronto_debts d
   where d.business_id=v_business and d.customer_id=v_customer and d.status='open';
  if v_outstanding+v_total>v_cust.credit_limit_cents then raise exception 'debt_limit' using errcode='22023'; end if;

  v_sale:=pg_catalog.gen_random_uuid();
  -- guard_sale_discount trigger still blocks cashier discounts on this insert.
  insert into public.pronto_sales(id,business_id,branch_id,seller_id,session_id,customer_id,
   customer_name_snapshot,customer_phone_snapshot,subtotal_cents,discount_cents,total_cents,method,idempotency_key,request_hash)
   values(v_sale,v_business,v_branch,v_actor,v_cash,v_customer,v_cust.name,v_cust.phone,
    v_subtotal,v_discount,v_total,'credit',v_key,v_hash);
  for v_line in select el as item from pg_catalog.jsonb_array_elements(v_items) el
  loop
   v_product:=(v_line.item->>'product_id')::uuid;
   v_qty:=(v_line.item->>'quantity')::numeric;
   select p.price_cents,p.name into v_price,v_pname from public.pronto_products p where p.id=v_product;
   insert into public.pronto_sale_items(business_id,sale_id,product_id,qty,unit_price_cents,line_total_cents,snapshot_name)
    values(v_business,v_sale,v_product,v_qty,v_price,round(v_price*v_qty)::bigint,v_pname);
   v_remaining:=v_qty;
   -- FEFO: earliest expiry first, expired lots never sold.
   for v_batch in select b.id,b.qty from public.pronto_batches b
    where b.business_id=v_business and b.product_id=v_product
      and b.qty>0 and (b.expires_on is null or b.expires_on>current_date)
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
   update public.pronto_products set stock=stock-v_qty,revision=revision+1 where id=v_product and stock>=v_qty;
   if not found then raise exception 'insufficient_stock' using errcode='22023'; end if;
  end loop;
  insert into public.pronto_debts(business_id,branch_id,sale_id,customer_id,original_cents,balance_cents,due_on)
   values(v_business,v_branch,v_sale,v_customer,v_total,v_total,v_due) returning id into v_debt;
  insert into public.pronto_debt_ledger(business_id,debt_id,kind,amount_cents,balance_after_cents,actor_id,reference_id)
   values(v_business,v_debt,'charge',v_total,v_total,v_actor,v_sale);
  v_result:=pg_catalog.jsonb_build_object('sale_id',v_sale,'debt_id',v_debt,'duplicate',false,
   'total_cents',v_total,'due_on',v_due);

 elsif p_action='debt_payment' then
  if v_role not in ('owner','manager','cashier') then raise exception 'collection_permission' using errcode='42501'; end if;
  v_key:=(p_data->>'idempotency_key')::uuid;
  v_debt:=(p_data->>'debt_id')::uuid;
  v_cash:=(p_data->>'session_id')::uuid;
  v_amount:=(p_data->>'amount_cents')::bigint;
  v_method:=p_data->>'method';
  v_reference:=nullif(pg_catalog.btrim(p_data->>'reference'),'');
  if v_key is null or v_debt is null or v_cash is null or v_amount is null or v_amount<=0
   or v_method is null or v_method not in ('cash','mpesa','emola','transfer')
   or length(coalesce(v_reference,''))>128
   or coalesce((p_data->>'manual_confirmed')::boolean,false) is not true then
   raise exception 'debt_payment' using errcode='22023'; end if;
  if v_method<>'cash' and v_reference is null then raise exception 'reference_required' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('debtpay:'||v_business::text||':'||v_key::text,0));
  select p.id,p.request_hash,p.balance_after_cents into v_prev from public.pronto_debt_payments p
   where p.business_id=v_business and p.idempotency_key=v_key;
  if found then
   if v_prev.request_hash<>v_hash then raise exception 'payment_conflict' using errcode='22023'; end if;
   return pg_catalog.jsonb_build_object('payment_id',v_prev.id,'balance_cents',v_prev.balance_after_cents,'duplicate',true);
  end if;
  select s.id into v_cash from public.pronto_cash_sessions s
   where s.id=v_cash and s.business_id=v_business and s.branch_id=v_branch
     and s.operator_id=v_actor and s.status='open' and s.blocked_at is null and s.close_requested_at is null for update;
  if not found then raise exception 'cash_not_open' using errcode='22023'; end if;
  select * into v_d from public.pronto_debts d where d.id=v_debt and d.business_id=v_business for update;
  if not found then raise exception 'debt_not_found' using errcode='22023'; end if;
  if v_d.status<>'open' then raise exception 'debt_closed' using errcode='22023'; end if;
  if v_amount>v_d.balance_cents then raise exception 'debt_amount' using errcode='22023'; end if;
  v_balance:=v_d.balance_cents-v_amount;
  insert into public.pronto_debt_payments(business_id,debt_id,operator_id,session_id,method,amount_cents,reference,
   idempotency_key,request_hash,balance_after_cents,manual_confirmed)
   values(v_business,v_debt,v_actor,v_cash,v_method,v_amount,v_reference,v_key,v_hash,v_balance,true)
   returning id into v_sale;
  update public.pronto_debts set balance_cents=v_balance,status=case when v_balance=0 then 'paid' else 'open' end
   where id=v_debt;
  insert into public.pronto_debt_ledger(business_id,debt_id,kind,amount_cents,balance_after_cents,actor_id,reference_id)
   values(v_business,v_debt,'payment',-v_amount,v_balance,v_actor,v_sale);
  v_result:=pg_catalog.jsonb_build_object('payment_id',v_sale,'debt_id',v_debt,'amount_cents',v_amount,
   'balance_cents',v_balance,'duplicate',false);

 elsif p_action='cash_close' then
  return pronto_private.cash_control('close',p_data);
 else
  raise exception 'unknown_shop_action' using errcode='22023';
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'pos.'||p_action,v_result);
 return v_result;
end $function$
;

-- hold
CREATE OR REPLACE FUNCTION pronto_private.hold_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and s.branch_id=v_branch and s.operator_id=v_actor and s.status='open'
     and s.blocked_at is null and s.close_requested_at is null for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  insert into public.pronto_cash_movements(business_id,session_id,actor_id,direction,amount_cents,reason,idempotency_key,request_hash)
   values(v_business,v_cash,v_actor,v_direction,v_amount,v_reason,v_key,pg_catalog.md5(p_data::text)) returning id into v_movement;
  v_result:=pg_catalog.jsonb_build_object('movement_id',v_movement,'direction',v_direction,'amount_cents',v_amount);
 else raise exception 'unknown_hold_action' using errcode='22023';
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'pos.'||p_action,v_result);
 return v_result;
end $function$
;

-- returns
CREATE OR REPLACE FUNCTION pronto_private.return_action(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

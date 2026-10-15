-- Correction to PL/pgSQL JSON-array record iteration. Safe replace-function DDL.
create or replace function pronto_private.merchant_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
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
  if v_role not in ('owner','manager','cashier') then raise exception 'cash_permission' using errcode='42501'; end if;
  v_received:=coalesce((p_data->>'opening_cash_cents')::bigint,0);
  v_label:=pg_catalog.btrim(p_data->>'device_id');
  if v_received<0 or v_received>999999999999
   or v_label is null or length(v_label) not between 2 and 100 then
   raise exception 'invalid_cash_open' using errcode='22023'; end if;
  insert into public.pronto_cash_sessions(business_id,branch_id,operator_id,device_id,opening_cash_cents)
   values(v_business,v_branch,v_actor,v_label,v_received) returning id into v_cash;
  v_result:=pg_catalog.jsonb_build_object('session_id',v_cash,'opening_cash_cents',v_received);

 elsif p_action='cash_close' then
  if v_role not in ('owner','manager','cashier') then raise exception 'cash_permission' using errcode='42501'; end if;
  v_cash:=(p_data->>'session_id')::uuid;
  v_counted:=(p_data->>'counted_cash_cents')::bigint;
  if v_counted is null or v_counted<0 or v_counted>999999999999 then
   raise exception 'invalid_cash_close' using errcode='22023'; end if;
  select s.opening_cash_cents into v_expected from public.pronto_cash_sessions s
   where s.business_id=v_business and s.branch_id=v_branch and s.id=v_cash
   and s.operator_id=v_actor and s.status='open' for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023'; end if;
  select v_expected+coalesce(sum(p.amount_cents),0) into v_expected
   from public.pronto_payment_allocations p
   join public.pronto_sales s on s.id=p.sale_id and s.business_id=p.business_id
   where p.business_id=v_business and s.session_id=v_cash and p.method='cash';
  select v_expected+coalesce(sum(case when m.direction='in' then m.amount_cents else -m.amount_cents end),0)
    into v_expected from public.pronto_cash_movements m
   where m.business_id=v_business and m.session_id=v_cash;
  v_difference:=v_counted-v_expected;
  update public.pronto_cash_sessions set status='closed',counted_cash_cents=v_counted,closed_at=now()
   where id=v_cash;
  v_result:=pg_catalog.jsonb_build_object('session_id',v_cash,'expected_cents',v_expected,
    'counted_cents',v_counted,'difference_cents',v_difference);

 elsif p_action='sale_complete' then
  if v_role not in ('owner','manager','cashier') then raise exception 'sale_permission' using errcode='42501'; end if;
  v_cash:=(p_data->>'session_id')::uuid;
  v_key:=(p_data->>'idempotency_key')::uuid;
  v_items:=p_data->'items';
  v_allocations:=p_data->'allocations';
  v_discount:=coalesce((p_data->>'discount_cents')::bigint,0);
  v_received:=coalesce((p_data->>'cash_received_cents')::bigint,0);
  if v_cash is null or v_key is null
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
  select s.id into v_cash from public.pronto_cash_sessions s
   where s.id=v_cash and s.business_id=v_business and s.branch_id=v_branch
     and s.operator_id=v_actor and s.status='open'
   for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023'; end if;
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
end $$;;

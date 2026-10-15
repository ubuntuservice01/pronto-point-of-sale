-- Pronto POS — Bloco 1 (pendências 1–10): clientes, venda a crédito, dívidas e cobranças.
-- Aplicado ao projecto Supabase 'prontopos'. Manter esta cópia versionada para reproduzir o esquema.
-- Incremental, idempotent DDL. Does NOT touch existing customer/debt rows and does NOT
-- insert fictitious data. Browser clients keep READ-only RLS; every write goes through
-- SECURITY DEFINER RPCs that validate auth.uid(), membership role, business/branch,
-- open cash session ownership, database prices, row locks and idempotency keys.

-- 1. Customers: search, notes, soft-deactivation and optimistic credit revision.
alter table public.pronto_customers
 add column if not exists phone_normalized text,
 add column if not exists note text,
 add column if not exists active boolean not null default true,
 add column if not exists credit_revision integer not null default 0,
 add column if not exists updated_at timestamptz not null default now();
do $$ begin
 if not exists(select 1 from pg_constraint where conname='pronto_customers_note_len') then
  alter table public.pronto_customers add constraint pronto_customers_note_len check(note is null or length(note)<=500);
 end if;
 if not exists(select 1 from pg_constraint where conname='pronto_customers_revision_nonneg') then
  alter table public.pronto_customers add constraint pronto_customers_revision_nonneg check(credit_revision>=0);
 end if;
end $$;
create index if not exists pronto_customers_name_search on public.pronto_customers(business_id,lower(name));
create index if not exists pronto_customers_phone_search on public.pronto_customers(business_id,phone_normalized);

-- 2. Sale <-> customer snapshot, so later renames never rewrite purchase history.
alter table public.pronto_sales
 add column if not exists customer_name_snapshot text,
 add column if not exists customer_phone_snapshot text;
create index if not exists pronto_sales_customer on public.pronto_sales(business_id,customer_id,created_at desc) where customer_id is not null;

-- 4/6. Debts and exactly-once collections.
alter table public.pronto_debts add column if not exists branch_id uuid;
create unique index if not exists pronto_debts_one_per_sale on public.pronto_debts(business_id,sale_id);
create index if not exists pronto_debts_customer on public.pronto_debts(business_id,customer_id,status);
alter table public.pronto_debt_payments
 add column if not exists idempotency_key uuid,
 add column if not exists request_hash text,
 add column if not exists balance_after_cents bigint,
 add column if not exists manual_confirmed boolean not null default false;
create unique index if not exists pronto_debt_payments_idem on public.pronto_debt_payments(business_id,idempotency_key) where idempotency_key is not null;
create index if not exists pronto_debt_payments_session on public.pronto_debt_payments(business_id,session_id);

-- Append-only debt ledger (charge / payment). Never written by browsers.
create table if not exists public.pronto_debt_ledger (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 debt_id uuid not null,
 kind text not null check(kind in ('charge','payment','cancel')),
 amount_cents bigint not null check(amount_cents<>0),
 balance_after_cents bigint not null check(balance_after_cents>=0),
 actor_id uuid not null references auth.users(id),
 reference_id uuid,
 created_at timestamptz not null default now(),
 foreign key(business_id,debt_id) references public.pronto_debts(business_id,id)
);
create index if not exists pronto_debt_ledger_debt on public.pronto_debt_ledger(business_id,debt_id,created_at);
grant select on public.pronto_debt_ledger to authenticated;
grant all on public.pronto_debt_ledger to service_role;
revoke insert,update,delete,truncate on public.pronto_debt_ledger from public,anon,authenticated;
alter table public.pronto_debt_ledger enable row level security;
drop policy if exists debt_ledger_read on public.pronto_debt_ledger;
create policy debt_ledger_read on public.pronto_debt_ledger for select to authenticated
 using (pronto_private.member_role(business_id) in ('owner','manager','cashier','finance'));

-- Explicitly keep finance tables read-only for browser roles.
revoke insert,update,delete,truncate on public.pronto_customers,public.pronto_debts,
 public.pronto_debt_payments,public.pronto_sales,public.pronto_sale_items from anon,authenticated;

create or replace function pronto_private.normalize_phone(p text)
returns text language sql immutable set search_path='' as $$
 select nullif(case
  when d ~ '^00' then substr(d,3)
  when d ~ '^8[24567][0-9]{7}$' then '258'||d
  else d end,'')
 from (select pg_catalog.regexp_replace(coalesce(p,''),'[^0-9]','','g') d) x
$$;
revoke all on function pronto_private.normalize_phone(text) from public,anon;
grant execute on function pronto_private.normalize_phone(text) to authenticated;

create or replace function pronto_private.credit_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
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
  if v_cash is null or v_key is null or v_customer is null or v_due is null
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
  select s.id into v_cash from public.pronto_cash_sessions s
   where s.id=v_cash and s.business_id=v_business and s.branch_id=v_branch
     and s.operator_id=v_actor and s.status='open' for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023'; end if;
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
     and s.operator_id=v_actor and s.status='open' for update;
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
  -- Replaces the earlier close: expected cash now includes debt collections in cash.
  if v_role not in ('owner','manager','cashier') then raise exception 'cash_permission' using errcode='42501'; end if;
  v_cash:=(p_data->>'session_id')::uuid;
  v_counted:=(p_data->>'counted_cash_cents')::bigint;
  if v_counted is null or v_counted<0 or v_counted>999999999999 then raise exception 'invalid_cash_close' using errcode='22023'; end if;
  select s.opening_cash_cents into v_expected from public.pronto_cash_sessions s
   where s.business_id=v_business and s.branch_id=v_branch and s.id=v_cash and s.operator_id=v_actor and s.status='open' for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023'; end if;
  v_expected:=v_expected
   +coalesce((select sum(p.amount_cents) from public.pronto_payment_allocations p
     join public.pronto_sales s on s.id=p.sale_id and s.business_id=p.business_id
     where p.business_id=v_business and s.session_id=v_cash and p.method='cash'),0)
   +coalesce((select sum(dp.amount_cents) from public.pronto_debt_payments dp
     where dp.business_id=v_business and dp.session_id=v_cash and dp.method='cash'),0)
   +coalesce((select sum(case when m.direction='in' then m.amount_cents else -m.amount_cents end)
     from public.pronto_cash_movements m where m.business_id=v_business and m.session_id=v_cash),0);
  update public.pronto_cash_sessions set status='closed',counted_cash_cents=v_counted,closed_at=now() where id=v_cash;
  v_result:=pg_catalog.jsonb_build_object('session_id',v_cash,'expected_cents',v_expected,'counted_cents',v_counted,
   'difference_cents',v_counted-v_expected,
   'digital',coalesce((select pg_catalog.jsonb_object_agg(x.method,x.total) from (
     select u.method,sum(u.amount_cents) total from (
      select p.method,p.amount_cents from public.pronto_payment_allocations p join public.pronto_sales s on s.id=p.sale_id
       where p.business_id=v_business and s.session_id=v_cash and p.method<>'cash'
      union all
      select dp.method,dp.amount_cents from public.pronto_debt_payments dp
       where dp.business_id=v_business and dp.session_id=v_cash and dp.method<>'cash') u group by u.method) x),'{}'::jsonb));
 else
  raise exception 'unknown_shop_action' using errcode='22023';
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'pos.'||p_action,v_result);
 return v_result;
end $$;
revoke all on function pronto_private.credit_action(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.credit_action(text,jsonb) to authenticated;

-- Single public write entrypoint, unchanged signature.
create or replace function public.pronto_merchant_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $$
begin
 if p_action in ('customer_save','credit_policy','credit_sale','debt_payment','cash_close')
   or (p_action='sale_complete' and coalesce(p_data->>'customer_id','')<>'') then
  return pronto_private.credit_action(p_action,p_data);
 end if;
 return pronto_private.merchant_action(p_action,p_data);
end $$;
revoke all on function public.pronto_merchant_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_merchant_action(text,jsonb) to authenticated;

-- 3/8/9/10. Read model for customers, wallet, statements and alerts.
create or replace function pronto_private.credit_snapshot(p_business uuid,p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text; v_today date:=(now() at time zone 'Africa/Maputo')::date;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role is null or v_role not in ('owner','manager','cashier','finance') then
  raise exception 'shop_access_required' using errcode='42501'; end if;
 if not exists(select 1 from public.pronto_branches b where b.id=p_branch and b.business_id=p_business and b.active) then
  raise exception 'branch_unavailable' using errcode='22023'; end if;
 return pg_catalog.jsonb_build_object('business_id',p_business,'branch_id',p_branch,'role',v_role,'today',v_today,
  'customers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',c.id,'name',c.name,'phone',c.phone,'note',c.note,'active',c.active,
    'credit_limit_cents',c.credit_limit_cents,'credit_blocked',c.credit_blocked,'credit_revision',c.credit_revision,
    'created_at',c.created_at) order by lower(c.name),c.id)
   from (select * from public.pronto_customers z where z.business_id=p_business order by lower(z.name),z.id limit 1000) c),'[]'::jsonb),
  'debts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',d.id,'sale_id',d.sale_id,'customer_id',d.customer_id,'original_cents',d.original_cents,
    'balance_cents',d.balance_cents,'due_on',d.due_on,'status',d.status,'created_at',d.created_at,
    'state',case when d.status='paid' then 'liquidado' when d.status='cancelled' then 'cancelado'
      when d.due_on<v_today then 'vencido' when d.balance_cents<d.original_cents then 'parcial' else 'em_dia' end,
    'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',i.snapshot_name,'qty',i.qty,
      'unit_price_cents',i.unit_price_cents,'line_total_cents',i.line_total_cents)) from public.pronto_sale_items i
      where i.business_id=p_business and i.sale_id=d.sale_id),'[]'::jsonb)) order by d.due_on,d.created_at)
   from (select * from public.pronto_debts z where z.business_id=p_business order by (z.status='open') desc,z.created_at desc limit 1000) d),'[]'::jsonb),
  'payments',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id,'debt_id',p.debt_id,'method',p.method,'amount_cents',p.amount_cents,'reference',p.reference,
    'balance_after_cents',p.balance_after_cents,'operator_id',p.operator_id,'session_id',p.session_id,'created_at',p.created_at)
    order by p.created_at desc)
   from (select * from public.pronto_debt_payments z where z.business_id=p_business order by z.created_at desc limit 1000) p),'[]'::jsonb),
  'customer_sales',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'customer_id',s.customer_id,'customer_name',s.customer_name_snapshot,'total_cents',s.total_cents,
    'method',s.method,'status',s.status,'created_at',s.created_at) order by s.created_at desc)
   from (select * from public.pronto_sales z where z.business_id=p_business and z.customer_id is not null
     and (v_role in ('owner','manager','finance') or z.branch_id=p_branch) order by z.created_at desc limit 1000) s),'[]'::jsonb),
  'generated_at',now());
end $$;
revoke all on function pronto_private.credit_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function pronto_private.credit_snapshot(uuid,uuid) to authenticated;
create or replace function public.pronto_credit_snapshot(p_business uuid,p_branch uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$ select pronto_private.credit_snapshot(p_business,p_branch); $$;
revoke all on function public.pronto_credit_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pronto_credit_snapshot(uuid,uuid) to authenticated;

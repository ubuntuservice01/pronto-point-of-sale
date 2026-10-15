-- Pronto POS - suppliers, purchases, expenses and accountable cash movements.
-- Authenticated tenant-scoped RPC only; direct browser writes stay denied.
create table if not exists public.pronto_suppliers(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 name text not null check(length(btrim(name)) between 2 and 160),
 phone text,
 address text,
 active boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists pronto_suppliers_business_name on public.pronto_suppliers(business_id,lower(name));
alter table public.pronto_suppliers enable row level security;
revoke all on public.pronto_suppliers from public,anon,authenticated;
grant select on public.pronto_suppliers to authenticated;
drop policy if exists "pronto_suppliers_read" on public.pronto_suppliers;
create policy "pronto_suppliers_read" on public.pronto_suppliers for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','stock','finance'));

alter table public.pronto_purchases
 add column if not exists supplier_id uuid references public.pronto_suppliers(id),
 add column if not exists balance_cents bigint not null default 0 check(balance_cents>=0),
 add column if not exists idempotency_key uuid,
 add column if not exists request_hash text,
 add column if not exists invoice_ref text,
 add column if not exists due_on date;
create unique index if not exists pronto_purchases_unique_request on public.pronto_purchases(business_id,idempotency_key) where idempotency_key is not null;
create table if not exists public.pronto_purchase_payments(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 purchase_id uuid not null references public.pronto_purchases(id),
 session_id uuid references public.pronto_cash_sessions(id),
 actor_id uuid not null references auth.users(id),
 amount_cents bigint not null check(amount_cents>0),
 method text not null check(method in('cash','mpesa','emola','transfer')),
 reference text,
 idempotency_key uuid not null,
 request_hash text not null,
 created_at timestamptz not null default now(),
 unique(business_id,idempotency_key)
);
alter table public.pronto_purchase_payments enable row level security;
revoke all on public.pronto_purchase_payments from public,anon,authenticated;
grant select on public.pronto_purchase_payments to authenticated;
create policy "pronto_purchase_payments_read" on public.pronto_purchase_payments for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','finance'));
alter table public.pronto_expenses
 add column if not exists category text not null default 'Outras',
 add column if not exists method text not null default 'cash' check(method in('cash','mpesa','emola','transfer')),
 add column if not exists session_id uuid references public.pronto_cash_sessions(id),
 add column if not exists reference text,
 add column if not exists idempotency_key uuid,
 add column if not exists request_hash text,
 add column if not exists reversed_at timestamptz,
 add column if not exists reversal_reason text;
create unique index if not exists pronto_expenses_unique_request on public.pronto_expenses(business_id,idempotency_key) where idempotency_key is not null;
create table if not exists public.pronto_expense_schedules(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 branch_id uuid not null references public.pronto_branches(id),
 label text not null check(length(btrim(label)) between 2 and 180),
 category text not null default 'Outras',
 amount_cents bigint not null check(amount_cents>0),
 repeat_months int not null check(repeat_months between 1 and 12),
 next_due_on date not null,
 active boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.pronto_expense_schedules enable row level security;
revoke all on public.pronto_expense_schedules from public,anon,authenticated;
grant select on public.pronto_expense_schedules to authenticated;
create policy "pronto_expense_schedules_read" on public.pronto_expense_schedules for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','finance'));

create or replace function pronto_private.finance_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_user uuid:=(select auth.uid());
 v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;
 v_role text;
 v_name text;v_phone text;v_address text;v_category text;v_method text;v_reference text;v_reason text;
 v_supplier uuid;v_purchase uuid;v_product uuid;v_cash uuid;v_expense uuid;v_schedule uuid;
 v_qty numeric(16,3);v_unit text;v_cost bigint;v_total bigint:=0;v_amount bigint;v_balance bigint;v_count bigint;
 v_key uuid;v_hash text;v_current record;v_line record;v_rec record;v_lot uuid;v_due date;v_repeat int;
 v_items jsonb;v_stock numeric(16,3);v_result jsonb;
begin
 if v_user is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or
  pg_catalog.pg_column_size(p_data)>32768 or v_business is null or v_branch is null then
  raise exception 'invalid_request' using errcode='22023';
 end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null then raise exception 'shop_access_required' using errcode='42501';end if;
 perform 1 from public.pronto_branches where id=v_branch and business_id=v_business and active;
 if not found then raise exception 'branch_unavailable' using errcode='22023';end if;
 if p_action='supplier_save' then
  if v_role not in('owner','manager','stock') then raise exception 'supplier_permission' using errcode='42501';end if;
  v_name:=pg_catalog.btrim(p_data->>'name');v_phone:=nullif(pg_catalog.btrim(p_data->>'phone'),'');
  v_address:=nullif(pg_catalog.btrim(p_data->>'address'),'');
  v_supplier:=nullif(p_data->>'supplier_id','')::uuid;
  if v_name is null or length(v_name) not between 2 and 160 or length(coalesce(v_phone,''))>60 or length(coalesce(v_address,''))>250 then
   raise exception 'invalid_supplier' using errcode='22023';end if;
  if v_supplier is null then
   insert into public.pronto_suppliers(business_id,name,phone,address,created_by)
    values(v_business,v_name,v_phone,v_address,v_user) returning id into v_supplier;
  else
   update public.pronto_suppliers set name=v_name,phone=v_phone,address=v_address,
    active=coalesce((p_data->>'active')::boolean,active),updated_at=now()
    where id=v_supplier and business_id=v_business;
   if not found then raise exception 'supplier_not_found' using errcode='22023';end if;
  end if;
  v_result:=pg_catalog.jsonb_build_object('supplier_id',v_supplier);
 elsif p_action='purchase_receive' then
  if v_role not in('owner','manager','stock') then raise exception 'purchase_permission' using errcode='42501';end if;
  v_supplier:=(p_data->>'supplier_id')::uuid;v_items:=p_data->'items';
  v_key:=(p_data->>'idempotency_key')::uuid;v_reference:=nullif(pg_catalog.btrim(p_data->>'invoice_ref'),'');
  v_due:=nullif(p_data->>'due_on','')::date;
  if v_supplier is null or v_key is null or pg_catalog.jsonb_typeof(v_items)<>'array'
    or pg_catalog.jsonb_array_length(v_items) not between 1 and 100 or length(coalesce(v_reference,''))>120 then
   raise exception 'invalid_purchase' using errcode='22023';end if;
  if not exists(select 1 from public.pronto_suppliers where id=v_supplier and business_id=v_business and active) then
   raise exception 'supplier_unavailable' using errcode='22023';end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchase:'||v_business::text||':'||v_key::text,0));
  select * into v_current from public.pronto_purchases where business_id=v_business and idempotency_key=v_key;
  if found then
   if v_current.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('purchase_id',v_current.id,'duplicate',true,'total_cents',v_current.total_cents);
  end if;
  -- Lock all affected products in deterministic order before stock mutations.
  for v_rec in select distinct (el->>'product_id')::uuid id from pg_catalog.jsonb_array_elements(v_items) el order by id
  loop
   perform 1 from public.pronto_products where id=v_rec.id and business_id=v_business
    and branch_id=v_branch and active for update;
   if not found then raise exception 'product_unavailable' using errcode='22023';end if;
  end loop;
  for v_line in select el as item from pg_catalog.jsonb_array_elements(v_items) el loop
   v_product:=(v_line.item->>'product_id')::uuid;
   v_qty:=(v_line.item->>'quantity')::numeric;v_cost:=(v_line.item->>'unit_cost_cents')::bigint;
   select unit into v_unit from public.pronto_products where id=v_product and business_id=v_business and branch_id=v_branch;
   if v_qty is null or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,3)
    or v_cost is null or v_cost<0 or v_cost>999999999999
    or (v_unit in ('un','caixa','pacote','saco','rolo','par','conjunto') and v_qty<>trunc(v_qty)) then
    raise exception 'invalid_purchase_item' using errcode='22023';end if;
   v_total:=v_total+pg_catalog.round(v_qty*v_cost)::bigint;
   if v_total>999999999999 then raise exception 'purchase_total_limit' using errcode='22023';end if;
  end loop;
  insert into public.pronto_purchases(business_id,branch_id,supplier_id,supplier,items,total_cents,balance_cents,
   idempotency_key,request_hash,invoice_ref,due_on,created_by)
   values(v_business,v_branch,v_supplier,
    (select name from public.pronto_suppliers where id=v_supplier),
    v_items,v_total,v_total,v_key,v_hash,v_reference,v_due,v_user) returning id into v_purchase;
  for v_line in select el as item from pg_catalog.jsonb_array_elements(v_items) el loop
   v_product:=(v_line.item->>'product_id')::uuid;
   v_qty:=(v_line.item->>'quantity')::numeric;v_cost:=(v_line.item->>'unit_cost_cents')::bigint;
   insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty,unit_cost_cents)
    values(v_business,v_product,nullif(pg_catalog.btrim(v_line.item->>'lot_number'),''),
     nullif(v_line.item->>'expires_on','')::date,v_qty,v_cost) returning id into v_lot;
   update public.pronto_products set stock=stock+v_qty,revision=revision+1 where id=v_product;
   insert into public.pronto_stock_movements(business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
    values(v_business,v_product,v_lot,v_user,'receive',v_qty,v_purchase,'Compra a fornecedor');
  end loop;
  v_result:=pg_catalog.jsonb_build_object('purchase_id',v_purchase,'total_cents',v_total,'duplicate',false);
 elsif p_action='purchase_payment' then
  if v_role not in('owner','manager','finance') then raise exception 'purchase_pay_permission' using errcode='42501';end if;
  v_purchase:=(p_data->>'purchase_id')::uuid;v_key:=(p_data->>'idempotency_key')::uuid;
  v_amount:=(p_data->>'amount_cents')::bigint;v_cash:=nullif(p_data->>'session_id','')::uuid;
  v_method:=p_data->>'method';v_reference:=nullif(pg_catalog.btrim(p_data->>'reference'),'');
  if v_purchase is null or v_key is null or v_amount is null or v_amount<=0
    or v_method not in('cash','mpesa','emola','transfer') or length(coalesce(v_reference,''))>128
    or (v_method<>'cash' and v_reference is null) or
    coalesce((p_data->>'manual_confirmed')::boolean,false) is not true then
    raise exception 'invalid_purchase_payment' using errcode='22023';end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('purchasepayment:'||v_business::text||':'||v_key::text,0));
  select id,request_hash into v_current from public.pronto_purchase_payments
   where business_id=v_business and idempotency_key=v_key;
  if found then
   if v_current.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('payment_id',v_current.id,'duplicate',true);
  end if;
  if v_method='cash' then
   perform 1 from public.pronto_cash_sessions where id=v_cash and business_id=v_business and
    branch_id=v_branch and operator_id=v_user and status='open' for update;
   if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  end if;
  select balance_cents into v_balance from public.pronto_purchases
   where id=v_purchase and business_id=v_business and branch_id=v_branch for update;
  if not found or v_amount>v_balance then raise exception 'payment_over_balance' using errcode='22023';end if;
  update public.pronto_purchases set balance_cents=balance_cents-v_amount where id=v_purchase;
  insert into public.pronto_purchase_payments(business_id,purchase_id,session_id,actor_id,amount_cents,
   method,reference,idempotency_key,request_hash)
   values(v_business,v_purchase,v_cash,v_user,v_amount,v_method,v_reference,v_key,v_hash)
   returning id into v_lot;
  if v_method='cash' then
   insert into public.pronto_cash_movements(business_id,session_id,actor_id,direction,amount_cents,reason)
    values(v_business,v_cash,v_user,'out',v_amount,'Pagamento de compra '||v_purchase::text);
  end if;
  v_result:=pg_catalog.jsonb_build_object('payment_id',v_lot,'balance_cents',v_balance-v_amount,'duplicate',false);
 elsif p_action='expense_add' then
  if v_role not in('owner','manager','finance') then raise exception 'expense_permission' using errcode='42501';end if;
  v_name:=pg_catalog.btrim(p_data->>'label');v_category:=coalesce(nullif(pg_catalog.btrim(p_data->>'category'),''),'Outras');
  v_method:=p_data->>'method';v_reference:=nullif(pg_catalog.btrim(p_data->>'reference'),'');
  v_cash:=nullif(p_data->>'session_id','')::uuid;v_amount:=(p_data->>'amount_cents')::bigint;
  v_key:=(p_data->>'idempotency_key')::uuid;
  if v_name is null or length(v_name) not between 2 and 180 or length(v_category)>80 or
   v_amount is null or v_amount<=0 or v_amount>999999999999 or v_key is null
   or v_method not in('cash','mpesa','emola','transfer') or
   length(coalesce(v_reference,''))>128 or(v_method<>'cash' and v_reference is null) or
   coalesce((p_data->>'manual_confirmed')::boolean,false) is not true then
   raise exception 'invalid_expense' using errcode='22023';end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('expense:'||v_business::text||':'||v_key::text,0));
  select id,request_hash into v_current from public.pronto_expenses
   where business_id=v_business and idempotency_key=v_key;
  if found then
   if v_current.request_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('expense_id',v_current.id,'duplicate',true);
  end if;
  if v_method='cash' then
   perform 1 from public.pronto_cash_sessions where id=v_cash and business_id=v_business
    and branch_id=v_branch and operator_id=v_user and status='open' for update;
   if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  end if;
  insert into public.pronto_expenses(business_id,branch_id,label,category,amount_cents,operator_id,
    method,session_id,reference,idempotency_key,request_hash)
   values(v_business,v_branch,v_name,v_category,v_amount,v_user,v_method,v_cash,v_reference,v_key,v_hash)
   returning id into v_expense;
  if v_method='cash' then
   insert into public.pronto_cash_movements(business_id,session_id,actor_id,direction,amount_cents,reason)
    values(v_business,v_cash,v_user,'out',v_amount,'Despesa: '||v_name);
  end if;
  v_result:=pg_catalog.jsonb_build_object('expense_id',v_expense,'duplicate',false);
 elsif p_action='expense_schedule_save' then
  if v_role not in('owner','manager','finance') then raise exception 'expense_permission' using errcode='42501';end if;
  v_schedule:=nullif(p_data->>'schedule_id','')::uuid;
  v_name:=pg_catalog.btrim(p_data->>'label');
  v_category:=coalesce(nullif(pg_catalog.btrim(p_data->>'category'),''),'Outras');
  v_amount:=(p_data->>'amount_cents')::bigint;
  v_repeat:=(p_data->>'repeat_months')::int;v_due:=(p_data->>'next_due_on')::date;
  if v_name is null or length(v_name) not between 2 and 180 or length(v_category)>80 or
    v_amount is null or v_amount<=0 or v_repeat not between 1 and 12 or v_due is null then
   raise exception 'invalid_expense_schedule' using errcode='22023';end if;
  if v_schedule is null then
   insert into public.pronto_expense_schedules(business_id,branch_id,label,category,amount_cents,repeat_months,next_due_on,created_by)
    values(v_business,v_branch,v_name,v_category,v_amount,v_repeat,v_due,v_user) returning id into v_schedule;
  else
   update public.pronto_expense_schedules set label=v_name,category=v_category,amount_cents=v_amount,
    repeat_months=v_repeat,next_due_on=v_due,active=coalesce((p_data->>'active')::boolean,active)
    where id=v_schedule and business_id=v_business and branch_id=v_branch;
   if not found then raise exception 'schedule_not_found' using errcode='22023';end if;
  end if;
  -- Scheduling does not auto-pay; only creates a reminder until approved on due date.
  v_result:=pg_catalog.jsonb_build_object('schedule_id',v_schedule,'reminder_only',true);
 else
  raise exception 'unknown_finance_action' using errcode='22023';
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_user,'finance.'||p_action,v_result);
 return v_result;
end $$;
revoke all on function pronto_private.finance_action(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.finance_action(text,jsonb) to authenticated;
create or replace function public.pronto_finance_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.finance_action(p_action,p_data);$$;
revoke all on function public.pronto_finance_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_finance_action(text,jsonb) to authenticated;

create or replace function pronto_private.finance_snapshot(p_business uuid,p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role is null then raise exception 'shop_access_required' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches where id=p_branch and business_id=p_business and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 return pg_catalog.jsonb_build_object(
  'suppliers',case when v_role in('owner','manager','stock','finance') then
   coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'name',s.name,'phone',s.phone,'address',s.address,'active',s.active)
    order by s.name) from (select * from public.pronto_suppliers where business_id=p_business
     order by name limit 500) s),'[]'::jsonb) else '[]'::jsonb end,
  'purchases',case when v_role in('owner','manager','stock','finance') then
   coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id,'supplier',p.supplier,'total_cents',p.total_cents,
    'balance_cents',p.balance_cents,'items',p.items,'created_at',p.created_at)
    order by p.created_at desc)
    from (select * from public.pronto_purchases where business_id=p_business and branch_id=p_branch
     order by created_at desc limit 200) p),'[]'::jsonb) else '[]'::jsonb end,
  'expenses',case when v_role in('owner','manager','finance') then
   coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',e.id,'label',e.label,'category',e.category,'amount_cents',e.amount_cents,
    'method',e.method,'created_at',e.created_at)
    order by e.created_at desc)
    from (select * from public.pronto_expenses where business_id=p_business and branch_id=p_branch
     order by created_at desc limit 300) e),'[]'::jsonb) else '[]'::jsonb end,
  'schedules',case when v_role in('owner','manager','finance') then
   coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',s.id,'label',s.label,'category',s.category,'amount_cents',s.amount_cents,
    'next_due_on',s.next_due_on,'repeat_months',s.repeat_months,'active',s.active)
    order by s.next_due_on)
    from (select * from public.pronto_expense_schedules where business_id=p_business and branch_id=p_branch
     order by next_due_on limit 200) s),'[]'::jsonb) else '[]'::jsonb end,
  'generated_at',now());
end $$;
revoke all on function pronto_private.finance_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function pronto_private.finance_snapshot(uuid,uuid) to authenticated;
create or replace function public.pronto_finance_snapshot(p_business uuid,p_branch uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.finance_snapshot(p_business,p_branch);$$;
revoke all on function public.pronto_finance_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pronto_finance_snapshot(uuid,uuid) to authenticated;

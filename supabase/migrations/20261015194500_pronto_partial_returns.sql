-- Audited partial and full returns for completed paid sales. Does not issue
-- external refunds or fiscal credit notes: money transfer is manually confirmed.
create table public.pronto_return_headers (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 branch_id uuid not null references public.pronto_branches(id),
 sale_id uuid not null references public.pronto_sales(id),
 actor_id uuid not null references auth.users(id),
 session_id uuid references public.pronto_cash_sessions(id),
 amount_cents bigint not null check(amount_cents>0),
 method text not null check(method in('cash','mpesa','emola','transfer')),
 reason text not null check(length(btrim(reason)) between 3 and 250),
 reference text,
 idempotency_key uuid not null,
 request_hash text not null,
 manually_confirmed boolean not null default false,
 created_at timestamptz not null default now(),
 unique(business_id,idempotency_key)
);
create table public.pronto_return_lines (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 return_id uuid not null references public.pronto_return_headers(id),
 product_id uuid not null references public.pronto_products(id),
 qty numeric(16,3) not null check(qty>0),
 resellable boolean not null,
 batch_id uuid references public.pronto_batches(id),
 created_at timestamptz not null default now(),
 unique(return_id,product_id)
);
alter table public.pronto_return_headers enable row level security;
alter table public.pronto_return_lines enable row level security;
revoke all on public.pronto_return_headers,public.pronto_return_lines from public,anon,authenticated;
grant select on public.pronto_return_headers,public.pronto_return_lines to authenticated;
create policy "pronto_returns_read" on public.pronto_return_headers for select to authenticated
 using(pronto_private.member_role(business_id) in('owner','manager','finance','cashier'));
create policy "pronto_return_lines_read" on public.pronto_return_lines for select to authenticated
 using(pronto_private.member_role(business_id) in('owner','manager','finance','cashier'));

create or replace function pronto_private.return_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
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
   and id=v_session and operator_id=v_actor and status='open' for update;
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
    values(v_business,v_product,v_batch,v_actor,'return',v_qty,v_refund,v_reason);
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
end $$;
revoke all on function pronto_private.return_action(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.return_action(text,jsonb) to authenticated;
create or replace function public.pronto_return_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.return_action(p_action,p_data);$$;
revoke all on function public.pronto_return_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_return_action(text,jsonb) to authenticated;

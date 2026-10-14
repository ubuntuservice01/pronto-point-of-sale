-- Pronto POS: multi-business foundation (phase 1). No financial writes from browsers.
-- All business operations must be executed transactionally by a trusted server.
create schema if not exists pronto_private;
revoke all on schema pronto_private from public, anon, authenticated;

create table public.pronto_businesses (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 120),
 status text not null default 'active' check (status in ('active','suspended')),
 phone text, address text, created_at timestamptz not null default now()
);
create table public.pronto_memberships (
 business_id uuid not null references public.pronto_businesses(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','manager','cashier','stock','finance')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 primary key (business_id,user_id)
);
create index on public.pronto_memberships(user_id,business_id) where active;
create table public.pronto_branches (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 name text not null check (length(trim(name)) between 1 and 120),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique (business_id,id), unique(business_id,name)
);
create table public.pronto_products (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 code text not null check (length(trim(code)) between 1 and 80),
 name text not null check(length(trim(name)) between 1 and 200),
 category text not null default '',
 unit text not null default 'un',
 price_cents bigint not null check(price_cents>0),
 stock numeric(16,3) not null default 0 check(stock>=0),
 min_stock numeric(16,3) not null default 0 check(min_stock>=0),
 photo_path text,
 active boolean not null default true,
 revision integer not null default 0 check(revision>=0),
 created_at timestamptz not null default now(),
 unique(business_id,id),
 foreign key (business_id,branch_id) references public.pronto_branches(business_id,id)
);
create unique index pronto_product_code_per_branch on public.pronto_products(branch_id,lower(code));
create table public.pronto_batches (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 product_id uuid not null,
 lot_number text,
 expires_on date,
 qty numeric(16,3) not null default 0 check(qty>=0),
 unit_cost_cents bigint check(unit_cost_cents>=0),
 received_at timestamptz not null default now(),
 foreign key(business_id,product_id) references public.pronto_products(business_id,id),
 unique(business_id,id)
);
create index on public.pronto_batches(product_id,expires_on);
create table public.pronto_stock_movements (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 product_id uuid not null,
 batch_id uuid,
 actor_id uuid references auth.users(id),
 kind text not null check(kind in ('receive','adjust','sale','refund','transfer','waste')),
 qty_delta numeric(16,3) not null check(qty_delta<>0),
 reference_id uuid,
 reason text,
 created_at timestamptz not null default now(),
 foreign key(business_id,product_id) references public.pronto_products(business_id,id),
 foreign key(business_id,batch_id) references public.pronto_batches(business_id,id)
);
create index on public.pronto_stock_movements(business_id,created_at desc);
create table public.pronto_customers (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 name text not null check (length(trim(name)) between 1 and 200),
 phone text, credit_limit_cents bigint not null default 0 check(credit_limit_cents>=0),
 credit_blocked boolean not null default false,
 created_at timestamptz not null default now(),
 unique(business_id,id),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id)
);
create table public.pronto_cash_sessions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 operator_id uuid not null references auth.users(id),
 device_id text not null,
 status text not null default 'open' check(status in ('open','closed')),
 opening_cash_cents bigint not null default 0 check(opening_cash_cents>=0),
 counted_cash_cents bigint check(counted_cash_cents>=0),
 opened_at timestamptz not null default now(),
 closed_at timestamptz,
 unique(business_id,id),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id)
);
create unique index pronto_open_cash_per_device on public.pronto_cash_sessions(business_id,operator_id,device_id) where status='open';
create table public.pronto_cash_movements (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 session_id uuid not null,
 actor_id uuid not null references auth.users(id),
 direction text not null check(direction in ('in','out')),
 amount_cents bigint not null check(amount_cents>0),
 reason text not null check(length(trim(reason))>0),
 created_at timestamptz not null default now(),
 foreign key(business_id,session_id) references public.pronto_cash_sessions(business_id,id)
);
create table public.pronto_sales (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 seller_id uuid not null references auth.users(id),
 session_id uuid not null,
 customer_id uuid,
 subtotal_cents bigint not null check(subtotal_cents>=0),
 discount_cents bigint not null default 0 check(discount_cents>=0),
 total_cents bigint not null check(total_cents>=0),
 method text not null check(method in ('cash','mpesa','emola','transfer','mixed','credit')),
 status text not null default 'completed' check(status in ('completed','refunded')),
 idempotency_key uuid not null,
 created_at timestamptz not null default now(),
 unique(business_id,id), unique(business_id,idempotency_key),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id),
 foreign key(business_id,session_id) references public.pronto_cash_sessions(business_id,id),
 foreign key(business_id,customer_id) references public.pronto_customers(business_id,id),
 check(discount_cents<=subtotal_cents), check(total_cents=subtotal_cents-discount_cents)
);
create index on public.pronto_sales(business_id,created_at desc);
create index on public.pronto_sales(business_id,seller_id,created_at desc);
create table public.pronto_sale_items (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 sale_id uuid not null,
 product_id uuid not null,
 qty numeric(16,3) not null check(qty>0),
 unit_price_cents bigint not null check(unit_price_cents>=0),
 line_total_cents bigint not null check(line_total_cents>=0),
 snapshot_name text not null,
 foreign key(business_id,sale_id) references public.pronto_sales(business_id,id),
 foreign key(business_id,product_id) references public.pronto_products(business_id,id)
);
create index on public.pronto_sale_items(sale_id);
create table public.pronto_payment_allocations (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 sale_id uuid not null,
 method text not null check(method in ('cash','mpesa','emola','transfer')),
 amount_cents bigint not null check(amount_cents>0),
 reference text,
 confirmed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(business_id,sale_id) references public.pronto_sales(business_id,id),
 unique(sale_id,method)
);
create table public.pronto_refunds (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 sale_id uuid not null,
 actor_id uuid not null references auth.users(id),
 total_cents bigint not null check(total_cents>0),
 reason text not null,
 created_at timestamptz not null default now(),
 foreign key(business_id,sale_id) references public.pronto_sales(business_id,id),
 unique(sale_id)
);
create table public.pronto_debts (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 sale_id uuid not null,
 customer_id uuid not null,
 original_cents bigint not null check(original_cents>0),
 balance_cents bigint not null check(balance_cents>=0),
 due_on date not null,
 status text not null default 'open' check(status in ('open','paid','cancelled')),
 created_at timestamptz not null default now(),
 unique(business_id,id),
 foreign key(business_id,sale_id) references public.pronto_sales(business_id,id),
 foreign key(business_id,customer_id) references public.pronto_customers(business_id,id),
 check(balance_cents<=original_cents)
);
create table public.pronto_debt_payments (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 debt_id uuid not null,
 operator_id uuid not null references auth.users(id),
 session_id uuid not null,
 method text not null check(method in ('cash','mpesa','emola','transfer')),
 amount_cents bigint not null check(amount_cents>0),
 reference text,
 created_at timestamptz not null default now(),
 foreign key(business_id,debt_id) references public.pronto_debts(business_id,id),
 foreign key(business_id,session_id) references public.pronto_cash_sessions(business_id,id)
);
create table public.pronto_held_sales (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 operator_id uuid not null references auth.users(id),
 cart jsonb not null check(jsonb_typeof(cart)='array'),
 customer_id uuid,
 payment_draft jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id),
 foreign key(business_id,customer_id) references public.pronto_customers(business_id,id)
);
create index on public.pronto_held_sales(business_id,operator_id,created_at desc);
create table public.pronto_purchases (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 supplier text,
 total_cents bigint not null check(total_cents>=0),
 items jsonb not null check(jsonb_typeof(items)='array'),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id)
);
create table public.pronto_expenses (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 label text not null,
 amount_cents bigint not null check(amount_cents>0),
 operator_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id)
);
create table public.pronto_plans (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 price_cents bigint not null check(price_cents>=0),
 duration_days integer not null check(duration_days>0),
 active boolean not null default true
);
create table public.pronto_subscriptions (
 business_id uuid primary key references public.pronto_businesses(id),
 plan_id uuid not null references public.pronto_plans(id),
 expires_at timestamptz not null,
 cancelled boolean not null default false
);
create table public.pronto_audit_events (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 actor_id uuid references auth.users(id),
 event text not null,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index on public.pronto_audit_events(business_id,created_at desc);

-- Membership check must not recurse into the members table's RLS.
-- It is in a non-exposed schema, returns only the caller's own active role,
-- and has a fixed search_path.
create or replace function pronto_private.member_role(target_business uuid)
returns text language sql stable security definer set search_path='' as $$
 select m.role from public.pronto_memberships m
 where m.business_id=target_business and m.user_id=(select auth.uid()) and m.active=true
 limit 1
$$;
revoke all on function pronto_private.member_role(uuid) from public, anon, authenticated;
grant usage on schema pronto_private to authenticated;
grant execute on function pronto_private.member_role(uuid) to authenticated;

-- By design, only trusted application servers can mutate finance and stock.
-- RLS policies permit scoped reads; there are NO browser write policies.
alter table public.pronto_businesses enable row level security;
alter table public.pronto_memberships enable row level security;
alter table public.pronto_branches enable row level security;
alter table public.pronto_products enable row level security;
alter table public.pronto_batches enable row level security;
alter table public.pronto_stock_movements enable row level security;
alter table public.pronto_customers enable row level security;
alter table public.pronto_cash_sessions enable row level security;
alter table public.pronto_cash_movements enable row level security;
alter table public.pronto_sales enable row level security;
alter table public.pronto_sale_items enable row level security;
alter table public.pronto_payment_allocations enable row level security;
alter table public.pronto_refunds enable row level security;
alter table public.pronto_debts enable row level security;
alter table public.pronto_debt_payments enable row level security;
alter table public.pronto_held_sales enable row level security;
alter table public.pronto_purchases enable row level security;
alter table public.pronto_expenses enable row level security;
alter table public.pronto_plans enable row level security;
alter table public.pronto_subscriptions enable row level security;
alter table public.pronto_audit_events enable row level security;

create policy business_read on public.pronto_businesses for select to authenticated
 using(pronto_private.member_role(id) is not null);
create policy membership_read on public.pronto_memberships for select to authenticated
 using(user_id=(select auth.uid()) or pronto_private.member_role(business_id)='owner');
create policy branches_read on public.pronto_branches for select to authenticated
 using(pronto_private.member_role(business_id) is not null);
create policy products_read on public.pronto_products for select to authenticated
 using(pronto_private.member_role(business_id) is not null);
create policy batches_read on public.pronto_batches for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','stock'));
create policy stock_movements_read on public.pronto_stock_movements for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','stock'));
create policy customers_read on public.pronto_customers for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','cashier','finance'));
create policy cash_sessions_read on public.pronto_cash_sessions for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','finance') or
       (pronto_private.member_role(business_id)='cashier' and operator_id=(select auth.uid())));
create policy cash_movements_read on public.pronto_cash_movements for select to authenticated
 using(exists(select 1 from public.pronto_cash_sessions s where s.id=session_id and s.business_id=pronto_cash_movements.business_id));
create policy sales_read on public.pronto_sales for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','finance') or
       (pronto_private.member_role(business_id)='cashier' and seller_id=(select auth.uid())));
create policy sale_items_read on public.pronto_sale_items for select to authenticated
 using(exists(select 1 from public.pronto_sales s where s.id=sale_id and s.business_id=pronto_sale_items.business_id));
create policy payment_allocations_read on public.pronto_payment_allocations for select to authenticated
 using(exists(select 1 from public.pronto_sales s where s.id=sale_id and s.business_id=pronto_payment_allocations.business_id));
create policy refunds_read on public.pronto_refunds for select to authenticated
 using(exists(select 1 from public.pronto_sales s where s.id=sale_id and s.business_id=pronto_refunds.business_id));
create policy debts_read on public.pronto_debts for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','cashier','finance'));
create policy debt_payments_read on public.pronto_debt_payments for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','cashier','finance'));
create policy held_sales_read on public.pronto_held_sales for select to authenticated
 using(pronto_private.member_role(business_id) is not null and operator_id=(select auth.uid()));
create policy purchases_read on public.pronto_purchases for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','stock','finance'));
create policy expenses_read on public.pronto_expenses for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager','finance'));
create policy subscriptions_read on public.pronto_subscriptions for select to authenticated
 using(pronto_private.member_role(business_id)='owner');
create policy audit_events_read on public.pronto_audit_events for select to authenticated
 using(pronto_private.member_role(business_id) in ('owner','manager'));

-- Keep license plans private until server-side licensing API is connected.
revoke all on public.pronto_plans from public,anon,authenticated;
grant select on public.pronto_businesses,public.pronto_memberships,public.pronto_branches,
public.pronto_products,public.pronto_batches,public.pronto_stock_movements,
public.pronto_customers,public.pronto_cash_sessions,public.pronto_cash_movements,
public.pronto_sales,public.pronto_sale_items,public.pronto_payment_allocations,
public.pronto_refunds,public.pronto_debts,public.pronto_debt_payments,
public.pronto_held_sales,public.pronto_purchases,public.pronto_expenses,
public.pronto_subscriptions,public.pronto_audit_events to authenticated;
revoke all on public.pronto_businesses,public.pronto_memberships,public.pronto_branches,
public.pronto_products,public.pronto_batches,public.pronto_stock_movements,
public.pronto_customers,public.pronto_cash_sessions,public.pronto_cash_movements,
public.pronto_sales,public.pronto_sale_items,public.pronto_payment_allocations,
public.pronto_refunds,public.pronto_debts,public.pronto_debt_payments,
public.pronto_held_sales,public.pronto_purchases,public.pronto_expenses,
public.pronto_subscriptions,public.pronto_audit_events from anon;
-- Explicitly revoke all write privileges, even if default grants change.
revoke insert,update,delete,truncate,references,trigger on public.pronto_businesses,
public.pronto_memberships,public.pronto_branches,public.pronto_products,
public.pronto_batches,public.pronto_stock_movements,public.pronto_customers,
public.pronto_cash_sessions,public.pronto_cash_movements,public.pronto_sales,
public.pronto_sale_items,public.pronto_payment_allocations,public.pronto_refunds,
public.pronto_debts,public.pronto_debt_payments,public.pronto_held_sales,
public.pronto_purchases,public.pronto_expenses,public.pronto_subscriptions,
public.pronto_audit_events from authenticated;

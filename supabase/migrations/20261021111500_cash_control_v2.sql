-- Pronto POS caixa v2: branch policy, blind close, remote controls and immutable audit.
-- Additive, no existing business/financial records deleted.
create table if not exists public.pronto_cash_policies(
 business_id uuid not null,
 branch_id uuid not null,
 opening_required boolean not null default true,
 blind_close boolean not null default false,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 primary key(business_id,branch_id),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id)
);
alter table public.pronto_cash_policies enable row level security;
revoke all on public.pronto_cash_policies from public,anon,authenticated;
alter table public.pronto_cash_sessions
 add column if not exists blocked_at timestamptz,
 add column if not exists blocked_by uuid references auth.users(id),
 add column if not exists blocked_reason text,
 add column if not exists close_requested_at timestamptz,
 add column if not exists close_requested_by uuid references auth.users(id),
 add column if not exists close_type text,
 add column if not exists closed_by uuid references auth.users(id),
 add column if not exists expected_at_close_cents bigint,
 add column if not exists close_reason text;
create unique index if not exists pronto_one_open_cash_physical_terminal
 on public.pronto_cash_sessions(business_id,branch_id,device_id)
 where status='open';
create table if not exists public.pronto_cash_difference_notes(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 session_id uuid not null,
 actor_id uuid not null references auth.users(id),
 note text not null check(length(btrim(note)) between 8 and 500),
 created_at timestamptz not null default now(),
 foreign key(business_id,session_id) references public.pronto_cash_sessions(business_id,id)
);
alter table public.pronto_cash_difference_notes enable row level security;
revoke all on public.pronto_cash_difference_notes from public,anon,authenticated;
create index if not exists pronto_cash_notes_by_session on public.pronto_cash_difference_notes(business_id,session_id,created_at);

create or replace function pronto_private.cash_totals(p_business uuid,p_session uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $cash$
declare
 v_open bigint;v_cash bigint;v_sales bigint;v_debts bigint;v_movement bigint;
 v_methods jsonb;v_mov_in bigint;v_mov_out bigint;
begin
 select opening_cash_cents into v_open from public.pronto_cash_sessions
 where id=p_session and business_id=p_business;
 if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
 select coalesce(sum(amount_cents),0) into v_sales from public.pronto_payment_allocations a
 join public.pronto_sales s on s.id=a.sale_id and s.business_id=a.business_id
 where a.business_id=p_business and s.session_id=p_session and a.method='cash';
 select coalesce(sum(amount_cents),0) into v_debts from public.pronto_debt_payments
 where business_id=p_business and session_id=p_session and method='cash';
 select coalesce(sum(case when direction='in' then amount_cents else -amount_cents end),0),
   coalesce(sum(amount_cents) filter (where direction='in'),0),
   coalesce(sum(amount_cents) filter (where direction='out'),0)
 into v_movement,v_mov_in,v_mov_out from public.pronto_cash_movements
 where business_id=p_business and session_id=p_session;
 select coalesce(jsonb_object_agg(method,total),'{}'::jsonb) into v_methods
 from (select method,sum(amount_cents) total from (
  select a.method,a.amount_cents from public.pronto_payment_allocations a
   join public.pronto_sales s on s.id=a.sale_id and s.business_id=a.business_id
   where a.business_id=p_business and s.session_id=p_session
  union all
  select method,amount_cents from public.pronto_debt_payments
   where business_id=p_business and session_id=p_session
 ) v group by method) m;
 v_cash:=v_open+v_sales+v_debts+v_movement;
 return jsonb_build_object('opening_cash_cents',v_open,'expected_cash_cents',v_cash,
  'sales_cash_cents',v_sales,'debt_cash_cents',v_debts,'movements_in_cents',v_mov_in,
  'movements_out_cents',v_mov_out,'payments_by_method',v_methods);
end $cash$;
revoke all on function pronto_private.cash_totals(uuid,uuid) from public,anon;
grant execute on function pronto_private.cash_totals(uuid,uuid) to authenticated;

create or replace function pronto_private.cash_control(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $cash$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid;v_branch uuid;v_role text;v_id uuid;v_terminal text;
 v_s record;v_required boolean:=true;v_blind boolean:=false;
 v_open bigint;v_counted bigint;v_reason text;v_totals jsonb;
 v_result jsonb;v_items jsonb;v_kind text;v_open_status text;v_target uuid;
begin
 if v_actor is null or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object'
  or pg_column_size(p_data)>8192 then raise exception 'invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_branch:=nullif(p_data->>'branch_id','')::uuid;
 if v_business is null or v_branch is null then raise exception 'missing_scope' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in ('owner','manager','cashier','finance') or v_role is null then
  raise exception 'cash_access_denied' using errcode='42501';end if;
 perform 1 from public.pronto_branches b where b.id=v_branch and b.business_id=v_business and b.active;
 if not found then raise exception 'branch_unavailable' using errcode='42501';end if;
 select coalesce(opening_required,true),coalesce(blind_close,false)
 into v_required,v_blind from public.pronto_cash_policies
 where business_id=v_business and branch_id=v_branch;
 if not found then v_required:=true;v_blind:=false;end if;
 v_id:=nullif(p_data->>'session_id','')::uuid;
 if p_action='settings' then
  return jsonb_build_object('opening_required',v_required,'blind_close',v_blind);
 elsif p_action='configure' then
  if v_role<>'owner' or jsonb_typeof(p_data->'opening_required')<>'boolean'
   or jsonb_typeof(p_data->'blind_close')<>'boolean' then
   raise exception 'owner_required' using errcode='42501';end if;
  insert into public.pronto_cash_policies(business_id,branch_id,opening_required,blind_close,updated_at,updated_by)
   values(v_business,v_branch,(p_data->>'opening_required')::boolean,(p_data->>'blind_close')::boolean,now(),v_actor)
   on conflict(business_id,branch_id) do update set opening_required=excluded.opening_required,
    blind_close=excluded.blind_close,updated_at=now(),updated_by=v_actor;
  v_result:=jsonb_build_object('opening_required',(p_data->>'opening_required')::boolean,
    'blind_close',(p_data->>'blind_close')::boolean);
 elsif p_action='snapshot' then
  select coalesce(jsonb_agg(v.item order by v.created_at desc),'[]'::jsonb) into v_items from (
   select s.opened_at as created_at,
   jsonb_build_object('id',s.id,'business_id',s.business_id,'branch_id',s.branch_id,
    'operator_id',s.operator_id,'operator_name',coalesce(pr.display_name,'Operador'),
    'terminal',s.device_id,'opened_at',s.opened_at,'closed_at',s.closed_at,'closed_by',s.closed_by,
    'status',case when s.status='closed' then 'closed'
      when s.blocked_at is not null then 'blocked'
      when s.close_requested_at is not null then 'pending' else 'open' end,
    'close_type',s.close_type,'close_reason',s.close_reason,
    'opening_cash_cents',s.opening_cash_cents,'counted_cash_cents',s.counted_cash_cents,
    'close_requested_at',s.close_requested_at,
    'expected_cash_cents',case
      when s.status='closed' then s.expected_at_close_cents
      when v_role in ('owner','manager','finance') or not v_blind
       then (pronto_private.cash_totals(v_business,s.id)->>'expected_cash_cents')::bigint
      else null end,
    'payments_by_method',case
      when v_role in ('owner','manager','finance') or s.status='closed' or not v_blind
       then pronto_private.cash_totals(v_business,s.id)->'payments_by_method'
      else null end,
    'difference_cents',case when s.status='closed' and s.counted_cash_cents is not null
     then s.counted_cash_cents-s.expected_at_close_cents else null end) item
   from (select * from public.pronto_cash_sessions
    where business_id=v_business and branch_id=v_branch
      and (v_role in ('owner','manager','finance') or operator_id=v_actor)
    order by opened_at desc limit 100) s
   left join public.pronto_profiles pr on pr.user_id=s.operator_id
  ) v;
  return jsonb_build_object('policy',jsonb_build_object('opening_required',v_required,'blind_close',v_blind),
   'sessions',v_items,'generated_at',now());
 elsif p_action='open' then
  if v_role not in ('owner','manager','cashier') then raise exception 'cash_permission' using errcode='42501';end if;
  v_terminal:=btrim(p_data->>'device_id');
  v_open:=nullif(p_data->>'opening_cash_cents','')::bigint;
  if v_terminal is null or length(v_terminal) not between 2 and 100 or
   v_open is null or v_open<0 or v_open>999999999999 then
    raise exception 'invalid_cash_open' using errcode='22023';end if;
  insert into public.pronto_cash_sessions(business_id,branch_id,operator_id,device_id,opening_cash_cents)
   values(v_business,v_branch,v_actor,v_terminal,v_open) returning id into v_id;
  v_result:=jsonb_build_object('session_id',v_id,'opening_cash_cents',v_open,'status','open');
 else
  if v_id is null then raise exception 'session_required' using errcode='22023';end if;
  select * into v_s from public.pronto_cash_sessions
   where id=v_id and business_id=v_business and branch_id=v_branch for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  if v_s.status<>'open' then raise exception 'cash_already_closed' using errcode='22023';end if;
  if p_action in ('block','unblock','admin_close') then
   if v_role<>'owner' then raise exception 'owner_required' using errcode='42501';end if;
  elsif v_s.operator_id<>v_actor or v_role not in('owner','manager','cashier') then
   raise exception 'cash_permission' using errcode='42501';end if;
  if p_action='request_close' then
   if v_s.blocked_at is not null then raise exception 'cash_blocked' using errcode='42501';end if;
   update public.pronto_cash_sessions set close_requested_at=now(),close_requested_by=v_actor
    where id=v_id;
   v_result:=jsonb_build_object('session_id',v_id,'status','pending');
  elsif p_action='close' then
   if v_s.blocked_at is not null then raise exception 'cash_blocked' using errcode='42501';end if;
   v_counted:=nullif(p_data->>'counted_cash_cents','')::bigint;
   if v_counted is null or v_counted<0 or v_counted>999999999999 then
    raise exception 'invalid_counted_cash' using errcode='22023';end if;
   v_totals:=pronto_private.cash_totals(v_business,v_id);
   update public.pronto_cash_sessions set status='closed',closed_at=now(),
    counted_cash_cents=v_counted,expected_at_close_cents=(v_totals->>'expected_cash_cents')::bigint,
    closed_by=v_actor,close_type=case when v_blind then 'blind' else 'standard' end
    where id=v_id;
   v_result:=v_totals||jsonb_build_object('session_id',v_id,'status','closed',
    'close_type',case when v_blind then 'blind' else 'standard' end,
    'counted_cents',v_counted,'expected_cents',(v_totals->>'expected_cash_cents')::bigint,
    'difference_cents',v_counted-(v_totals->>'expected_cash_cents')::bigint);
  elsif p_action='block' or p_action='unblock' then
   v_reason:=btrim(p_data->>'reason');
   if v_reason is null or length(v_reason) not between 8 and 250 then
    raise exception 'reason_required' using errcode='22023';end if;
   if p_action='block' then
    update public.pronto_cash_sessions set blocked_at=now(),blocked_by=v_actor,blocked_reason=v_reason where id=v_id;
   else
    update public.pronto_cash_sessions set blocked_at=null,blocked_by=null,blocked_reason=null where id=v_id;
   end if;
   v_result:=jsonb_build_object('session_id',v_id,'status',case when p_action='block' then 'blocked' else 'open' end,'reason',v_reason);
  elsif p_action='admin_close' then
   v_reason:=btrim(p_data->>'reason');
   if v_reason is null or length(v_reason) not between 12 and 250 then
    raise exception 'reason_required' using errcode='22023';end if;
   v_totals:=pronto_private.cash_totals(v_business,v_id);
   update public.pronto_cash_sessions set status='closed',closed_at=now(),closed_by=v_actor,
    expected_at_close_cents=(v_totals->>'expected_cash_cents')::bigint,
    close_type='administrative_unchecked',close_reason=v_reason,counted_cash_cents=null where id=v_id;
   v_result:=jsonb_build_object('session_id',v_id,'status','closed',
    'close_type','administrative_unchecked','counted_cents',null,'difference_cents',null,'reason',v_reason);
  else
   raise exception 'unknown_cash_action' using errcode='22023';
  end if;
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values(v_business,v_actor,'cash.'||p_action,
   v_result||jsonb_build_object('branch_id',v_branch));
 return v_result;
end $cash$;
revoke all on function pronto_private.cash_control(text,jsonb) from public,anon;
grant execute on function pronto_private.cash_control(text,jsonb) to authenticated;
create or replace function public.pronto_cash_control(p_action text,p_data jsonb)
returns jsonb language sql set search_path to '' as $wrap$
 select pronto_private.cash_control(p_action,p_data);
$wrap$;
revoke all on function public.pronto_cash_control(text,jsonb) from public,anon;
grant execute on function public.pronto_cash_control(text,jsonb) to authenticated;

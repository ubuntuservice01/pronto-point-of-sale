-- Operational recovery for cashier sessions belonging to a SUSPENDED worker.
-- Only a currently licensed business owner can reconcile them; original sales,
-- debts, stock and payment ledgers remain immutable.
alter table public.pronto_cash_sessions
 add column if not exists emergency_closed_by uuid references auth.users(id),
 add column if not exists emergency_close_reason text,
 add column if not exists emergency_expected_cash_cents bigint,
 add column if not exists emergency_difference_cents bigint;

create or replace function pronto_private.owner_suspended_cash_snapshot(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if (select auth.uid()) is null or p_business is null or
  coalesce(pronto_private.member_role(p_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';end if;
 return pg_catalog.jsonb_build_object('sessions',coalesce((
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',s.id,'branch_id',s.branch_id,'branch_name',b.name,
   'operator_id',s.operator_id,
   'operator_name',coalesce(nullif(pg_catalog.btrim(p.display_name),''),'Colaborador'),
   'opened_at',s.opened_at,'opening_cash_cents',s.opening_cash_cents,
   'expected_cash_cents',s.opening_cash_cents+
    coalesce((select sum(a.amount_cents) from public.pronto_payment_allocations a
     join public.pronto_sales sale on sale.id=a.sale_id and sale.business_id=a.business_id
     where a.business_id=p_business and sale.session_id=s.id and a.method='cash'),0)+
    coalesce((select sum(dp.amount_cents) from public.pronto_debt_payments dp
     where dp.business_id=p_business and dp.session_id=s.id and dp.method='cash'),0)+
    coalesce((select sum(case when m.direction='in' then m.amount_cents else -m.amount_cents end)
     from public.pronto_cash_movements m where m.business_id=p_business and m.session_id=s.id),0))
   order by s.opened_at desc)
   from public.pronto_cash_sessions s
   join public.pronto_memberships membership on membership.business_id=s.business_id
    and membership.user_id=s.operator_id and membership.active=false
    and membership.role<>'owner'
   join public.pronto_branches b on b.id=s.branch_id and b.business_id=s.business_id
   left join public.pronto_profiles p on p.user_id=s.operator_id
   where s.business_id=p_business and s.status='open'
   ),'[]'::jsonb),
  'generated_at',now());
end $$;
revoke all on function pronto_private.owner_suspended_cash_snapshot(uuid)
 from public,anon,authenticated;
grant execute on function pronto_private.owner_suspended_cash_snapshot(uuid) to authenticated;
create or replace function public.pronto_owner_suspended_cash_snapshot(p_business uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.owner_suspended_cash_snapshot(p_business);$$;
revoke all on function public.pronto_owner_suspended_cash_snapshot(uuid)
 from public,anon,authenticated;
grant execute on function public.pronto_owner_suspended_cash_snapshot(uuid) to authenticated;

create or replace function pronto_private.owner_suspended_cash_close(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid;v_session uuid;v_counted bigint;v_reason text;
 v_cash record;v_expected bigint;v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_session:=nullif(p_data->>'session_id','')::uuid;
 v_counted:=nullif(p_data->>'counted_cash_cents','')::bigint;
 v_reason:=pg_catalog.btrim(p_data->>'reason');
 if v_business is null or v_session is null or v_counted is null or
  v_counted<0 or v_counted>999999999999 or v_reason is null or
  length(v_reason) not between 12 and 250 then
  raise exception 'invalid_emergency_reconciliation' using errcode='22023';end if;
 if coalesce(pronto_private.member_role(v_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';end if;
 select s.id,s.operator_id,s.branch_id,s.status,s.opening_cash_cents,
   s.counted_cash_cents,s.emergency_closed_by,s.emergency_close_reason,
   s.emergency_expected_cash_cents,s.emergency_difference_cents
 into v_cash from public.pronto_cash_sessions s where s.id=v_session
  and s.business_id=v_business for update;
 if not found then raise exception 'cash_session_not_found' using errcode='22023';end if;
 if v_cash.status='closed' and v_cash.emergency_closed_by=v_actor and
   v_cash.counted_cash_cents=v_counted and v_cash.emergency_close_reason=v_reason then
  return pg_catalog.jsonb_build_object('session_id',v_session,'duplicate',true,
   'expected_cents',v_cash.emergency_expected_cash_cents,
   'counted_cents',v_counted,'difference_cents',v_cash.emergency_difference_cents);
 end if;
 if v_cash.status<>'open' or v_cash.operator_id=v_actor then
  raise exception 'cash_session_unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.pronto_memberships m
  where m.business_id=v_business and m.user_id=v_cash.operator_id
    and m.active=false and m.role<>'owner') then
  raise exception 'operator_not_suspended' using errcode='42501';end if;
 -- Same ledger arithmetic as the live credit-aware cash_close path.
 v_expected:=v_cash.opening_cash_cents+
  coalesce((select sum(a.amount_cents) from public.pronto_payment_allocations a
   join public.pronto_sales sale on sale.id=a.sale_id and sale.business_id=a.business_id
   where a.business_id=v_business and sale.session_id=v_session and a.method='cash'),0)+
  coalesce((select sum(dp.amount_cents) from public.pronto_debt_payments dp
   where dp.business_id=v_business and dp.session_id=v_session and dp.method='cash'),0)+
  coalesce((select sum(case when m.direction='in' then m.amount_cents else -m.amount_cents end)
   from public.pronto_cash_movements m where m.business_id=v_business and m.session_id=v_session),0);
 update public.pronto_cash_sessions set
  status='closed',counted_cash_cents=v_counted,closed_at=now(),
  emergency_closed_by=v_actor,emergency_close_reason=v_reason,
  emergency_expected_cash_cents=v_expected,emergency_difference_cents=v_counted-v_expected
  where id=v_session and business_id=v_business and status='open';
 if not found then raise exception 'cash_session_changed' using errcode='40001';end if;
 v_result:=pg_catalog.jsonb_build_object('session_id',v_session,'duplicate',false,
  'expected_cents',v_expected,'counted_cents',v_counted,
  'difference_cents',v_counted-v_expected,'suspended_operator',v_cash.operator_id);
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'team.staff_cash_emergency_closed',v_result||
   pg_catalog.jsonb_build_object('reason',v_reason));
 return v_result;
end $$;
revoke all on function pronto_private.owner_suspended_cash_close(jsonb)
 from public,anon,authenticated;
grant execute on function pronto_private.owner_suspended_cash_close(jsonb) to authenticated;
create or replace function public.pronto_owner_suspended_cash_close(p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.owner_suspended_cash_close(p_data);$$;
revoke all on function public.pronto_owner_suspended_cash_close(jsonb)
 from public,anon,authenticated;
grant execute on function public.pronto_owner_suspended_cash_close(jsonb) to authenticated;

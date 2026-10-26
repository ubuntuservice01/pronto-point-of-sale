-- Merchant may read only its own trial, never another merchant's contact details.
create or replace function pronto_private.my_trial_status(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v jsonb;
begin
 if (select auth.uid()) is null or not exists(
  select 1 from public.pronto_memberships m where m.user_id=(select auth.uid()) and m.business_id=p_business_id and m.role='owner' and m.active
 ) then raise exception 'not_authorized' using errcode='42501'; end if;
 select pg_catalog.jsonb_build_object('expires_at',s.expires_at,'started_at',t.started_at,
 'trial_expires_at',t.expires_at,'is_trial',s.plan_id=(select id from public.pronto_plans
 where name='Teste gratuito · 10 dias' order by id limit 1),
 'expired',s.expires_at<=now() or s.cancelled)
 into v from pronto_private.self_service_trials t
 join public.pronto_subscriptions s on s.business_id=t.business_id
 where t.business_id=p_business_id;
 return coalesce(v,'null'::jsonb);
end;$$;
revoke all on function pronto_private.my_trial_status(uuid) from public,anon,authenticated;
grant execute on function pronto_private.my_trial_status(uuid) to authenticated;
create or replace function public.pronto_my_trial_status(p_business_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$ select pronto_private.my_trial_status(p_business_id); $$;
revoke all on function public.pronto_my_trial_status(uuid) from public,anon,authenticated;
grant execute on function public.pronto_my_trial_status(uuid) to authenticated;
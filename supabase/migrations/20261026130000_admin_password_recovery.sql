-- Owner-authorised support recovery. This function never sets a password.
-- All decisions use the verified JWT identity, not caller-provided roles.
create or replace function pronto_private.admin_password_recovery(
 p_business uuid,p_target uuid,p_reason text,p_verified boolean,p_stage text)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());
begin
 if v_actor is null or not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';
 end if;
 if p_business is null or p_target is null or p_target=v_actor
  or not coalesce(p_verified,false) or char_length(trim(coalesce(p_reason,''))) not between 10 and 500
  or p_stage not in ('requested','completed') then
  raise exception 'invalid_recovery_request' using errcode='22023';
 end if;
 if not exists(select 1 from public.pronto_memberships m
    where m.business_id=p_business and m.user_id=p_target)
  or not exists(select 1 from auth.users u where u.id=p_target)
  or exists(select 1 from pronto_private.ubuntu_super_admins a where a.user_id=p_target) then
  raise exception 'recovery_target_not_allowed' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pronto_reset:'||p_target::text,0));
 if p_stage='requested' then
  if (select count(*) from pronto_private.admin_control_log l
       where l.action='password_reset_requested'
        and l.details->>'target_user_id'=p_target::text
        and l.created_at>now()-interval '10 minutes')>=2 then
   raise exception 'recovery_rate_limited' using errcode='22023';
  end if;
 else
  if not exists(select 1 from pronto_private.admin_control_log l
   where l.action='password_reset_requested' and l.actor_id=v_actor
     and l.business_id=p_business and l.details->>'target_user_id'=p_target::text
     and l.created_at>now()-interval '5 minutes') then
   raise exception 'recovery_request_expired' using errcode='22023';
  end if;
 end if;
 insert into pronto_private.admin_control_log(actor_id,business_id,action,reason,details)
 values(v_actor,p_business,'password_reset_'||p_stage,trim(p_reason),
  pg_catalog.jsonb_build_object('target_user_id',p_target::text,'verified_by_admin',true));
 return true;
end;
$$;
revoke all on function pronto_private.admin_password_recovery(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function pronto_private.admin_password_recovery(uuid,uuid,text,boolean,text) to authenticated;
create or replace function public.pronto_admin_password_recovery(
 p_business uuid,p_target uuid,p_reason text,p_verified boolean,p_stage text)
returns boolean language sql volatile security invoker set search_path=''
as $$select pronto_private.admin_password_recovery(p_business,p_target,p_reason,p_verified,p_stage);$$;
revoke all on function public.pronto_admin_password_recovery(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.pronto_admin_password_recovery(uuid,uuid,text,boolean,text) to authenticated;

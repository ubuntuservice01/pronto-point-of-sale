-- Treat missing memberships as DENIED, never SQL NULL in owner role checks.
-- Shop owners may invite non-owner staff, but never create global administrators.
-- These RPCs are scoped to the authenticated owner's active, licensed business.
create or replace function pronto_private.owner_invite_allowed(p_business uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select p_business is not null and coalesce(pronto_private.member_role(p_business)='owner',false);
$$;
revoke all on function pronto_private.owner_invite_allowed(uuid) from public,anon,authenticated;
grant execute on function pronto_private.owner_invite_allowed(uuid) to authenticated;
create or replace function public.pronto_owner_invite_allowed(p_business uuid)
returns boolean language sql stable security invoker set search_path=''
as $$select pronto_private.owner_invite_allowed(p_business);$$;
revoke all on function public.pronto_owner_invite_allowed(uuid) from public,anon,authenticated;
grant execute on function public.pronto_owner_invite_allowed(uuid) to authenticated;

create or replace function pronto_private.owner_assign_staff(
 p_business uuid,p_user uuid,p_display_name text,p_role text
) returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_name text:=pg_catalog.btrim(p_display_name);
begin
 if v_actor is null or p_business is null or p_user is null or
  coalesce(pronto_private.member_role(p_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';
 end if;
 if p_role not in ('manager','cashier','stock','finance') or
  v_name is null or length(v_name) not between 2 and 120 or p_user=v_actor then
  raise exception 'invalid_team_member' using errcode='22023';
 end if;
 if not exists(select 1 from auth.users where id=p_user and is_anonymous=false) then
  raise exception 'unknown_auth_user' using errcode='22023';
 end if;
 if exists(select 1 from pronto_private.ubuntu_super_admins where user_id=p_user and active) then
  raise exception 'global_admin_cannot_join_shop' using errcode='22023';
 end if;
 -- Serialise membership changes for this business with commercial onboarding.
 perform 1 from public.pronto_businesses where id=p_business and status='active' for update;
 if not found then raise exception 'shop_inactive' using errcode='42501'; end if;
 if exists(select 1 from public.pronto_memberships
   where business_id=p_business and user_id=p_user and role='owner' and active) then
  raise exception 'cannot_modify_owner' using errcode='42501';
 end if;
 insert into public.pronto_profiles(user_id,display_name)
  values(p_user,v_name)
  on conflict(user_id) do update set display_name=excluded.display_name,updated_at=now();
 insert into public.pronto_memberships(business_id,user_id,role,active)
  values(p_business,p_user,p_role,true)
  on conflict(business_id,user_id) do update set role=excluded.role,active=true;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(p_business,v_actor,'team.staff_assigned',
   pg_catalog.jsonb_build_object('user_id',p_user,'role',p_role));
 return pg_catalog.jsonb_build_object('business_id',p_business,'user_id',p_user,'role',p_role);
end;
$$;
revoke all on function pronto_private.owner_assign_staff(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function pronto_private.owner_assign_staff(uuid,uuid,text,text) to authenticated;
create or replace function public.pronto_owner_assign_staff(
 p_business uuid,p_user uuid,p_display_name text,p_role text
) returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.owner_assign_staff(p_business,p_user,p_display_name,p_role);$$;
revoke all on function public.pronto_owner_assign_staff(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pronto_owner_assign_staff(uuid,uuid,text,text) to authenticated;

-- Gestão de colaboradores por empresa com revogação imediata das permissões
-- de negócio. O token Supabase Auth pode continuar válido, mas os RPCs e as
-- políticas RLS validam a associação activa a cada chamada.
create or replace function pronto_private.owner_staff_snapshot(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if (select auth.uid()) is null or
  coalesce(pronto_private.member_role(p_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';end if;
 return pg_catalog.jsonb_build_object(
  'staff',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'user_id',m.user_id,'name',p.display_name,'email',au.email,
    'role',m.role,'active',m.active,'joined_at',m.created_at)
    order by p.display_name)
   from (select * from public.pronto_memberships
    where business_id=p_business and role<>'owner' order by created_at limit 250) m
   join auth.users au on au.id=m.user_id
   left join public.pronto_profiles p on p.user_id=m.user_id),'[]'::jsonb),
  'generated_at',now());
end $$;
revoke all on function pronto_private.owner_staff_snapshot(uuid) from public,anon,authenticated;
grant execute on function pronto_private.owner_staff_snapshot(uuid) to authenticated;
create or replace function public.pronto_owner_staff_snapshot(p_business uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.owner_staff_snapshot(p_business);$$;
revoke all on function public.pronto_owner_staff_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.pronto_owner_staff_snapshot(uuid) to authenticated;

create or replace function pronto_private.owner_staff_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid;
 v_target uuid;
 v_old record;
 v_new_role text;
 v_new_active boolean;
 v_changed boolean;
 v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>4096 then raise exception 'invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_target:=nullif(p_data->>'user_id','')::uuid;
 if v_business is null or v_target is null or v_target=v_actor or
  coalesce(pronto_private.member_role(v_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';end if;
 if p_action not in('role_change','suspend','reactivate') then
  raise exception 'invalid_staff_action' using errcode='22023';end if;
 select role,active into v_old from public.pronto_memberships
  where business_id=v_business and user_id=v_target for update;
 if not found then raise exception 'staff_not_found' using errcode='22023';end if;
 if v_old.role='owner' then raise exception 'cannot_modify_owner' using errcode='42501';end if;
 if exists(select 1 from pronto_private.ubuntu_super_admins
  where user_id=v_target and active) then
  raise exception 'cannot_modify_global_admin' using errcode='42501';end if;
 v_new_role:=v_old.role;
 v_new_active:=v_old.active;
 if p_action='role_change' then
  v_new_role:=p_data->>'role';
  if v_new_role not in('manager','cashier','stock','finance') or v_new_role is null then
   raise exception 'invalid_staff_role' using errcode='22023';end if;
 elsif p_action='suspend' then
  v_new_active:=false;
 else
  v_new_active:=true;
 end if;
 v_changed:=(v_new_role is distinct from v_old.role or v_new_active is distinct from v_old.active);
 if v_changed then
  update public.pronto_memberships set role=v_new_role,active=v_new_active
   where business_id=v_business and user_id=v_target;
 end if;
 v_result:=pg_catalog.jsonb_build_object('user_id',v_target,'role',v_new_role,
  'active',v_new_active,'changed',v_changed);
 if v_changed then
  insert into public.pronto_audit_events(business_id,actor_id,event,payload)
   values(v_business,v_actor,'team.'||p_action,
    v_result||pg_catalog.jsonb_build_object('old_role',v_old.role,'old_active',v_old.active));
 end if;
 return v_result;
end $$;
revoke all on function pronto_private.owner_staff_action(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.owner_staff_action(text,jsonb) to authenticated;
create or replace function public.pronto_owner_staff_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.owner_staff_action(p_action,p_data);$$;
revoke all on function public.pronto_owner_staff_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_owner_staff_action(text,jsonb) to authenticated;

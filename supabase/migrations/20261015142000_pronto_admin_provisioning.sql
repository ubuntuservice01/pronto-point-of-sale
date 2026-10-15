-- Pronto POS Phase 2: trusted, auditable commercial provisioning.
-- Never write financial transactions, stock or Supabase Auth users via browser.
create table pronto_private.admin_actions (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id),
 action text not null,
 business_id uuid references public.pronto_businesses(id),
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
revoke all on pronto_private.admin_actions from public, anon, authenticated;
alter table pronto_private.admin_actions enable row level security;

-- A non-admin employee obtains no shop data unless the licence is active.
create or replace function pronto_private.member_role(target_business uuid)
returns text language sql stable security definer set search_path=''
as $$
 select m.role
 from public.pronto_memberships m
 join public.pronto_businesses b on b.id=m.business_id
 join public.pronto_subscriptions s on s.business_id=b.id
 where m.business_id=target_business
 and m.user_id=(select auth.uid()) and m.active
 and b.status='active' and not s.cancelled and s.expires_at>now()
 limit 1
$$;
revoke all on function pronto_private.member_role(uuid) from public, anon, authenticated;
grant execute on function pronto_private.member_role(uuid) to authenticated;

-- This database operation runs as ONE PostgreSQL transaction per RPC invocation.
-- The invoker can never nominate another actor; all audit actors come from auth.uid().
create or replace function pronto_private.admin_mutation(p_action text,p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_business uuid;
 v_branch uuid;
 v_plan uuid;
 v_user uuid;
 v_role text;
 v_name text;
 v_days integer;
 v_cost bigint;
 v_expires timestamptz;
 v_status text;
 v_result jsonb;
 v_count integer;
begin
 if v_actor is null or not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';
 end if;
 if p_action is null or length(p_action)>48 or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or pg_catalog.pg_column_size(p_data)>8192 then
  raise exception 'invalid_payload' using errcode='22023';
 end if;

 if p_action='plan_create' then
  v_name:=pg_catalog.btrim(p_data->>'name');
  v_cost:=(p_data->>'price_cents')::bigint;
  v_days:=(p_data->>'duration_days')::integer;
  if v_name is null or length(v_name) not between 2 and 100 or v_cost is null or v_cost<0 or v_cost>999999999999 or v_days is null or v_days not between 1 and 3660 then
   raise exception 'invalid_plan' using errcode='22023';
  end if;
  insert into public.pronto_plans(name,price_cents,duration_days)
   values(v_name,v_cost,v_days) returning id into v_plan;
  v_result:=pg_catalog.jsonb_build_object('id',v_plan,'name',v_name);

 elsif p_action='business_create' then
  v_name:=pg_catalog.btrim(p_data->>'name');
  if v_name is null or length(v_name) not between 2 and 120 then
   raise exception 'invalid_business' using errcode='22023';
  end if;
  if length(coalesce(p_data->>'phone',''))>60 or length(coalesce(p_data->>'address',''))>250 then
   raise exception 'invalid_business' using errcode='22023';
  end if;
  -- New businesses start suspended until a verified owner AND licence exist.
  insert into public.pronto_businesses(name,phone,address,status)
   values(v_name,nullif(pg_catalog.btrim(p_data->>'phone'),''),nullif(pg_catalog.btrim(p_data->>'address'),''),'suspended')
   returning id into v_business;
  v_name:=coalesce(nullif(pg_catalog.btrim(p_data->>'branch_name'),''),'Principal');
  if length(v_name)>120 then raise exception 'invalid_branch' using errcode='22023'; end if;
  insert into public.pronto_branches(business_id,name)
   values(v_business,v_name) returning id into v_branch;
  v_result:=pg_catalog.jsonb_build_object('id',v_business,'branch_id',v_branch,'status','suspended');

 elsif p_action='member_assign' then
  v_business:=(p_data->>'business_id')::uuid;
  v_user:=(p_data->>'user_id')::uuid;
  v_role:=p_data->>'role';
  v_name:=pg_catalog.btrim(p_data->>'display_name');
  if v_role is null or v_role not in ('owner','manager','cashier','stock','finance') or
   v_name is null or length(v_name) not between 2 and 120 then
   raise exception 'invalid_member' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users u where u.id=v_user) then
   raise exception 'unknown_auth_user' using errcode='22023';
  end if;
  -- Never attach the Ubuntu global super administrator as a merchant employee.
  if exists(select 1 from pronto_private.ubuntu_super_admins u where u.user_id=v_user and u.active) then
   raise exception 'global_admin_cannot_join_shop' using errcode='22023';
  end if;
  perform 1 from public.pronto_businesses where id=v_business for update;
  if not found then raise exception 'unknown_business' using errcode='22023'; end if;
  insert into public.pronto_profiles(user_id,display_name)
   values(v_user,v_name)
   on conflict(user_id) do update set display_name=excluded.display_name,updated_at=now();
  insert into public.pronto_memberships(business_id,user_id,role,active)
   values(v_business,v_user,v_role,true)
   on conflict(business_id,user_id) do update set role=excluded.role,active=true;
  -- If the first owner is now present and a valid licence exists, enable the shop.
  if v_role='owner' and exists(
   select 1 from public.pronto_subscriptions s where s.business_id=v_business and not s.cancelled and s.expires_at>now()
  ) then
   update public.pronto_businesses set status='active' where id=v_business;
  end if;
  v_result:=pg_catalog.jsonb_build_object('business_id',v_business,'user_id',v_user,'role',v_role);

 elsif p_action='member_deactivate' then
  v_business:=(p_data->>'business_id')::uuid;
  v_user:=(p_data->>'user_id')::uuid;
  perform 1 from public.pronto_businesses where id=v_business for update;
  if not found then raise exception 'unknown_business' using errcode='22023'; end if;
  -- Prevent removal of the last active owner.
  if exists(select 1 from public.pronto_memberships
   where business_id=v_business and user_id=v_user and role='owner' and active)
   and (select count(*) from public.pronto_memberships where business_id=v_business and role='owner' and active)<=1
  then raise exception 'last_owner' using errcode='22023'; end if;
  update public.pronto_memberships set active=false
   where business_id=v_business and user_id=v_user and active;
  if not found then raise exception 'unknown_member' using errcode='22023'; end if;
  v_result:=pg_catalog.jsonb_build_object('user_id',v_user,'active',false);

 elsif p_action='license_assign' or p_action='license_renew' then
  v_business:=(p_data->>'business_id')::uuid;
  v_plan:=(p_data->>'plan_id')::uuid;
  perform 1 from public.pronto_businesses where id=v_business for update;
  if not found then raise exception 'unknown_business' using errcode='22023'; end if;
  select duration_days into v_days from public.pronto_plans where id=v_plan and active;
  if not found then raise exception 'plan_unavailable' using errcode='22023'; end if;
  if p_action='license_renew' then
   select greatest(now(),s.expires_at) into v_expires
    from public.pronto_subscriptions s where s.business_id=v_business for update;
   if not found then raise exception 'license_missing' using errcode='22023'; end if;
  else
   v_expires:=now();
  end if;
  v_expires:=v_expires+pg_catalog.make_interval(days=>v_days);
  insert into public.pronto_subscriptions(business_id,plan_id,expires_at,cancelled)
   values(v_business,v_plan,v_expires,false)
   on conflict(business_id) do update
    set plan_id=excluded.plan_id,expires_at=excluded.expires_at,cancelled=false;
  if exists(select 1 from public.pronto_memberships m
   where m.business_id=v_business and m.role='owner' and m.active) then
   update public.pronto_businesses set status='active' where id=v_business;
  end if;
  v_result:=pg_catalog.jsonb_build_object('business_id',v_business,'plan_id',v_plan,'expires_at',v_expires);

 elsif p_action='license_cancel' then
  v_business:=(p_data->>'business_id')::uuid;
  update public.pronto_subscriptions set cancelled=true where business_id=v_business;
  if not found then raise exception 'license_missing' using errcode='22023'; end if;
  update public.pronto_businesses set status='suspended' where id=v_business;
  v_result:=pg_catalog.jsonb_build_object('business_id',v_business,'cancelled',true);

 elsif p_action='business_suspend' then
  v_business:=(p_data->>'business_id')::uuid;
  update public.pronto_businesses set status='suspended' where id=v_business;
  if not found then raise exception 'unknown_business' using errcode='22023'; end if;
  v_result:=pg_catalog.jsonb_build_object('business_id',v_business,'status','suspended');

 elsif p_action='business_activate' then
  v_business:=(p_data->>'business_id')::uuid;
  if not exists(select 1 from public.pronto_memberships m join public.pronto_subscriptions s on s.business_id=m.business_id
   where m.business_id=v_business and m.role='owner' and m.active and not s.cancelled and s.expires_at>now()) then
   raise exception 'owner_and_license_required' using errcode='22023';
  end if;
  update public.pronto_businesses set status='active' where id=v_business;
  if not found then raise exception 'unknown_business' using errcode='22023'; end if;
  v_result:=pg_catalog.jsonb_build_object('business_id',v_business,'status','active');

 else
  raise exception 'unknown_admin_action' using errcode='22023';
 end if;

 insert into pronto_private.admin_actions(actor_id,action,business_id,payload)
  values(v_actor,p_action,v_business,
   pg_catalog.jsonb_build_object('result',v_result,'at',now()));

 if v_business is not null then
  insert into public.pronto_audit_events(business_id,actor_id,event,payload)
   values(v_business,v_actor,'admin.'||p_action,v_result);
 end if;
 return v_result;
end
$$;
revoke all on function pronto_private.admin_mutation(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.admin_mutation(text,jsonb) to authenticated;

create or replace function public.pronto_admin_mutation(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$ select pronto_private.admin_mutation(p_action,p_data); $$;
revoke all on function public.pronto_admin_mutation(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_admin_mutation(text,jsonb) to authenticated;

-- The global administrator may view only *provisioning metadata*.
-- Keep merchant sales, customers, stock and receipt data out of this RPC.
create or replace function pronto_private.ubuntu_admin_overview()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare payload jsonb;
begin
 if not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';
 end if;
 select pg_catalog.jsonb_build_object(
  'businesses',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',b.id,'name',b.name,'status',b.status,'phone',coalesce(b.phone,''),
    'address',coalesce(b.address,''),'created_at',b.created_at,
    'branches',(select count(*) from public.pronto_branches br where br.business_id=b.id),
    'operators',(select count(*) from public.pronto_memberships m where m.business_id=b.id and m.active),
    'plan_name',p.name,'plan_id',s.plan_id,'expires_at',s.expires_at,'license_cancelled',s.cancelled,
    'members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id',m.user_id,'role',m.role,'active',m.active,
      'name',coalesce(prof.display_name,''),
      'email',coalesce(au.email,'')
     ) order by m.created_at,m.user_id)
      from public.pronto_memberships m
      left join public.pronto_profiles prof on prof.user_id=m.user_id
      join auth.users au on au.id=m.user_id
      where m.business_id=b.id),'[]'::jsonb)
   ) order by b.created_at desc,b.id)
   from public.pronto_businesses b
   left join public.pronto_subscriptions s on s.business_id=b.id
   left join public.pronto_plans p on p.id=s.plan_id
  ),'[]'::jsonb),
  'plans',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id,'name',p.name,'price_cents',p.price_cents,'duration_days',p.duration_days,'active',p.active
   ) order by p.name,p.id) from public.pronto_plans p
  ),'[]'::jsonb),
  'generated_at',now()
 ) into payload;
 return payload;
end$$;
revoke all on function pronto_private.ubuntu_admin_overview() from public,anon,authenticated;
grant execute on function pronto_private.ubuntu_admin_overview() to authenticated;

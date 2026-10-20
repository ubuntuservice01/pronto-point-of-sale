-- Staff access scheduling and remote override for the Supabase-backed Pronto POS.
-- Backward compatible: employees without a rule retain current access.
-- Local shop time: Africa/Maputo. Weekdays: 0=Sunday .. 6=Saturday.
create table public.pronto_staff_access_rules (
 business_id uuid not null,
 user_id uuid not null,
 schedule_enabled boolean not null default false,
 start_time time without time zone not null default '07:00',
 end_time time without time zone not null default '19:00',
 weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
 manual_mode text not null default 'auto'
  check (manual_mode in ('auto','allow','block')),
 updated_at timestamptz not null default now(),
 updated_by uuid,
 primary key (business_id,user_id),
 foreign key (business_id,user_id)
  references public.pronto_memberships(business_id,user_id) on delete cascade,
 constraint staff_access_different_hours check (start_time <> end_time),
 constraint staff_access_valid_days check (
  cardinality(weekdays) between 1 and 7
  and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  and array_position(weekdays,null) is null
 )
);
alter table public.pronto_staff_access_rules enable row level security;
revoke all on public.pronto_staff_access_rules from public, anon, authenticated;
comment on table public.pronto_staff_access_rules is
 'Owner-managed staff schedule and remote override; writes/reads exclusively through checked RPCs.';

create function pronto_private.staff_time_matches(
 p_days smallint[], p_start time, p_end time, p_local timestamp
) returns boolean language sql immutable set search_path = '' as $$
 select case when p_start < p_end
 then (extract(dow from p_local)::smallint = any(p_days)
       and p_local::time >= p_start and p_local::time < p_end)
 else ((extract(dow from p_local)::smallint = any(p_days) and p_local::time >= p_start)
   or (((extract(dow from p_local)::integer + 6) % 7)::smallint = any(p_days)
        and p_local::time < p_end))
 end
$$;

create function pronto_private.staff_access_allowed(p_business uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((
  select case r.manual_mode
   when 'block' then false
   when 'allow' then true
   else (not r.schedule_enabled or pronto_private.staff_time_matches(
      r.weekdays, r.start_time, r.end_time, now() at time zone 'Africa/Maputo'))
   end
  from public.pronto_staff_access_rules r
  where r.business_id=p_business and r.user_id=p_user
 ),true)
$$;
revoke all on function pronto_private.staff_time_matches(smallint[],time,time,timestamp) from public,anon,authenticated;
revoke all on function pronto_private.staff_access_allowed(uuid,uuid) from public,anon,authenticated;

-- All RLS merchant data, storage and protected RPCs use the same membership gate.
-- Owners are not subject to employee schedules. Suspensions and subscriptions still win.
create or replace function pronto_private.member_role(target_business uuid)
returns text language sql stable security definer set search_path = '' as $$
 select m.role
 from public.pronto_memberships m
 join public.pronto_businesses b on b.id=m.business_id
 join public.pronto_subscriptions s on s.business_id=b.id
 where m.business_id=target_business and m.user_id=(select auth.uid())
  and m.active and b.status='active'
  and not s.cancelled and s.expires_at>now()
  and (m.role='owner' or pronto_private.staff_access_allowed(m.business_id,m.user_id))
 limit 1
$$;

create function pronto_private.owner_staff_access_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid;
 v_target uuid;
 v_role text;
 v_mode text;
 v_enabled boolean;
 v_start time;
 v_end time;
 v_days smallint[];
 v_count integer;
 v_unique integer;
 v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'invalid_request' using errcode='22023';
 end if;
 if (p_data->>'business_id') is null or (p_data->>'user_id') is null then
  raise exception 'invalid_scope' using errcode='22023';
 end if;
 v_business:=(p_data->>'business_id')::uuid;
 v_target:=(p_data->>'user_id')::uuid;
 if v_business is null or v_target is null or v_target=v_actor or
  coalesce(pronto_private.member_role(v_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';
 end if;
 select role into v_role from public.pronto_memberships
  where business_id=v_business and user_id=v_target for update;
 if not found or v_role='owner' or
  exists(select 1 from pronto_private.ubuntu_super_admins where user_id=v_target and active) then
  raise exception 'staff_required' using errcode='42501';
 end if;
 if p_action='mode' then
  v_mode:=p_data->>'manual_mode';
  if v_mode is null or v_mode not in ('auto','allow','block') then
   raise exception 'invalid_mode' using errcode='22023';
  end if;
  insert into public.pronto_staff_access_rules(business_id,user_id,manual_mode,updated_by)
   values(v_business,v_target,v_mode,v_actor)
  on conflict (business_id,user_id) do update
   set manual_mode=excluded.manual_mode,updated_by=v_actor,updated_at=now();
 elsif p_action='schedule' then
  if p_data->>'schedule_enabled' not in ('true','false')
   or coalesce(p_data->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(p_data->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or jsonb_typeof(p_data->'weekdays') is distinct from 'array' then
   raise exception 'invalid_schedule' using errcode='22023';
  end if;
  v_enabled:=(p_data->>'schedule_enabled')::boolean;
  v_start:=(p_data->>'start_time')::time;
  v_end:=(p_data->>'end_time')::time;
  if v_start=v_end then raise exception 'same_hours' using errcode='22023';end if;
  select array_agg(n::smallint order by n::smallint),count(*),count(distinct n)
  into v_days,v_count,v_unique
  from jsonb_array_elements_text(p_data->'weekdays') as e(n)
  where n ~ '^[0-6]$';
  if v_count <> jsonb_array_length(p_data->'weekdays') or
    v_count not between 1 and 7 or v_count<>v_unique then
   raise exception 'invalid_weekdays' using errcode='22023';
  end if;
  insert into public.pronto_staff_access_rules(
   business_id,user_id,schedule_enabled,start_time,end_time,weekdays,updated_by)
   values(v_business,v_target,v_enabled,v_start,v_end,v_days,v_actor)
  on conflict (business_id,user_id) do update
   set schedule_enabled=excluded.schedule_enabled,start_time=excluded.start_time,
   end_time=excluded.end_time,weekdays=excluded.weekdays,updated_by=v_actor,updated_at=now();
 else
  raise exception 'invalid_action' using errcode='22023';
 end if;
 select jsonb_build_object(
  'business_id',business_id,'user_id',user_id,'manual_mode',manual_mode,
  'schedule_enabled',schedule_enabled,'start_time',to_char(start_time,'HH24:MI'),
  'end_time',to_char(end_time,'HH24:MI'),'weekdays',weekdays,
  'allowed_now',pronto_private.staff_access_allowed(business_id,user_id))
 into v_result
 from public.pronto_staff_access_rules where business_id=v_business and user_id=v_target;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values(v_business,v_actor,'team.access_'||p_action,v_result);
 return v_result;
end $$
;

create function public.pronto_owner_staff_access_action(p_action text,p_data jsonb)
returns jsonb language sql set search_path = '' as $$
 select pronto_private.owner_staff_access_action(p_action,p_data)
$$;
revoke all on function pronto_private.owner_staff_access_action(text,jsonb) from public,anon;
grant execute on function pronto_private.owner_staff_access_action(text,jsonb) to authenticated;
revoke all on function public.pronto_owner_staff_access_action(text,jsonb) from public,anon;
grant execute on function public.pronto_owner_staff_access_action(text,jsonb) to authenticated;

create function pronto_private.my_access_status(p_business uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 v_user uuid:=(select auth.uid());
 v_m record;
 v_rule record;
 v_reason text;
 v_allowed boolean;
begin
 if v_user is null then raise exception 'auth_required' using errcode='42501';end if;
 select m.business_id,m.role,m.active,b.status as business_status,
  s.cancelled,s.expires_at into v_m
 from public.pronto_memberships m
 join public.pronto_businesses b on b.id=m.business_id
 left join public.pronto_subscriptions s on s.business_id=m.business_id
 where m.user_id=v_user and (p_business is null or m.business_id=p_business)
 order by m.created_at desc limit 1;
 if not found then
  return jsonb_build_object('allowed',false,'reason','not_associated','server_time',now());
 end if;
 select r.* into v_rule from public.pronto_staff_access_rules r
  where r.business_id=v_m.business_id and r.user_id=v_user;
 v_reason:=case
  when not v_m.active then 'suspended'
  when v_m.business_status<>'active' or v_m.cancelled is distinct from false
   or v_m.expires_at is null or v_m.expires_at<=now() then 'business_unavailable'
  when v_m.role='owner' then 'open'
  when v_rule.manual_mode='block' then 'blocked'
  when not pronto_private.staff_access_allowed(v_m.business_id,v_user) then 'outside_schedule'
  else 'open' end;
 v_allowed:=v_reason='open';
 return jsonb_build_object(
  'business_id',v_m.business_id,'allowed',v_allowed,'reason',v_reason,
  'server_time',now(),'time_zone','Africa/Maputo');
end $$
;
create function public.pronto_my_access_status(p_business uuid default null)
returns jsonb language sql stable set search_path = '' as $$
 select pronto_private.my_access_status(p_business)
$$;
revoke all on function pronto_private.my_access_status(uuid) from public,anon;
grant execute on function pronto_private.my_access_status(uuid) to authenticated;
revoke all on function public.pronto_my_access_status(uuid) from public,anon;
grant execute on function public.pronto_my_access_status(uuid) to authenticated;

create or replace function pronto_private.owner_staff_snapshot(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if (select auth.uid()) is null or
  coalesce(pronto_private.member_role(p_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';
 end if;
 return jsonb_build_object(
  'staff',coalesce((
   select jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,'name',p.display_name,'email',au.email,
    'role',m.role,'active',m.active,'joined_at',m.created_at,
    'manual_mode',coalesce(r.manual_mode,'auto'),
    'schedule_enabled',coalesce(r.schedule_enabled,false),
    'start_time',coalesce(to_char(r.start_time,'HH24:MI'),'07:00'),
    'end_time',coalesce(to_char(r.end_time,'HH24:MI'),'19:00'),
    'weekdays',coalesce(to_jsonb(r.weekdays),'[0,1,2,3,4,5,6]'::jsonb),
    'allowed_now',m.active and pronto_private.staff_access_allowed(m.business_id,m.user_id)
   ) order by p.display_name)
   from (select * from public.pronto_memberships
    where business_id=p_business and role<>'owner' order by created_at limit 250) m
   join auth.users au on au.id=m.user_id
   left join public.pronto_profiles p on p.user_id=m.user_id
   left join public.pronto_staff_access_rules r
    on r.business_id=m.business_id and r.user_id=m.user_id),'[]'::jsonb),
  'generated_at',now());
end $$
;

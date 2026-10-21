-- Super Admin 360: only additive schema, no cascade delete of merchant financial records.
alter table public.pronto_businesses
 add column if not exists archived_at timestamptz,
 add column if not exists removed_at timestamptz;

create table if not exists pronto_private.admin_control_log (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 actor_id uuid not null references auth.users(id),
 business_id uuid references public.pronto_businesses(id),
 action text not null,
 reason text not null,
 details jsonb not null default '{}'::jsonb
);
revoke all on pronto_private.admin_control_log from public,anon,authenticated;
create index if not exists pronto_admin_control_log_date
 on pronto_private.admin_control_log(created_at desc);

create table if not exists pronto_private.platform_payments (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 plan_id uuid references public.pronto_plans(id),
 paid_at timestamptz not null default now(),
 recorded_at timestamptz not null default now(),
 recorded_by uuid not null references auth.users(id),
 amount_cents bigint not null check (amount_cents>0 and amount_cents<1000000000000),
 method text not null check (method in ('cash','mpesa','emola','bank','other')),
 external_reference text not null check (length(btrim(external_reference)) between 4 and 160),
 note text not null default '',
 unique(business_id,method,external_reference)
);
revoke all on pronto_private.platform_payments from public,anon,authenticated;
create index if not exists pronto_platform_payments_recent
 on pronto_private.platform_payments(paid_at desc);

create or replace function pronto_private.ubuntu_admin_control(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $admin$
declare
 actor uuid:=auth.uid();
 bid uuid;uid uuid;pid uuid;branch uuid;
 label text;reason text;result jsonb;
 cost bigint;days integer;target_role text;
 active_owners integer;
begin
 if actor is null or not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';end if;
 if p_action is null or p_data is null or jsonb_typeof(p_data)<>'object'
  or pg_column_size(p_data)>8192 then
  raise exception 'invalid_payload' using errcode='22023';end if;
 bid:=nullif(p_data->>'business_id','')::uuid;
 reason:=btrim(coalesce(p_data->>'reason',''));
 if p_action in ('business_edit','business_archive','business_restore','business_remove',
                 'branch_edit','member_edit','member_reactivate','payment_record') then
  if bid is null then raise exception 'business_required' using errcode='22023';end if;
  perform 1 from public.pronto_businesses where id=bid for update;
  if not found then raise exception 'unknown_business' using errcode='22023';end if;
 end if;

 if p_action='business_edit' then
  label:=btrim(coalesce(p_data->>'name',''));
  if length(label) not between 2 and 120 or length(coalesce(p_data->>'phone',''))>60
   or length(coalesce(p_data->>'address',''))>250 then
   raise exception 'invalid_business' using errcode='22023';end if;
  update public.pronto_businesses set name=label,
   phone=nullif(btrim(p_data->>'phone'),''),
   address=nullif(btrim(p_data->>'address'),'')
  where id=bid and removed_at is null;
  if not found then raise exception 'business_removed' using errcode='22023';end if;
  result:=jsonb_build_object('business_id',bid,'name',label);
 elsif p_action in ('business_archive','business_remove') then
  if length(reason) not between 10 and 500 then raise exception 'reason_required' using errcode='22023';end if;
  -- Remove means reversible soft deletion, never a financial cascade delete.
  -- Explicitly preserve audit, sales, debts, stock and cash history.
  update public.pronto_businesses set status='suspended',
   archived_at=coalesce(archived_at,now()),
   removed_at=case when p_action='business_remove' then coalesce(removed_at,now()) else removed_at end
   where id=bid;
  result:=jsonb_build_object('business_id',bid,'state',
   case when p_action='business_remove' then 'removed' else 'archived' end);
 elsif p_action='business_restore' then
  if length(reason) not between 10 and 500 then raise exception 'reason_required' using errcode='22023';end if;
  update public.pronto_businesses set archived_at=null,removed_at=null,status='suspended' where id=bid;
  result:=jsonb_build_object('business_id',bid,'state','suspended','requires_activation',true);
 elsif p_action='branch_edit' then
  branch:=nullif(p_data->>'branch_id','')::uuid;
  label:=btrim(coalesce(p_data->>'name',''));
  if branch is null or length(label) not between 2 and 120 or
    jsonb_typeof(p_data->'active')<>'boolean' then
   raise exception 'invalid_branch' using errcode='22023';end if;
  if (p_data->>'active')::boolean=false and
    exists(select 1 from public.pronto_cash_sessions s
     where s.business_id=bid and s.branch_id=branch and s.status='open') then
     raise exception 'open_cash_on_branch' using errcode='22023';end if;
  update public.pronto_branches set name=label,active=(p_data->>'active')::boolean
   where business_id=bid and id=branch;
  if not found then raise exception 'unknown_branch' using errcode='22023';end if;
  result:=jsonb_build_object('business_id',bid,'branch_id',branch,'active',(p_data->>'active')::boolean);
 elsif p_action='member_edit' then
  uid:=nullif(p_data->>'user_id','')::uuid;
  target_role:=p_data->>'role';
  label:=btrim(coalesce(p_data->>'display_name',''));
  if uid is null or target_role not in ('owner','manager','cashier','stock','finance')
    or length(label) not between 2 and 120 then
   raise exception 'invalid_member' using errcode='22023';end if;
  perform 1 from public.pronto_memberships where business_id=bid and user_id=uid for update;
  if not found then raise exception 'unknown_member' using errcode='22023';end if;
  if exists(select 1 from public.pronto_memberships where business_id=bid and user_id=uid
            and role='owner' and active) and target_role<>'owner' then
    select count(*) into active_owners from public.pronto_memberships
       where business_id=bid and role='owner' and active;
    if active_owners<=1 then raise exception 'last_owner' using errcode='22023';end if;
  end if;
  if exists(select 1 from pronto_private.ubuntu_super_admins where user_id=uid and active) then
    raise exception 'global_admin_cannot_join_shop' using errcode='42501';end if;
  update public.pronto_memberships set role=target_role where business_id=bid and user_id=uid;
  update public.pronto_profiles set display_name=label,updated_at=now() where user_id=uid;
  result:=jsonb_build_object('business_id',bid,'user_id',uid,'role',target_role);
 elsif p_action='member_reactivate' then
  uid:=nullif(p_data->>'user_id','')::uuid;
  if uid is null then raise exception 'invalid_member' using errcode='22023';end if;
  if exists(select 1 from pronto_private.ubuntu_super_admins where user_id=uid and active) then
   raise exception 'global_admin_cannot_join_shop' using errcode='42501';end if;
  update public.pronto_memberships set active=true
   where business_id=bid and user_id=uid;
  if not found then raise exception 'unknown_member' using errcode='22023';end if;
  result:=jsonb_build_object('business_id',bid,'user_id',uid,'active',true);
 elsif p_action='plan_edit' then
  pid:=nullif(p_data->>'plan_id','')::uuid;
  label:=btrim(coalesce(p_data->>'name',''));
  cost:=nullif(p_data->>'price_cents','')::bigint;
  days:=nullif(p_data->>'duration_days','')::integer;
  if pid is null or length(label) not between 2 and 100 or
     cost is null or cost<0 or cost>999999999999 or
     days is null or days not between 1 and 3660 then
   raise exception 'invalid_plan' using errcode='22023';end if;
  update public.pronto_plans set name=label,price_cents=cost,duration_days=days where id=pid;
  if not found then raise exception 'unknown_plan' using errcode='22023';end if;
  result:=jsonb_build_object('plan_id',pid,'name',label);
 elsif p_action='plan_toggle' then
  pid:=nullif(p_data->>'plan_id','')::uuid;
  if pid is null or jsonb_typeof(p_data->'active')<>'boolean' then
   raise exception 'invalid_plan' using errcode='22023';end if;
  update public.pronto_plans set active=(p_data->>'active')::boolean where id=pid;
  if not found then raise exception 'unknown_plan' using errcode='22023';end if;
  result:=jsonb_build_object('plan_id',pid,'active',(p_data->>'active')::boolean);
 elsif p_action='payment_record' then
  if length(reason) not between 8 and 500 then raise exception 'reason_required' using errcode='22023';end if;
  cost:=nullif(p_data->>'amount_cents','')::bigint;
  label:=btrim(coalesce(p_data->>'external_reference',''));
  pid:=nullif(p_data->>'plan_id','')::uuid;
  if cost is null or cost<=0 or cost>999999999999 or
     length(label) not between 4 and 160 or
     coalesce(p_data->>'method','') not in ('cash','mpesa','emola','bank','other') then
    raise exception 'invalid_payment' using errcode='22023';end if;
  insert into pronto_private.platform_payments(
    business_id,plan_id,recorded_by,amount_cents,method,external_reference,note)
  values(bid,pid,actor,cost,p_data->>'method',label,reason);
  result:=jsonb_build_object('business_id',bid,'payment_recorded',true,'amount_cents',cost);
 else
  raise exception 'unknown_admin_action' using errcode='22023';
 end if;
 insert into pronto_private.admin_control_log(actor_id,business_id,action,reason,details)
 values(actor,bid,p_action,
  case when p_action in ('business_archive','business_remove','business_restore','payment_record') then reason
       else coalesce(nullif(reason,''),'Alteração administrativa autorizada') end,result);
 return result;
end $admin$;
revoke all on function pronto_private.ubuntu_admin_control(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.ubuntu_admin_control(text,jsonb) to authenticated;
create or replace function public.pronto_ubuntu_admin_control(p_action text,p_data jsonb)
returns jsonb language sql set search_path to '' as $rpc$
 select pronto_private.ubuntu_admin_control(p_action,p_data);
$rpc$;
revoke all on function public.pronto_ubuntu_admin_control(text,jsonb) from public,anon;
grant execute on function public.pronto_ubuntu_admin_control(text,jsonb) to authenticated;

create or replace function pronto_private.ubuntu_admin_insights()
returns jsonb language plpgsql stable security definer set search_path to '' as $insights$
declare v jsonb;
begin
 if auth.uid() is null or not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';end if;
 select jsonb_build_object(
  'businesses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'archived_at',archived_at,'removed_at',removed_at))
    from public.pronto_businesses where archived_at is not null or removed_at is not null),'[]'::jsonb),
  'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'business_id',business_id,'name',name,'active',active)
     order by business_id,name) from public.pronto_branches),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,
      'actor_id',actor_id,'business_id',business_id,'action',action,'reason',reason,'details',details)
     order by created_at desc)
    from (select * from pronto_private.admin_control_log order by created_at desc limit 250) e),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'business_id',business_id,
       'paid_at',paid_at,'amount_cents',amount_cents,'method',method,'reference',external_reference)
     order by paid_at desc)
    from (select * from pronto_private.platform_payments order by paid_at desc limit 250) x),'[]'::jsonb),
  'payments_total_cents',coalesce((select sum(amount_cents) from pronto_private.platform_payments),0),
  'generated_at',now()
 ) into v;
 return v;
end $insights$;
revoke all on function pronto_private.ubuntu_admin_insights() from public,anon,authenticated;
grant execute on function pronto_private.ubuntu_admin_insights() to authenticated;
create or replace function public.pronto_ubuntu_admin_insights()
returns jsonb language sql stable set search_path to '' as $rpc$
 select pronto_private.ubuntu_admin_insights();
$rpc$;
revoke all on function public.pronto_ubuntu_admin_insights() from public,anon;
grant execute on function public.pronto_ubuntu_admin_insights() to authenticated;

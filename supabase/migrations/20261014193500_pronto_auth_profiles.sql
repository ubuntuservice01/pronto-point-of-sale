-- Phase 2: Supabase Auth identity and membership safeguards.
-- No payments, stock or user provisioning from the browser.
create table public.pronto_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (length(trim(display_name)) between 1 and 120),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.pronto_profiles enable row level security;

-- Explicit business suspension should immediately make memberships ineffective.
-- This private SECURITY DEFINER function uses the validated auth.uid() only.
create or replace function pronto_private.member_role(target_business uuid)
returns text language sql stable security definer
set search_path = ''
as $$
 select m.role
 from public.pronto_memberships m
 join public.pronto_businesses b on b.id = m.business_id
 where m.business_id=target_business
   and m.user_id=(select auth.uid())
   and m.active=true
   and b.status='active'
 limit 1
$$;
revoke all on function pronto_private.member_role(uuid) from public, anon, authenticated;
grant execute on function pronto_private.member_role(uuid) to authenticated;

-- A profile is visible only to its owner or an active co-worker.
-- There are no client-side profile write grants: server provisioning owns changes.
create or replace function pronto_private.is_coworker(target_user uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
 select exists (
  select 1 from public.pronto_memberships self_member
  join public.pronto_memberships target_member
    on target_member.business_id=self_member.business_id
  join public.pronto_businesses b on b.id=self_member.business_id
  where self_member.user_id=(select auth.uid())
    and self_member.active=true
    and target_member.user_id=target_user
    and target_member.active=true
    and b.status='active'
 )
$$;
revoke all on function pronto_private.is_coworker(uuid) from public, anon, authenticated;
grant execute on function pronto_private.is_coworker(uuid) to authenticated;
create policy pronto_profiles_read on public.pronto_profiles
 for select to authenticated using (
  user_id=(select auth.uid()) or pronto_private.is_coworker(user_id)
 );
grant select on public.pronto_profiles to authenticated;
revoke all on public.pronto_profiles from anon;
revoke insert,update,delete,truncate,references,trigger
 on public.pronto_profiles from authenticated;

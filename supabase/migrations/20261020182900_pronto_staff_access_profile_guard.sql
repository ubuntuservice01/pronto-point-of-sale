-- Disallow reading coworkers' profiles after business membership access is revoked
-- manually or by schedule. Profile self-read remains available for account operations.
create or replace function pronto_private.is_coworker(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.pronto_memberships target_member
  where target_member.user_id=target_user
   and target_member.active=true
   and pronto_private.member_role(target_member.business_id) is not null
 )
$$;

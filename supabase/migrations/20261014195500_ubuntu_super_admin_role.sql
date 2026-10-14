-- Pronto POS: Ubuntu Service global administrator identity.
-- Administrative authority is private, never stored in user-editable metadata.
-- No Supabase financial table privileges are granted by this migration.
create table if not exists pronto_private.ubuntu_super_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
revoke all on pronto_private.ubuntu_super_admins from public, anon, authenticated;
alter table pronto_private.ubuntu_super_admins enable row level security;

-- Read only the identity of the currently authenticated user.
create or replace function pronto_private.is_ubuntu_super_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
 select (select auth.uid()) is not null and exists (
  select 1 from pronto_private.ubuntu_super_admins a
  where a.user_id=(select auth.uid()) and a.active=true
 );
$$;
revoke all on function pronto_private.is_ubuntu_super_admin() from public, anon, authenticated;
grant usage on schema pronto_private to authenticated;
grant execute on function pronto_private.is_ubuntu_super_admin() to authenticated;

-- Exposed read-only identity check, deliberately SECURITY INVOKER.
-- It does not list users, grant roles, mutate businesses or return other accounts.
create or replace function public.pronto_admin_status()
returns boolean language sql stable security invoker
set search_path = ''
as $$
 select pronto_private.is_ubuntu_super_admin();
$$;
revoke all on function public.pronto_admin_status() from public, anon, authenticated;
grant execute on function public.pronto_admin_status() to authenticated;

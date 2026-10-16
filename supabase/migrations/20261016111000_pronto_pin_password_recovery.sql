-- Trusted service-only PIN reset. The caller MUST first verify the user's current
-- account password with Supabase Auth. Browser JWT alone is NOT sufficient.
-- The Edge Function supplies the authenticated subject after comparing both
-- Supabase Auth user records; this routine must never be granted to 'authenticated'.
create table if not exists pronto_private.session_pin_recovery_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 changed_at timestamptz not null default now(),
 method text not null default 'password_reauthentication'
  check(method='password_reauthentication')
);
revoke all on pronto_private.session_pin_recovery_events from public,anon,authenticated;
alter table pronto_private.session_pin_recovery_events enable row level security;
create index if not exists pronto_pin_recovery_user_when on
 pronto_private.session_pin_recovery_events(user_id,changed_at desc);

create or replace function pronto_private.reset_session_pin_verified(p_user uuid,p_new_pin text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_record pronto_private.session_pins%rowtype;
begin
 if p_user is null or p_new_pin is null or p_new_pin !~ '^[0-9]{5}$' then
  raise exception 'pin_five_digits' using errcode='22023';end if;

 -- Serialize competing resets, PIN checks, and changes for this user.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'pronto_pin:'||p_user::text,0));
 select * into v_record from pronto_private.session_pins
  where user_id=p_user for update;
 if not found then raise exception 'pin_not_configured' using errcode='22023';end if;
 if exists(select 1 from pronto_private.session_pin_recovery_events
  where user_id=p_user and changed_at>now()-interval '60 seconds') then
  raise exception 'pin_recovery_rate_limited' using errcode='22023';end if;
 if extensions.crypt(p_new_pin,v_record.pin_hash)=v_record.pin_hash then
  raise exception 'pin_must_be_different' using errcode='22023';end if;

 update pronto_private.session_pins
  set pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',12)),
      failed_attempts=0,blocked_until=null,changed_at=now()
  where user_id=p_user;
 insert into pronto_private.session_pin_recovery_events(user_id)
  values(p_user);
 return '{"ok":true,"configured":true}'::jsonb;
end $$;
revoke all on function pronto_private.reset_session_pin_verified(uuid,text)
 from public,anon,authenticated;
grant execute on function pronto_private.reset_session_pin_verified(uuid,text) to service_role;

create or replace function public.pronto_pin_recovery_service(p_user uuid,p_new_pin text)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.reset_session_pin_verified(p_user,p_new_pin);$$;
revoke all on function public.pronto_pin_recovery_service(uuid,text)
 from public,anon,authenticated;
grant execute on function public.pronto_pin_recovery_service(uuid,text) to service_role;

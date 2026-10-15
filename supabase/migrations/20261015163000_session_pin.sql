-- Pronto POS: five digit PIN for unlocking an already authenticated Supabase session.
-- Never replace Supabase Auth credentials with a 5-digit PIN.
create table pronto_private.session_pins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 pin_hash text not null,
 failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
 blocked_until timestamptz,
 changed_at timestamptz not null default now()
);
revoke all on pronto_private.session_pins from public, anon, authenticated;
alter table pronto_private.session_pins enable row level security;

create or replace function pronto_private.session_pin_action(p_action text,p_pin text default null,p_current_pin text default null)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_user uuid:=(select auth.uid());
 v_record pronto_private.session_pins%rowtype;
 v_failed integer;
 v_until timestamptz;
 v_valid boolean;
begin
 if v_user is null then raise exception 'login_required' using errcode='42501'; end if;
 if p_action not in ('status','create','verify','change') then
  raise exception 'invalid_pin_action' using errcode='22023';
 end if;
 if p_action<>'status' and (p_pin is null or p_pin !~ '^[0-9]{5}$') then
  raise exception 'pin_five_digits' using errcode='22023';
 end if;
 if p_action='change' and (p_current_pin is null or p_current_pin !~ '^[0-9]{5}$') then
  raise exception 'pin_five_digits' using errcode='22023';
 end if;
 -- Serialise failed attempts and PIN creation for one authenticated identity.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pronto_pin:'||v_user::text,0));
 select * into v_record from pronto_private.session_pins where user_id=v_user for update;
 if p_action='status' then
  return pg_catalog.jsonb_build_object('configured',found,
   'retry_after_seconds',case when found and v_record.blocked_until>now()
     then pg_catalog.ceil(pg_catalog.extract(epoch from (v_record.blocked_until-now())))::integer else 0 end);
 end if;
 if found and v_record.blocked_until>now() then
  return pg_catalog.jsonb_build_object('ok',false,'reason','temporarily_blocked',
   'retry_after_seconds',pg_catalog.ceil(pg_catalog.extract(epoch from(v_record.blocked_until-now())))::integer);
 end if;

 if p_action='create' then
  if found then return '{"ok":false,"reason":"already_configured"}'::jsonb; end if;
  insert into pronto_private.session_pins(user_id,pin_hash)
   values(v_user,extensions.crypt(p_pin,extensions.gen_salt('bf',12)));
  return '{"ok":true,"configured":true}'::jsonb;
 end if;

 if not found then return '{"ok":false,"reason":"not_configured"}'::jsonb; end if;

 if p_action='change' then
  v_valid:=extensions.crypt(p_current_pin,v_record.pin_hash)=v_record.pin_hash;
 else
  v_valid:=extensions.crypt(p_pin,v_record.pin_hash)=v_record.pin_hash;
 end if;
 if not v_valid then
  v_failed:=v_record.failed_attempts+1;
  if v_failed>=5 then
   v_until:=now()+interval '15 minutes';
   update pronto_private.session_pins
     set failed_attempts=5,blocked_until=v_until where user_id=v_user;
   return '{"ok":false,"reason":"temporarily_blocked","retry_after_seconds":900}'::jsonb;
  end if;
  update pronto_private.session_pins set failed_attempts=v_failed where user_id=v_user;
  return pg_catalog.jsonb_build_object('ok',false,'reason','incorrect_pin',
   'remaining_attempts',5-v_failed);
 end if;

 if p_action='verify' then
  update pronto_private.session_pins set failed_attempts=0,blocked_until=null where user_id=v_user;
  return '{"ok":true,"configured":true}'::jsonb;
 end if;
 -- The old PIN has been verified inside this transaction.
 update pronto_private.session_pins
 set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),
     failed_attempts=0,blocked_until=null,changed_at=now()
 where user_id=v_user;
 return '{"ok":true,"configured":true}'::jsonb;
end;
$$;

revoke all on function pronto_private.session_pin_action(text,text,text) from public,anon,authenticated;
grant execute on function pronto_private.session_pin_action(text,text,text) to authenticated;
create or replace function public.pronto_session_pin(p_action text,p_pin text default null,p_current_pin text default null)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.session_pin_action(p_action,p_pin,p_current_pin);$$;
revoke all on function public.pronto_session_pin(text,text,text) from public,anon,authenticated;
grant execute on function public.pronto_session_pin(text,text,text) to authenticated;

-- First-login provisional password: trusted Auth metadata is cleared only
-- after Supabase Auth commits a changed password hash.
-- Existing merchants and already configured PINs are not modified.
create or replace function pronto_private.pronto_complete_initial_password()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
 if old.raw_app_meta_data->>'pronto_password_change_required'='true'
   and new.encrypted_password is distinct from old.encrypted_password then
  new.raw_app_meta_data :=
   coalesce(new.raw_app_meta_data,'{}'::jsonb) - 'pronto_password_change_required';
 end if;
 return new;
end;
$$;
revoke all on function pronto_private.pronto_complete_initial_password() from public,anon,authenticated;

create trigger pronto_initial_password_updated
before update of encrypted_password on auth.users
for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function pronto_private.pronto_complete_initial_password();

-- A provisional credential must not create a new permanent PIN before
-- its password is replaced. This also rejects direct client-side RPC bypasses.
create or replace function pronto_private.pronto_pin_requires_personal_password()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if exists (
  select 1 from auth.users
  where id=new.user_id
    and raw_app_meta_data->>'pronto_password_change_required'='true'
 ) then
  raise exception 'change_initial_password_first' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function pronto_private.pronto_pin_requires_personal_password() from public,anon,authenticated;

create trigger pronto_pin_password_first
before insert on pronto_private.session_pins
for each row
execute function pronto_private.pronto_pin_requires_personal_password();

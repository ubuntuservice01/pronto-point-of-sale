-- An archived or removed merchant must be restored first, then separately activated.
-- Prevent activation through older admin RPCs or any other privileged write path.
-- Restoring itself intentionally leaves status suspended so the admin must review the licence.
create or replace function pronto_private.prevent_direct_removed_business_activation()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
 if new.status='active' and (
   new.archived_at is not null or new.removed_at is not null
   or old.archived_at is not null or old.removed_at is not null
 ) then
  raise exception 'business_restore_first' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function pronto_private.prevent_direct_removed_business_activation()
 from public,anon,authenticated;
drop trigger if exists pronto_restore_before_activation on public.pronto_businesses;
create trigger pronto_restore_before_activation
before update of status,archived_at,removed_at on public.pronto_businesses
for each row execute function pronto_private.prevent_direct_removed_business_activation();

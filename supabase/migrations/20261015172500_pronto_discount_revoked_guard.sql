-- Defensive follow-up: absent or revoked membership must never authorize discounts.
create or replace function pronto_private.guard_sale_discount()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
 if new.discount_cents>0 and (
  (select auth.uid()) is null
  or new.seller_id is distinct from (select auth.uid())
  or coalesce(pronto_private.member_role(new.business_id) not in ('owner','manager'),true)
 ) then
  raise exception 'discount_permission' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function pronto_private.guard_sale_discount() from public,anon,authenticated;

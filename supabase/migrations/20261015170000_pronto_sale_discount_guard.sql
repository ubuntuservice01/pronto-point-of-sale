-- Phase 4: only owner/manager may grant a checkout discount.
-- Server-side invariant: even a trusted RPC cannot bypass cashier restrictions.
create or replace function pronto_private.guard_sale_discount()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
 if new.discount_cents>0 and (
  (select auth.uid()) is null
  or new.seller_id is distinct from (select auth.uid())
  or pronto_private.member_role(new.business_id) not in ('owner','manager')
 ) then
  raise exception 'discount_permission' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function pronto_private.guard_sale_discount() from public,anon,authenticated;
drop trigger if exists pronto_guard_sale_discount on public.pronto_sales;
create trigger pronto_guard_sale_discount before insert or update of discount_cents, seller_id, business_id
 on public.pronto_sales for each row execute function pronto_private.guard_sale_discount();

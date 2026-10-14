-- Membership rows are not visible after the company has been suspended.
-- Ownership checks are resolved only from auth.uid() inside the private definer.
drop policy if exists membership_read on public.pronto_memberships;
create policy membership_read on public.pronto_memberships
 for select to authenticated
 using(
   pronto_private.member_role(business_id) is not null
   and (user_id=(select auth.uid()) or pronto_private.member_role(business_id)='owner')
 );

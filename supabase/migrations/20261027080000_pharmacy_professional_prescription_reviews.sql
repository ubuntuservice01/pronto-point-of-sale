-- Fase 5: prescription review. Pharmacy only, server-enforced and fail-closed.
-- Clinical verification/licensing is an external human process; only the platform super admin
-- can record a manually checked credential. No patient identity or prescription image is stored.
create table public.pronto_pharmacy_professionals(
 business_id uuid not null references public.pronto_businesses(id),
 user_id uuid not null references auth.users(id),
 license_reference text not null check(length(btrim(license_reference)) between 4 and 100),
 valid_until date not null,
 verified_by uuid not null references auth.users(id),
 verified_at timestamptz not null default now(),
 active boolean not null default true,
 primary key(business_id,user_id),
 foreign key(business_id,user_id) references public.pronto_memberships(business_id,user_id)
);
alter table public.pronto_pharmacy_professionals enable row level security;
revoke all on public.pronto_pharmacy_professionals from anon,authenticated;
-- Credential details remain available only through privileged server functions.

create table public.pronto_pharmacy_sale_reviews(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 branch_id uuid not null,
 sale_key uuid not null,
 product_id uuid not null,
 quantity numeric(16,3) not null check(quantity>0 and quantity<=1000000),
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '30 minutes'),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 prescription_reference text check(prescription_reference is null or length(btrim(prescription_reference)) between 4 and 100),
 used_sale_id uuid,
 unique(business_id,sale_key,product_id),
 foreign key(business_id,branch_id) references public.pronto_branches(business_id,id),
 foreign key(business_id,product_id) references public.pronto_products(business_id,id),
 foreign key(business_id,used_sale_id) references public.pronto_sales(business_id,id)
);
alter table public.pronto_pharmacy_sale_reviews enable row level security;
revoke all on public.pronto_pharmacy_sale_reviews from anon,authenticated;
create index pronto_pharmacy_review_branch_idx on public.pronto_pharmacy_sale_reviews(business_id,branch_id,requested_at desc);

create table public.pronto_pharmacy_dispensations(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 sale_id uuid not null,
 product_id uuid not null,
 batch_id uuid not null,
 movement_id uuid not null unique,
 qty numeric(16,3) not null check(qty>0),
 approved_by uuid not null references auth.users(id),
 prescription_reference text not null,
 dispensed_at timestamptz not null default now(),
 foreign key(business_id,sale_id) references public.pronto_sales(business_id,id),
 foreign key(business_id,product_id) references public.pronto_products(business_id,id),
 foreign key(business_id,batch_id) references public.pronto_batches(business_id,id),
 foreign key(movement_id) references public.pronto_stock_movements(id)
);
alter table public.pronto_pharmacy_dispensations enable row level security;
revoke all on public.pronto_pharmacy_dispensations from anon,authenticated;
-- Stock movement ID is recorded by an AFTER INSERT trigger, only after checkout validation.

create or replace function pronto_private.pharmacy_verified(p_business uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=''
as $f$
 select exists(
  select 1 from public.pronto_pharmacy_professionals pr
  join public.pronto_memberships m on m.business_id=pr.business_id and m.user_id=pr.user_id
  where pr.business_id=p_business and pr.user_id=p_user and pr.active
    and m.active and pr.valid_until >= (now() at time zone 'Africa/Maputo')::date
 )
$f$;
revoke all on function pronto_private.pharmacy_verified(uuid,uuid) from public,anon,authenticated;

create or replace function pronto_private.pharmacy_action(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare v_actor uuid:=(select auth.uid());
 v_business uuid;v_branch uuid;v_product uuid;v_key uuid;v_qty numeric;
 v_role text;v_reference text;v_license text;v_until date;v_user uuid;
 v_review public.pronto_pharmacy_sale_reviews%rowtype;v_updated integer;
begin
 if v_actor is null or p_action is null or p_data is null or
    pg_catalog.jsonb_typeof(p_data)<>'object' or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'pharmacy_invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 if v_business is null or not exists(select 1 from public.pronto_businesses
    where id=v_business and business_type='pharmacy') then
  raise exception 'pharmacy_required' using errcode='42501';end if;

 if p_action='professional_set' then
  if not pronto_private.is_ubuntu_super_admin() then
   raise exception 'admin_required' using errcode='42501';end if;
  v_user:=nullif(p_data->>'user_id','')::uuid;
  if v_user is null or not exists(select 1 from public.pronto_memberships
    where business_id=v_business and user_id=v_user and active) then
   raise exception 'professional_membership_required' using errcode='22023';end if;
  if pg_catalog.jsonb_typeof(p_data->'active')<>'boolean' then
   raise exception 'professional_invalid_status' using errcode='22023';end if;
  if (p_data->>'active')::boolean then
   v_license:=pg_catalog.btrim(coalesce(p_data->>'license_reference',''));
   v_until:=nullif(p_data->>'valid_until','')::date;
   if length(v_license) not between 4 and 100 or
    v_until is null or v_until<(now() at time zone 'Africa/Maputo')::date then
    raise exception 'professional_credential_required' using errcode='22023';end if;
   insert into public.pronto_pharmacy_professionals
    (business_id,user_id,license_reference,valid_until,verified_by,verified_at,active)
    values(v_business,v_user,v_license,v_until,v_actor,now(),true)
    on conflict(business_id,user_id) do update set
     license_reference=excluded.license_reference,valid_until=excluded.valid_until,
     verified_by=excluded.verified_by,verified_at=now(),active=true;
  else
   update public.pronto_pharmacy_professionals set active=false,verified_by=v_actor,verified_at=now()
    where business_id=v_business and user_id=v_user;
   if not found then raise exception 'professional_not_found' using errcode='22023';end if;
  end if;
  insert into public.pronto_audit_events(business_id,actor_id,event,payload) values
   (v_business,v_actor,'pharmacy.professional_set',jsonb_build_object('user_id',v_user,'active',(p_data->>'active')::boolean));
  return jsonb_build_object('saved',true,'user_id',v_user);
 end if;

 v_role:=pronto_private.member_role(v_business);
 if v_role not in ('owner','manager','cashier') then
  raise exception 'pharmacy_membership_required' using errcode='42501';end if;
 v_branch:=nullif(p_data->>'branch_id','')::uuid;
 if v_branch is null or not exists(select 1 from public.pronto_branches
    where id=v_branch and business_id=v_business and active) then
  raise exception 'pharmacy_branch_required' using errcode='42501';end if;
 v_key:=nullif(p_data->>'sale_key','')::uuid;
 v_product:=nullif(p_data->>'product_id','')::uuid;
 if v_key is null or v_product is null or not exists(
    select 1 from public.pronto_products where id=v_product and business_id=v_business
    and branch_id=v_branch and active
 ) then raise exception 'pharmacy_product_required' using errcode='22023';end if;

 if p_action='request' then
  v_qty:=nullif(p_data->>'quantity','')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>1000000 or v_qty<>round(v_qty,3) or
     not exists(select 1 from public.pronto_medicine_details m where
       m.business_id=v_business and m.product_id=v_product and m.requires_prescription) then
   raise exception 'pharmacy_rx_item_required' using errcode='22023';end if;
  insert into public.pronto_pharmacy_sale_reviews
   (business_id,branch_id,sale_key,product_id,quantity,requested_by)
   values(v_business,v_branch,v_key,v_product,v_qty,v_actor)
   on conflict (business_id,sale_key,product_id) do nothing;
  select * into v_review from public.pronto_pharmacy_sale_reviews
    where business_id=v_business and sale_key=v_key and product_id=v_product;
  if v_review.branch_id<>v_branch or v_review.requested_by<>v_actor
     or v_review.quantity<>v_qty or v_review.used_sale_id is not null or now()>v_review.expires_at then
   raise exception 'pharmacy_rx_request_conflict' using errcode='22023';end if;
  return jsonb_build_object('requested',true,'sale_key',v_key,'expires_at',v_review.expires_at);
 elsif p_action='approve' then
  if not pronto_private.pharmacy_verified(v_business,v_actor) then
   raise exception 'pharmacy_professional_not_verified' using errcode='42501';end if;
  v_reference:=pg_catalog.btrim(coalesce(p_data->>'prescription_reference',''));
  if length(v_reference) not between 4 and 100 or (p_data->>'checked')<>'true' then
   raise exception 'pharmacy_prescription_review_required' using errcode='22023';end if;
  select * into v_review from public.pronto_pharmacy_sale_reviews
   where business_id=v_business and branch_id=v_branch
    and sale_key=v_key and product_id=v_product for update;
  if not found or now()>v_review.expires_at or v_review.used_sale_id is not null or
    v_review.approved_by is not null then
   raise exception 'pharmacy_review_expired_or_used' using errcode='22023';end if;
  update public.pronto_pharmacy_sale_reviews set approved_by=v_actor,
    approved_at=now(),prescription_reference=v_reference where id=v_review.id;
  insert into public.pronto_audit_events(business_id,actor_id,event,payload)
   values(v_business,v_actor,'pharmacy.prescription_approved',
    jsonb_build_object('review_id',v_review.id,'sale_key',v_key,'product_id',v_product,'qty',v_review.quantity));
  return jsonb_build_object('approved',true,'sale_key',v_key);
 else raise exception 'pharmacy_unknown_action' using errcode='22023';end if;
end $f$;
revoke all on function pronto_private.pharmacy_action(text,jsonb) from public,anon;
grant execute on function pronto_private.pharmacy_action(text,jsonb) to authenticated;
create or replace function public.pronto_pharmacy_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $f$ select pronto_private.pharmacy_action(p_action,p_data) $f$;
revoke all on function public.pronto_pharmacy_action(text,jsonb) from public,anon;
grant execute on function public.pronto_pharmacy_action(text,jsonb) to authenticated;

create or replace function pronto_private.pharmacy_snapshot(p_business uuid,p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $f$
declare v_actor uuid:=(select auth.uid());v_approved boolean;v_role text;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role not in('owner','manager','cashier') or not exists(
   select 1 from public.pronto_businesses where id=p_business and business_type='pharmacy')
   or not exists(select 1 from public.pronto_branches
     where business_id=p_business and id=p_branch and active) then
  raise exception 'pharmacy_scope' using errcode='42501';end if;
 v_approved:=pronto_private.pharmacy_verified(p_business,v_actor);
 return jsonb_build_object('can_approve',v_approved,'requests',
  coalesce((select jsonb_agg(jsonb_build_object('sale_key',q.sale_key,'product_id',q.product_id,
    'name',p.name,'quantity',q.quantity,'expires_at',q.expires_at,
    'approved',q.approved_by is not null,'used',q.used_sale_id is not null)
    order by q.requested_at desc)
    from (select * from public.pronto_pharmacy_sale_reviews
       where business_id=p_business and branch_id=p_branch
         and expires_at>now() and used_sale_id is null
       order by requested_at desc limit 70) q
    join public.pronto_products p on p.business_id=q.business_id and p.id=q.product_id),
   '[]'::jsonb));
end $f$;
revoke all on function pronto_private.pharmacy_snapshot(uuid,uuid) from public,anon;
grant execute on function pronto_private.pharmacy_snapshot(uuid,uuid) to authenticated;
create or replace function public.pronto_pharmacy_snapshot(p_business uuid,p_branch uuid)
returns jsonb language sql stable security invoker set search_path=''
as $f$select pronto_private.pharmacy_snapshot(p_business,p_branch)$f$;
revoke all on function public.pronto_pharmacy_snapshot(uuid,uuid) from public,anon;
grant execute on function public.pronto_pharmacy_snapshot(uuid,uuid) to authenticated;

-- Replace the old universal block with a one-time, sale-bound authorisation.
create or replace function pronto_private.guard_pharmacy_stock_movement()
returns trigger language plpgsql security definer set search_path=''
as $f$
declare v_today date:=(now() at time zone 'Africa/Maputo')::date;
 v_sale public.pronto_sales%rowtype;
 v_review public.pronto_pharmacy_sale_reviews%rowtype;
 v_qty numeric;
begin
 if not exists(select 1 from public.pronto_businesses
   where id=new.business_id and business_type='pharmacy') then return new;end if;
 if new.kind='adjust' and new.qty_delta>0 then
  raise exception 'pharmacy_receive_stock_via_lot_only' using errcode='22023';end if;
 if new.kind='sale' then
  if new.batch_id is null or not exists(select 1 from public.pronto_batches b
    where b.id=new.batch_id and b.business_id=new.business_id and b.product_id=new.product_id
      and b.lot_number is not null and btrim(b.lot_number)<>'' and b.expires_on>v_today) then
   raise exception 'pharmacy_sale_requires_valid_batch' using errcode='22023';end if;
  if not exists(select 1 from public.pronto_medicine_details
     where business_id=new.business_id and product_id=new.product_id) then
   raise exception 'pharmacy_medicine_ficha_required' using errcode='42501';end if;
  if exists(select 1 from public.pronto_medicine_details
     where business_id=new.business_id and product_id=new.product_id and requires_prescription) then
   select * into v_sale from public.pronto_sales
    where business_id=new.business_id and id=new.reference_id;
   if not found then raise exception 'pharmacy_sale_required' using errcode='42501';end if;
   select si.qty into v_qty from public.pronto_sale_items si
    where si.business_id=new.business_id and si.sale_id=v_sale.id
      and si.product_id=new.product_id;
   select * into v_review from public.pronto_pharmacy_sale_reviews q
    where q.business_id=new.business_id and q.branch_id=v_sale.branch_id
      and q.sale_key=v_sale.idempotency_key and q.product_id=new.product_id for update;
   if not found or v_review.quantity is distinct from v_qty or
      v_review.requested_by<>v_sale.seller_id or v_review.approved_by is null or
      v_review.approved_at is null or now()>v_review.expires_at or
      v_review.prescription_reference is null or
      (v_review.used_sale_id is not null and v_review.used_sale_id<>v_sale.id) or
      not pronto_private.pharmacy_verified(new.business_id,v_review.approved_by) then
    raise exception 'pharmacy_prescription_approval_required' using errcode='42501';end if;
   update public.pronto_pharmacy_sale_reviews set used_sale_id=v_sale.id
    where id=v_review.id and (used_sale_id is null or used_sale_id=v_sale.id);
  end if;
 end if;
 return new;
end $f$;
revoke all on function pronto_private.guard_pharmacy_stock_movement() from public,anon,authenticated;

-- Record the actual FEFO batch for every prescription-only stock movement.
create or replace function pronto_private.log_pharmacy_dispensation()
returns trigger language plpgsql security definer set search_path=''
as $f$
declare v_sale public.pronto_sales%rowtype;v_review public.pronto_pharmacy_sale_reviews%rowtype;
begin
 if new.kind<>'sale' or not exists(select 1 from public.pronto_medicine_details
   where business_id=new.business_id and product_id=new.product_id and requires_prescription) then
  return new;end if;
 select * into v_sale from public.pronto_sales where business_id=new.business_id and id=new.reference_id;
 select * into v_review from public.pronto_pharmacy_sale_reviews
  where business_id=new.business_id and sale_key=v_sale.idempotency_key
    and product_id=new.product_id and used_sale_id=v_sale.id;
 if not found then raise exception 'pharmacy_dispensation_missing_review' using errcode='42501';end if;
 insert into public.pronto_pharmacy_dispensations
  (business_id,sale_id,product_id,batch_id,movement_id,qty,approved_by,prescription_reference)
 values(new.business_id,v_sale.id,new.product_id,new.batch_id,new.id,
   -new.qty_delta,v_review.approved_by,v_review.prescription_reference);
 return new;
end $f$;
revoke all on function pronto_private.log_pharmacy_dispensation() from public,anon,authenticated;
create trigger pronto_pharmacy_record_dispensation after insert
 on public.pronto_stock_movements for each row execute function pronto_private.log_pharmacy_dispensation();

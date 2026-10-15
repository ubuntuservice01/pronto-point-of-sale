-- Private Supabase Storage photographs; one immutable unique object per product revision.
-- No public access, no overwrites and no direct anonymous Storage access.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('pronto-product-photos','pronto-product-photos',false,3145728,
  array['image/jpeg','image/png','image/webp'])
 on conflict(id) do nothing;

create or replace function pronto_private.can_product_photo(p_path text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare
 v_business uuid;v_branch uuid;v_product uuid;v_role text;
begin
 if (select auth.uid()) is null or p_path is null or length(p_path)>240 or
 p_path !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(jpg|jpeg|png|webp)$' then
  return false;end if;
 v_business:=pg_catalog.split_part(p_path,'/',1)::uuid;
 v_branch:=pg_catalog.split_part(p_path,'/',2)::uuid;
 v_product:=pg_catalog.split_part(p_path,'/',3)::uuid;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null or
  (p_write and v_role not in('owner','manager','stock')) or
  (not p_write and v_role not in('owner','manager','stock','cashier','finance'))
  then return false;end if;
 return exists(select 1 from public.pronto_products p
  where p.id=v_product and p.business_id=v_business and p.branch_id=v_branch);
end$$;
revoke all on function pronto_private.can_product_photo(text,boolean) from public,anon,authenticated;
grant execute on function pronto_private.can_product_photo(text,boolean) to authenticated;

drop policy if exists "pronto_product_photo_read" on storage.objects;
create policy "pronto_product_photo_read" on storage.objects for select to authenticated
 using(bucket_id='pronto-product-photos' and pronto_private.can_product_photo(name,false));
drop policy if exists "pronto_product_photo_upload" on storage.objects;
create policy "pronto_product_photo_upload" on storage.objects for insert to authenticated
 with check(bucket_id='pronto-product-photos' and pronto_private.can_product_photo(name,true));

create or replace function pronto_private.photo_attach(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;v_product uuid:=(p_data->>'product_id')::uuid;
 v_path text:=p_data->>'photo_path';v_expected integer:=(p_data->>'expected_revision')::integer;
 v_role text;v_revision integer;
begin
 if v_actor is null or v_business is null or v_branch is null or v_product is null or
  v_expected is null or v_path is null or
  not pronto_private.can_product_photo(v_path,true) or
  pg_catalog.split_part(v_path,'/',1)<>v_business::text or
  pg_catalog.split_part(v_path,'/',2)<>v_branch::text or
  pg_catalog.split_part(v_path,'/',3)<>v_product::text then
  raise exception 'photo_permission' using errcode='42501';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in('owner','manager','stock') or v_role is null then
  raise exception 'photo_permission' using errcode='42501';end if;
 if not exists(select 1 from storage.objects where bucket_id='pronto-product-photos'
  and name=v_path) then raise exception 'photo_not_uploaded' using errcode='22023';end if;
 update public.pronto_products set photo_path=v_path,revision=revision+1
  where business_id=v_business and branch_id=v_branch and id=v_product and revision=v_expected
  returning revision into v_revision;
 if not found then raise exception 'product_revision_conflict' using errcode='22023';end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'inventory.product_photo_attached',
   pg_catalog.jsonb_build_object('product_id',v_product,'path',v_path));
 return pg_catalog.jsonb_build_object('product_id',v_product,'photo_path',v_path,'revision',v_revision);
end$$;
revoke all on function pronto_private.photo_attach(jsonb) from public,anon,authenticated;
grant execute on function pronto_private.photo_attach(jsonb) to authenticated;
create or replace function public.pronto_photo_attach(p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.photo_attach(p_data);$$;
revoke all on function public.pronto_photo_attach(jsonb) from public,anon,authenticated;
grant execute on function public.pronto_photo_attach(jsonb) to authenticated;

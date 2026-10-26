-- CRUD lifecycle with strict tenant checks, audit, and safe soft-delete fallback.
-- Never cascade-delete sales, payments, debts or inventory movements.
create or replace function pronto_private.catalog_lifecycle(
 p_business_id uuid,p_branch_id uuid,p_kind text,p_action text,p_record_id uuid,p_expected_revision integer default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_role text;
 v_p public.pronto_products%rowtype;
 v_s public.pronto_suppliers%rowtype;
 v_c public.pronto_customers%rowtype;
 v_name text;v_outcome text;
 v_soft boolean:=false;
begin
 if v_actor is null or p_business_id is null or p_branch_id is null or p_record_id is null then
  raise exception 'catalog_invalid_request' using errcode='22023';end if;
 if p_kind is null or p_action is null or p_kind not in('product','supplier','customer') or p_action not in('archive','restore','delete') then
  raise exception 'catalog_invalid_action' using errcode='22023';end if;
 v_role:=pronto_private.member_role(p_business_id);
 if coalesce(v_role,'') not in('owner','manager') then raise exception 'catalog_permission_denied' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches b where b.id=p_branch_id and b.business_id=p_business_id and b.active) then
  raise exception 'catalog_branch_unavailable' using errcode='22023';end if;
 if p_kind='product' then
  select * into v_p from public.pronto_products
   where id=p_record_id and business_id=p_business_id and branch_id=p_branch_id for update;
  if not found then raise exception 'catalog_not_found' using errcode='22023';end if;
  v_name:=v_p.name;
  if p_expected_revision is null or v_p.revision<>p_expected_revision then
   raise exception 'product_revision_conflict' using errcode='22023';end if;
  if p_action='archive' then
   update public.pronto_products set active=false,revision=revision+1 where id=v_p.id;
   v_outcome:='archived';
  elsif p_action='restore' then
   if v_p.photo_path is null then
    raise exception 'product_photo_required' using errcode='22023';end if;
   update public.pronto_products set active=true,revision=revision+1 where id=v_p.id;
   v_outcome:='restored';
  else
   -- A saved photo is a separate storage object: preserve its association for safe cleanup.
   -- A held cart may embed the product UUID in JSON without an FK.
   v_soft:=v_p.stock<>0 or v_p.photo_path is not null or exists(
    select 1 from public.pronto_held_sales h where h.business_id=p_business_id
    and h.branch_id=p_branch_id and h.cart::text like '%'||p_record_id::text||'%'
   );
   if not v_soft then
    begin
     delete from public.pronto_products where id=v_p.id;
     v_outcome:='deleted';
    exception when foreign_key_violation then
     v_soft:=true;
    end;
   end if;
   if v_soft then
    update public.pronto_products set active=false,revision=revision+1 where id=v_p.id;
    v_outcome:='archived';
   end if;
  end if;
 elsif p_kind='supplier' then
  select * into v_s from public.pronto_suppliers where id=p_record_id and business_id=p_business_id for update;
  if not found then raise exception 'catalog_not_found' using errcode='22023';end if;
  v_name:=v_s.name;
  if p_action='archive' then
   update public.pronto_suppliers set active=false,updated_at=now() where id=v_s.id;
   v_outcome:='archived';
  elsif p_action='restore' then
   update public.pronto_suppliers set active=true,updated_at=now() where id=v_s.id;
   v_outcome:='restored';
  else
   begin
    delete from public.pronto_suppliers where id=v_s.id;
    v_outcome:='deleted';
   exception when foreign_key_violation then
    update public.pronto_suppliers set active=false,updated_at=now() where id=v_s.id;
    v_outcome:='archived';
   end;
  end if;
 else
  select * into v_c from public.pronto_customers
   where id=p_record_id and business_id=p_business_id and branch_id=p_branch_id for update;
  if not found then raise exception 'catalog_not_found' using errcode='22023';end if;
  v_name:=v_c.name;
  if p_action='archive' then
   update public.pronto_customers set active=false,updated_at=now() where id=v_c.id;
   v_outcome:='archived';
  elsif p_action='restore' then
   update public.pronto_customers set active=true,updated_at=now() where id=v_c.id;
   v_outcome:='restored';
  else
   begin
    delete from public.pronto_customers where id=v_c.id;
    v_outcome:='deleted';
   exception when foreign_key_violation then
    update public.pronto_customers set active=false,updated_at=now() where id=v_c.id;
    v_outcome:='archived';
   end;
  end if;
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values(p_business_id,v_actor,'catalog_'||p_kind||'_'||v_outcome,
  pg_catalog.jsonb_build_object('record_id',p_record_id,'record_name',v_name,
   'branch_id',p_branch_id,'requested_action',p_action,'actual_action',v_outcome));
 return pg_catalog.jsonb_build_object('record_id',p_record_id,'kind',p_kind,'requested_action',p_action,
   'outcome',v_outcome,'preserved_history',v_outcome='archived' and p_action='delete');
end;$$;
revoke all on function pronto_private.catalog_lifecycle(uuid,uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function pronto_private.catalog_lifecycle(uuid,uuid,text,text,uuid,integer) to authenticated;

create or replace function public.pronto_catalog_lifecycle(
 p_business_id uuid,p_branch_id uuid,p_kind text,p_action text,p_record_id uuid,p_expected_revision integer default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select pronto_private.catalog_lifecycle(p_business_id,p_branch_id,p_kind,p_action,p_record_id,p_expected_revision);
$$;
revoke all on function public.pronto_catalog_lifecycle(uuid,uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.pronto_catalog_lifecycle(uuid,uuid,text,text,uuid,integer) to authenticated;

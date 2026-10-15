-- Safety: never deactivate an origin/destination branch with stock in transit.
create or replace function pronto_private.manage_branch(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid:=nullif(p_data->>'business_id','')::uuid;
 v_branch uuid:=nullif(p_data->>'branch_id','')::uuid;
 v_name text:=pg_catalog.btrim(p_data->>'name');
 v_role text;v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or
  pg_catalog.pg_column_size(p_data)>4096 or v_business is null then
  raise exception 'invalid_request' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null or v_role<>'owner' then raise exception 'owner_required' using errcode='42501';end if;
 if p_action='list' then
  return pg_catalog.jsonb_build_object('branches',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',b.id,'name',b.name,'active',b.active,
    'products',(select count(*) from public.pronto_products p where p.branch_id=b.id and p.business_id=v_business and p.active),
    'open_cash',(select count(*) from public.pronto_cash_sessions s where s.branch_id=b.id and s.business_id=v_business and s.status='open'),
    'created_at',b.created_at) order by b.name)
   from public.pronto_branches b where b.business_id=v_business),'[]'::jsonb));
 elsif p_action='create' then
  if v_name is null or length(v_name) not between 2 and 120 then raise exception 'invalid_branch_name' using errcode='22023';end if;
  if exists(select 1 from public.pronto_branches where business_id=v_business and lower(name)=lower(v_name)) then
   raise exception 'branch_exists' using errcode='22023';end if;
  insert into public.pronto_branches(business_id,name) values(v_business,v_name) returning id into v_branch;
  v_result:=pg_catalog.jsonb_build_object('branch_id',v_branch,'created',true);
 elsif p_action='rename' then
  if v_branch is null or v_name is null or length(v_name) not between 2 and 120 then
   raise exception 'invalid_branch' using errcode='22023';end if;
  perform 1 from public.pronto_branches where id=v_branch and business_id=v_business for update;
  if not found then raise exception 'branch_not_found' using errcode='22023';end if;
  if exists(select 1 from public.pronto_branches where business_id=v_business and id<>v_branch and lower(name)=lower(v_name)) then
   raise exception 'branch_exists' using errcode='22023';end if;
  update public.pronto_branches set name=v_name where business_id=v_business and id=v_branch;
  v_result:=pg_catalog.jsonb_build_object('branch_id',v_branch,'renamed',true);
 elsif p_action='deactivate' then
  if v_branch is null then raise exception 'invalid_branch' using errcode='22023';end if;
  perform 1 from public.pronto_branches where id=v_branch and business_id=v_business and active for update;
  if not found then raise exception 'branch_not_found' using errcode='22023';end if;
  if (select count(*) from public.pronto_branches where business_id=v_business and active)<=1 then
   raise exception 'last_branch_required' using errcode='22023';end if;
  if exists(select 1 from public.pronto_cash_sessions where business_id=v_business and branch_id=v_branch and status='open') then
   raise exception 'branch_has_open_cash' using errcode='22023';end if;
  if exists(select 1 from public.pronto_products where business_id=v_business and branch_id=v_branch and stock>0) then
   raise exception 'branch_has_stock' using errcode='22023';end if;
  if exists(select 1 from public.pronto_held_sales where business_id=v_business and branch_id=v_branch) then
   raise exception 'branch_has_held_sales' using errcode='22023';end if;
  if exists(select 1 from public.pronto_stock_transfers
   where business_id=v_business and status='in_transit'
    and (source_branch_id=v_branch or target_branch_id=v_branch)) then
   raise exception 'branch_has_pending_transfers' using errcode='22023';end if;
  update public.pronto_branches set active=false where id=v_branch and business_id=v_business;
  v_result:=pg_catalog.jsonb_build_object('branch_id',v_branch,'deactivated',true);
 elsif p_action='reactivate' then
  if v_branch is null then raise exception 'invalid_branch' using errcode='22023';end if;
  update public.pronto_branches set active=true where id=v_branch and business_id=v_business and not active;
  if not found then raise exception 'branch_not_found_or_active' using errcode='22023';end if;
  v_result:=pg_catalog.jsonb_build_object('branch_id',v_branch,'reactivated',true);
 else raise exception 'invalid_branch_action' using errcode='22023';end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'branch.'||p_action,v_result);
 return v_result;
end $$;;

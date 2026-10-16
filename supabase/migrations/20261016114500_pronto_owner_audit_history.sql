-- Auditable business operations for authorised shop owner only.
-- No raw payload: it may contain customer contact and sensitive financial data.
create index if not exists pronto_audit_events_business_created_idx
 on public.pronto_audit_events(business_id,created_at desc,id desc);

create or replace function pronto_private.owner_audit_snapshot(
 p_business uuid,p_page integer default 0,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
 v_limit integer;v_offset integer;
begin
 if (select auth.uid()) is null or p_business is null or
  coalesce(pronto_private.member_role(p_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';end if;
 if p_page is null or p_limit is null or p_page<0 or p_page>100 or
   p_limit<1 or p_limit>100 then
  raise exception 'audit_page_invalid' using errcode='22023';end if;
 v_limit:=p_limit;
 v_offset:=p_page*v_limit;
 return pg_catalog.jsonb_build_object(
  'events',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',e.id,'event',e.event,'created_at',e.created_at,
    'actor_name',case when adm.user_id is not null then 'Equipa Ubuntu Service'
     else coalesce(nullif(pg_catalog.btrim(profile.display_name),''),'Operador') end,
    'target_id',coalesce(e.payload->>'user_id',e.payload->>'product_id',
     e.payload->>'customer_id',e.payload->>'sale_id',
     e.payload->>'purchase_id',e.payload->>'debt_id',
     e.payload->>'branch_id',e.payload->>'transfer_id',
     e.payload->>'return_id',e.payload->>'expense_id',
     e.payload->>'supplier_id',e.payload->>'id')
    ) order by e.created_at desc,e.id desc)
   from (
    select id,actor_id,event,payload,created_at
    from public.pronto_audit_events
    where business_id=p_business order by created_at desc,id desc
    limit v_limit offset v_offset
   ) e
   left join public.pronto_profiles profile on profile.user_id=e.actor_id
   left join pronto_private.ubuntu_super_admins adm on adm.user_id=e.actor_id and adm.active
  ),'[]'::jsonb),
  'page',p_page,'limit',v_limit,
  'has_more',exists(
   select 1 from public.pronto_audit_events e where e.business_id=p_business
   order by e.created_at desc,e.id desc
   offset v_offset+v_limit limit 1),
  'generated_at',now()
 );
end $$;
revoke all on function pronto_private.owner_audit_snapshot(uuid,integer,integer)
 from public,anon,authenticated;
grant execute on function pronto_private.owner_audit_snapshot(uuid,integer,integer)
 to authenticated;
create or replace function public.pronto_owner_audit_snapshot(
 p_business uuid,p_page integer default 0,p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.owner_audit_snapshot(p_business,p_page,p_limit);$$;
revoke all on function public.pronto_owner_audit_snapshot(uuid,integer,integer)
 from public,anon,authenticated;
grant execute on function public.pronto_owner_audit_snapshot(uuid,integer,integer)
 to authenticated;

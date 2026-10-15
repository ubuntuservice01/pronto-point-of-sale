-- Historical sale lines and returns, authorised only to shop owner/manager.
create or replace function pronto_private.return_snapshot(p_business uuid,p_branch uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role not in('owner','manager') or v_role is null then
  raise exception 'return_permission' using errcode='42501';end if;
 if not exists(select 1 from public.pronto_branches where business_id=p_business and id=p_branch and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 return pg_catalog.jsonb_build_object(
  'sales',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',s.id,'total_cents',s.total_cents,'method',s.method,
   'created_at',s.created_at,'status',s.status,
   'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'product_id',i.product_id,'name',i.snapshot_name,'qty',i.qty,
     'unit',p.unit,'unit_price_cents',i.unit_price_cents,
     'returned_qty',coalesce((select sum(l.qty)
      from public.pronto_return_lines l
      join public.pronto_return_headers h on h.id=l.return_id
      where h.business_id=p_business and h.sale_id=s.id and l.product_id=i.product_id),0)
     ) order by i.snapshot_name)
     from public.pronto_sale_items i join public.pronto_products p on p.id=i.product_id
     where i.business_id=p_business and i.sale_id=s.id),'[]'::jsonb)
   ) order by s.created_at desc)
   from (select * from public.pronto_sales z
    where z.business_id=p_business and z.branch_id=p_branch
    and z.method<>'credit' and z.status in('completed','refunded')
    order by z.created_at desc limit 200) s),'[]'::jsonb),
  'returns',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,'sale_id',r.sale_id,'amount_cents',r.amount_cents,
    'method',r.method,'reason',r.reason,'reference',r.reference,'created_at',r.created_at,
    'manually_confirmed',r.manually_confirmed
   ) order by r.created_at desc)
   from (select * from public.pronto_return_headers z
    where z.business_id=p_business and z.branch_id=p_branch
    order by z.created_at desc limit 200) r),'[]'::jsonb),
  'generated_at',now()
 );
end $$;
revoke all on function pronto_private.return_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function pronto_private.return_snapshot(uuid,uuid) to authenticated;
create or replace function public.pronto_return_snapshot(p_business uuid,p_branch uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.return_snapshot(p_business,p_branch);$$;
revoke all on function public.pronto_return_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pronto_return_snapshot(uuid,uuid) to authenticated;

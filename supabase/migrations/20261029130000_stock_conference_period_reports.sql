-- Conferencia fisica de inventario: saldo inicial, entradas, vendas, outras movimentacoes,
-- saldo final historico por produto e filial. Sem alterar stock nem gravar contagens.
create or replace function pronto_private.stock_conference_snapshot(
 p_business uuid,p_branch uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare
 v_role text;
 v_today date:=(now() at time zone 'Africa/Maputo')::date;
 v_from timestamptz;
 v_until timestamptz;
 v_asof timestamptz:=statement_timestamp();
 v_rows jsonb;
 v_count int;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role is null or v_role not in('owner','manager','stock','finance') or
    p_start is null or p_end is null or p_start>p_end or p_end>v_today or
    p_end-p_start>3660 or p_branch is null or
    not exists(select 1 from public.pronto_branches b
      where b.business_id=p_business and b.id=p_branch and b.active) then
  raise exception 'stock_conference_scope_invalid' using errcode='42501';
 end if;
 v_from:=p_start::timestamp at time zone 'Africa/Maputo';
 v_until:=least((p_end+1)::timestamp at time zone 'Africa/Maputo',v_asof);
 if v_from>v_asof then raise exception 'stock_conference_future_date' using errcode='22023';end if;
 select count(*) into v_count from public.pronto_products p
  where p.business_id=p_business and p.branch_id=p_branch and p.created_at<v_until;
 if v_count>2000 then raise exception 'stock_conference_product_limit' using errcode='22023';end if;

 select coalesce(jsonb_agg(jsonb_build_object(
   'product_id',z.id,'name',z.name,'code',z.code,'unit',z.unit,
   'initial',z.initial,'received',z.received,'sold',z.sold,
   'other_in',z.other_in,'other_out',z.other_out,'final',z.final,
   'active',z.active) order by lower(z.name),z.code,z.id),'[]'::jsonb)
 into v_rows
 from (
  select p.id,p.name,p.code,p.unit,p.active,
    p.stock-coalesce(a.after_delta,0)-coalesce(a.period_delta,0) as initial,
    coalesce(a.received,0) as received,
    coalesce(a.sold,0) as sold,
    coalesce(a.other_in,0) as other_in,
    coalesce(a.other_out,0) as other_out,
    p.stock-coalesce(a.after_delta,0) as final
  from public.pronto_products p
  left join lateral (
   select
    sum(m.qty_delta) filter(where m.created_at>=v_until) as after_delta,
    sum(m.qty_delta) filter(where m.created_at>=v_from and m.created_at<v_until) as period_delta,
    sum(m.qty_delta) filter(where m.created_at>=v_from and m.created_at<v_until and m.kind='receive' and m.qty_delta>0) as received,
    sum(-m.qty_delta) filter(where m.created_at>=v_from and m.created_at<v_until and m.kind='sale' and m.qty_delta<0) as sold,
    sum(m.qty_delta) filter(where m.created_at>=v_from and m.created_at<v_until and m.kind<>'receive' and m.qty_delta>0) as other_in,
    sum(-m.qty_delta) filter(where m.created_at>=v_from and m.created_at<v_until and m.kind<>'sale' and m.qty_delta<0) as other_out
   from public.pronto_stock_movements m
   where m.business_id=p_business and m.product_id=p.id and m.created_at<=v_asof
  ) a on true
  where p.business_id=p_business and p.branch_id=p_branch and p.created_at<v_until
 ) z;
 return jsonb_build_object('business_id',p_business,'branch_id',p_branch,
  'from',p_start,'to',p_end,'generated_at',v_asof,
  'total_products',v_count,'rows',v_rows);
end $fn$;
revoke all on function pronto_private.stock_conference_snapshot(uuid,uuid,date,date) from public,anon;
grant execute on function pronto_private.stock_conference_snapshot(uuid,uuid,date,date) to authenticated;
create or replace function public.pronto_stock_conference_snapshot(
 p_business uuid,p_branch uuid,p_start date,p_end date)
returns jsonb language sql stable security invoker set search_path=''
as $fn$
 select pronto_private.stock_conference_snapshot(p_business,p_branch,p_start,p_end)
$fn$;
revoke all on function public.pronto_stock_conference_snapshot(uuid,uuid,date,date) from public,anon;
grant execute on function public.pronto_stock_conference_snapshot(uuid,uuid,date,date) to authenticated;

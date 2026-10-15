-- Read-only operating reports for the verified shop membership, NOT tax invoices.
-- Monetary figures are integer metical cents. Provisional profits depend on known costs.
create or replace function pronto_private.reports_snapshot(
 p_business uuid,p_branch uuid,p_start date,p_end date
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
 v_role text;v_actor uuid:=(select auth.uid());
 v_start timestamptz;v_stop timestamptz;
 v_gross bigint;v_returns bigint;v_expenses bigint;v_received bigint;v_cogs numeric;
 v_missing bigint;v_count bigint;v_unpaid bigint;v_cash_open int;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role not in('owner','manager','finance','cashier') or v_role is null then
  raise exception 'reports_permission' using errcode='42501';end if;
 if p_branch is null and v_role not in('owner','manager','finance') then
  raise exception 'branch_required' using errcode='42501';end if;
 if p_branch is not null and not exists(
  select 1 from public.pronto_branches where id=p_branch and business_id=p_business and active) then
  raise exception 'branch_unavailable' using errcode='22023';end if;
 if p_start is null or p_end is null or p_end<p_start or
   p_end-p_start>366 or p_start<'2020-01-01' then
  raise exception 'reports_invalid_dates' using errcode='22023';end if;
 v_start:=p_start::timestamp at time zone 'Africa/Maputo';
 v_stop:=(p_end+1)::timestamp at time zone 'Africa/Maputo';
 select coalesce(sum(s.total_cents),0),count(*) into v_gross,v_count
 from public.pronto_sales s where s.business_id=p_business
 and (p_branch is null or s.branch_id=p_branch)
 and (v_role<>'cashier' or s.seller_id=v_actor)
 and s.created_at>=v_start and s.created_at<v_stop;
 select coalesce(sum(r.amount_cents),0) into v_returns
 from public.pronto_return_headers r where r.business_id=p_business
 and (p_branch is null or r.branch_id=p_branch)
 and (v_role<>'cashier' or r.actor_id=v_actor)
 and r.created_at>=v_start and r.created_at<v_stop;
 select coalesce(sum(e.amount_cents),0) into v_expenses from public.pronto_expenses e
 where e.business_id=p_business and (p_branch is null or e.branch_id=p_branch)
 and (v_role<>'cashier' or e.operator_id=v_actor)
 and e.reversed_at is null and e.created_at>=v_start and e.created_at<v_stop;
 select coalesce(sum(x.amount),0) into v_received
 from (
  select pa.amount_cents amount from public.pronto_payment_allocations pa
  join public.pronto_sales s on s.id=pa.sale_id and s.business_id=pa.business_id
  where pa.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
   and (v_role<>'cashier' or s.seller_id=v_actor)
   and pa.created_at>=v_start and pa.created_at<v_stop
  union all
  select dp.amount_cents from public.pronto_debt_payments dp
  join public.pronto_debts d on d.id=dp.debt_id and d.business_id=dp.business_id
  join public.pronto_sales s on s.id=d.sale_id and s.business_id=d.business_id
  where dp.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
   and (v_role<>'cashier' or dp.operator_id=v_actor)
   and dp.created_at>=v_start and dp.created_at<v_stop
  union all
  select -r.amount_cents from public.pronto_return_headers r where r.business_id=p_business
   and (p_branch is null or r.branch_id=p_branch)
   and (v_role<>'cashier' or r.actor_id=v_actor)
   and r.created_at>=v_start and r.created_at<v_stop
 ) x;
 -- Estimated cost of goods sold follows original FEFO lot movements, not retail price.
 select coalesce(sum(abs(m.qty_delta)*coalesce(b.unit_cost_cents,0)),0),
 count(*) filter(where b.unit_cost_cents is null)
 into v_cogs,v_missing
 from public.pronto_stock_movements m
 join public.pronto_sales s on s.id=m.reference_id and s.business_id=m.business_id
 left join public.pronto_batches b on b.id=m.batch_id and b.business_id=m.business_id
 where m.business_id=p_business and m.kind='sale'
  and (p_branch is null or s.branch_id=p_branch)
  and (v_role<>'cashier' or s.seller_id=v_actor)
  and s.created_at>=v_start and s.created_at<v_stop;
 select coalesce(sum(d.balance_cents),0) into v_unpaid
 from public.pronto_debts d
 join public.pronto_sales s on s.id=d.sale_id and s.business_id=d.business_id
 where d.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
 and (v_role<>'cashier' or s.seller_id=v_actor) and d.balance_cents>0;
 select count(*) into v_cash_open from public.pronto_cash_sessions s
 where s.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
 and (v_role<>'cashier' or s.operator_id=v_actor) and s.status='open';
 return pg_catalog.jsonb_build_object(
  'business_id',p_business,'branch_id',p_branch,'start',p_start,'end',p_end,
  'role',v_role,'generated_at',now(),
  'totals',pg_catalog.jsonb_build_object(
   'sales_count',v_count,'gross_sales_cents',v_gross,
   'returns_cents',v_returns,'net_sales_cents',v_gross-v_returns,
   'received_cents',v_received,'expenses_cents',v_expenses,
   'cogs_estimated_cents',pg_catalog.round(v_cogs)::bigint,'cogs_missing_lines',v_missing,
   'gross_profit_estimated_cents',case when v_missing=0 then
    v_gross-v_returns-pg_catalog.round(v_cogs)::bigint else null end,
   'net_profit_estimated_cents',case when v_missing=0 then
    v_gross-v_returns-pg_catalog.round(v_cogs)::bigint-v_expenses else null end,
   'total_unpaid_debts_cents',v_unpaid,'cash_sessions_open',v_cash_open
  ),
  'by_method',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'method',x.method,'collected_cents',x.amount) order by x.method)
    from (
     select z.method,sum(z.amount) amount from (
      select p.method,p.amount_cents amount from public.pronto_payment_allocations p
      join public.pronto_sales s on s.id=p.sale_id and s.business_id=p.business_id
      where p.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
       and (v_role<>'cashier' or s.seller_id=v_actor)
       and p.created_at>=v_start and p.created_at<v_stop
      union all
      select dp.method,dp.amount_cents from public.pronto_debt_payments dp
       join public.pronto_debts d on d.id=dp.debt_id and d.business_id=dp.business_id
       where dp.business_id=p_business and (p_branch is null or d.branch_id=p_branch)
       and (v_role<>'cashier' or dp.operator_id=v_actor)
       and dp.created_at>=v_start and dp.created_at<v_stop
      union all
      select r.method,-r.amount_cents from public.pronto_return_headers r
       where r.business_id=p_business and (p_branch is null or r.branch_id=p_branch)
       and (v_role<>'cashier' or r.actor_id=v_actor)
       and r.created_at>=v_start and r.created_at<v_stop
     ) z group by z.method
    ) x),'[]'::jsonb),
  'by_seller',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id',x.seller_id,'name',x.name,'sales_count',x.cnt,
      'gross_cents',x.gross) order by x.gross desc)
    from(
     select s.seller_id,coalesce(p.display_name,'Operador '||left(s.seller_id::text,8)) name,
      count(*) cnt,sum(s.total_cents) gross
     from public.pronto_sales s left join public.pronto_profiles p on p.user_id=s.seller_id
     where s.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
      and (v_role<>'cashier' or s.seller_id=v_actor)
      and s.created_at>=v_start and s.created_at<v_stop
     group by s.seller_id,p.display_name order by gross desc limit 100
    ) x),'[]'::jsonb),
  'by_product',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'product_id',x.product_id,'name',x.name,'quantity',x.qty,
     'revenue_cents',x.revenue) order by x.revenue desc)
   from(
    select i.product_id,max(i.snapshot_name) name,sum(i.qty) qty,
     sum(i.line_total_cents) revenue
    from public.pronto_sale_items i join public.pronto_sales s
     on s.id=i.sale_id and s.business_id=i.business_id
    where i.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
      and (v_role<>'cashier' or s.seller_id=v_actor)
      and s.created_at>=v_start and s.created_at<v_stop
    group by i.product_id order by revenue desc limit 100
   )x),'[]'::jsonb),
  'by_branch',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'branch_id',x.branch_id,'name',x.name,'sales_count',x.cnt,
    'gross_cents',x.gross) order by x.gross desc)
   from (
    select s.branch_id,b.name,count(*) cnt,sum(s.total_cents) gross
    from public.pronto_sales s join public.pronto_branches b
     on b.id=s.branch_id and b.business_id=s.business_id
    where s.business_id=p_business and (p_branch is null or s.branch_id=p_branch)
    and (v_role<>'cashier' or s.seller_id=v_actor)
    and s.created_at>=v_start and s.created_at<v_stop
    group by s.branch_id,b.name order by gross desc limit 100
   ) x),'[]'::jsonb),
  'expenses_by_category',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'category',e.category,'total_cents',sum(e.amount_cents)) order by sum(e.amount_cents) desc)
    from public.pronto_expenses e
    where e.business_id=p_business and (p_branch is null or e.branch_id=p_branch)
     and e.created_at>=v_start and e.created_at<v_stop and e.reversed_at is null
     and (v_role<>'cashier' or e.operator_id=v_actor)
    group by e.category),'[]'::jsonb)
 );
end $$;
revoke all on function pronto_private.reports_snapshot(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function pronto_private.reports_snapshot(uuid,uuid,date,date) to authenticated;
create or replace function public.pronto_reports_snapshot(p_business uuid,p_branch uuid,p_start date,p_end date)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.reports_snapshot(p_business,p_branch,p_start,p_end);$$;
revoke all on function public.pronto_reports_snapshot(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.pronto_reports_snapshot(uuid,uuid,date,date) to authenticated;

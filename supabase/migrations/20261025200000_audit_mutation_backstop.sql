-- Audit backstop for changes to business records.
-- Each event is generated inside the same transaction as its change, with
-- auth.uid() as the actor and only allowlisted values in before/after.
-- Existing domain audit events are retained; this records the DB-level trail.
create or replace function pronto_private.audit_business_mutation()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
 v_old jsonb := '{}'::jsonb;
 v_new jsonb := '{}'::jsonb;
 v_before jsonb;
 v_after jsonb;
 v_changed jsonb;
 v_business uuid;
 v_target text;
 v_branch text;
 v_fields text[] := array[
  'price_cents','unit','stock','min_stock','active','allow_fractional',
  'status','role','amount_cents','total_cents','balance_cents',
  'credit_limit_cents','credit_blocked','opening_cash_cents',
  'counted_cash_cents','opening_required','blind_close','schedule_enabled',
  'start_time','end_time','manual_mode','qty_delta','quantity','qty',
  'due_on','next_due_on','repeat_months','expires_at','cancelled',
  'reversed_at','close_type','emergency_difference_cents'
 ];
begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new);end if;
 if tg_op='UPDATE' and v_old=v_new then return new;end if;

 select coalesce(pg_catalog.jsonb_agg(k.field_name order by k.field_name),'[]'::jsonb)
 into v_changed
 from pg_catalog.jsonb_object_keys(v_old||v_new) as k(field_name)
 where v_old->k.field_name is distinct from v_new->k.field_name
  and k.field_name not in ('updated_at','revision','request_hash','idempotency_key');
 if tg_op='UPDATE' and v_changed='[]'::jsonb then return new;end if;

 select coalesce(pg_catalog.jsonb_object_agg(f.field_name,v_old->f.field_name),'{}'::jsonb),
        coalesce(pg_catalog.jsonb_object_agg(f.field_name,v_new->f.field_name),'{}'::jsonb)
 into v_before,v_after
 from pg_catalog.unnest(v_fields) as f(field_name)
 where v_old ? f.field_name or v_new ? f.field_name;

 v_business:=case when tg_table_name='pronto_businesses'
  then coalesce(v_old->>'id',v_new->>'id')::uuid
  else coalesce(v_old->>'business_id',v_new->>'business_id')::uuid end;
 if v_business is null then raise exception 'audit_business_missing' using errcode='23502';end if;
 v_target:=coalesce(v_old->>'id',v_new->>'id',
  v_old->>'user_id',v_new->>'user_id',v_old->>'branch_id',v_new->>'branch_id',
  v_old->>'business_id',v_new->>'business_id');
 v_branch:=coalesce(v_old->>'branch_id',v_new->>'branch_id');

 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values(v_business,(select auth.uid()),
  'record.'||pg_catalog.replace(tg_table_name,'pronto_','')||'.'||pg_catalog.lower(tg_op),
  pg_catalog.jsonb_build_object(
   'entity',tg_table_name,'entity_id',v_target,'branch_id',v_branch,
   'operation',pg_catalog.lower(tg_op),'changed_fields',v_changed,
   'before',v_before,'after',v_after,
   'source','db_audit_v1'));
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function pronto_private.audit_business_mutation() from public,anon,authenticated;

-- Audit business roots, not high-volume derived sale/transfer line tables.
-- Existing guarded RPCs keep their domain-specific events as well.
do $$
declare v_table text;v_operations text;
begin
 foreach v_table in array array[
  'pronto_products','pronto_customers','pronto_suppliers',
  'pronto_expenses','pronto_expense_schedules','pronto_purchases',
  'pronto_cash_sessions','pronto_cash_policies','pronto_cash_movements',
  'pronto_debts','pronto_debt_payments','pronto_memberships',
  'pronto_staff_access_rules','pronto_document_settings',
  'pronto_branches','pronto_businesses','pronto_sales','pronto_refunds',
  'pronto_stock_transfers','pronto_stock_movements',
  'pronto_subscriptions','pronto_held_sales'
 ] loop
  execute pg_catalog.format('drop trigger if exists pronto_record_audit on public.%I',v_table);
  -- The business itself must exist for its FK-scoped audit event. Its updates
  -- are recorded; deletion/retention remains governed by existing controls.
  v_operations:=case when v_table='pronto_businesses' then 'update'
   else 'insert or update or delete' end;
  execute pg_catalog.format(
   'create trigger pronto_record_audit after %s on public.%I '
   ||'for each row execute function pronto_private.audit_business_mutation()',v_operations,v_table);
 end loop;
end $$;

-- Raw audit payloads are no longer exposed through direct table SELECT.
-- The owner-only RPC above returns a deliberately constrained projection.
revoke select on public.pronto_audit_events from authenticated;

-- Extend the existing owner-only projection: no raw payload, JWT, customer
-- names, phone numbers or internal references are returned to the browser.
create or replace function pronto_private.owner_audit_snapshot(
 p_business uuid,p_page integer default 0,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer;v_offset integer;
begin
 if (select auth.uid()) is null or p_business is null or
  coalesce(pronto_private.member_role(p_business),'')<>'owner' then
  raise exception 'owner_required' using errcode='42501';end if;
 if p_page is null or p_limit is null or p_page<0 or p_page>100 or
   p_limit<1 or p_limit>100 then
  raise exception 'audit_page_invalid' using errcode='22023';end if;
 v_limit:=p_limit;v_offset:=p_page*v_limit;
 return pg_catalog.jsonb_build_object(
  'events',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',e.id,'event',e.event,'created_at',e.created_at,'actor_id',e.actor_id,
    'actor_name',case when e.actor_id is null then 'Sistema / operação administrativa'
     when adm.user_id is not null then 'Equipa Ubuntu Service'
     else coalesce(nullif(pg_catalog.btrim(profile.display_name),''),'Operador') end,
    'target_id',coalesce(e.payload->>'entity_id',e.payload->>'user_id',
     e.payload->>'product_id',e.payload->>'customer_id',e.payload->>'sale_id',
     e.payload->>'purchase_id',e.payload->>'debt_id',e.payload->>'branch_id',
     e.payload->>'transfer_id',e.payload->>'return_id',e.payload->>'expense_id',
     e.payload->>'supplier_id',e.payload->>'id'),
    'before',case when e.event like 'record.%' then coalesce(e.payload->'before','{}'::jsonb) else '{}'::jsonb end,
    'after',case when e.event like 'record.%' then coalesce(e.payload->'after','{}'::jsonb) else '{}'::jsonb end,
    'changed_fields',case when e.event like 'record.%' then coalesce(e.payload->'changed_fields','[]'::jsonb) else '[]'::jsonb end
   ) order by e.created_at desc,e.id desc)
   from (select id,actor_id,event,payload,created_at
    from public.pronto_audit_events where business_id=p_business
    order by created_at desc,id desc limit v_limit offset v_offset) e
   left join public.pronto_profiles profile on profile.user_id=e.actor_id
   left join pronto_private.ubuntu_super_admins adm on adm.user_id=e.actor_id and adm.active
  ),'[]'::jsonb),
  'page',p_page,'limit',v_limit,
  'has_more',exists(select 1 from public.pronto_audit_events e
   where e.business_id=p_business order by e.created_at desc,e.id desc
   offset v_offset+v_limit limit 1),
  'generated_at',now());
end $$;
-- The public security-invoker wrapper and its authenticated grant remain intact.

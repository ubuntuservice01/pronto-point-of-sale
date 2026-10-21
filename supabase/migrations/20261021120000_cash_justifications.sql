-- Append-only justifications for reconciled shortages/surpluses. Do not modify the original count.
CREATE OR REPLACE FUNCTION pronto_private.cash_control(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid;v_branch uuid;v_role text;v_id uuid;v_terminal text;
 v_s record;v_required boolean:=true;v_blind boolean:=false;
 v_open bigint;v_counted bigint;v_reason text;v_totals jsonb;
 v_result jsonb;v_items jsonb;v_kind text;v_open_status text;v_target uuid;
begin
 if v_actor is null or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object'
  or pg_column_size(p_data)>8192 then raise exception 'invalid_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_branch:=nullif(p_data->>'branch_id','')::uuid;
 if v_business is null or v_branch is null then raise exception 'missing_scope' using errcode='22023';end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in ('owner','manager','cashier','finance') or v_role is null then
  raise exception 'cash_access_denied' using errcode='42501';end if;
 perform 1 from public.pronto_branches b where b.id=v_branch and b.business_id=v_business and b.active;
 if not found then raise exception 'branch_unavailable' using errcode='42501';end if;
 select coalesce(opening_required,true),coalesce(blind_close,false)
 into v_required,v_blind from public.pronto_cash_policies
 where business_id=v_business and branch_id=v_branch;
 if not found then v_required:=true;v_blind:=false;end if;
 v_id:=nullif(p_data->>'session_id','')::uuid;
 if p_action='settings' then
  return jsonb_build_object('opening_required',v_required,'blind_close',v_blind);
 elsif p_action='configure' then
  if v_role<>'owner' or jsonb_typeof(p_data->'opening_required')<>'boolean'
   or jsonb_typeof(p_data->'blind_close')<>'boolean' then
   raise exception 'owner_required' using errcode='42501';end if;
  insert into public.pronto_cash_policies(business_id,branch_id,opening_required,blind_close,updated_at,updated_by)
   values(v_business,v_branch,(p_data->>'opening_required')::boolean,(p_data->>'blind_close')::boolean,now(),v_actor)
   on conflict(business_id,branch_id) do update set opening_required=excluded.opening_required,
    blind_close=excluded.blind_close,updated_at=now(),updated_by=v_actor;
  v_result:=jsonb_build_object('opening_required',(p_data->>'opening_required')::boolean,
    'blind_close',(p_data->>'blind_close')::boolean);
 elsif p_action='snapshot' then
  select coalesce(jsonb_agg(v.item order by v.created_at desc),'[]'::jsonb) into v_items from (
   select s.opened_at as created_at,
   jsonb_build_object('id',s.id,'business_id',s.business_id,'branch_id',s.branch_id,
    'operator_id',s.operator_id,'operator_name',coalesce(pr.display_name,'Operador'),
    'terminal',s.device_id,'opened_at',s.opened_at,'closed_at',s.closed_at,'closed_by',s.closed_by,
    'status',case when s.status='closed' then 'closed'
      when s.blocked_at is not null then 'blocked'
      when s.close_requested_at is not null then 'pending' else 'open' end,
    'close_type',s.close_type,'close_reason',s.close_reason,
    'opening_cash_cents',s.opening_cash_cents,'counted_cash_cents',s.counted_cash_cents,
    'close_requested_at',s.close_requested_at,
    'expected_cash_cents',case
      when s.status='closed' then s.expected_at_close_cents
      when v_role in ('owner','manager','finance') or not v_blind
       then (pronto_private.cash_totals(v_business,s.id)->>'expected_cash_cents')::bigint
      else null end,
    'payments_by_method',case
      when v_role in ('owner','manager','finance') or s.status='closed' or not v_blind
       then pronto_private.cash_totals(v_business,s.id)->'payments_by_method'
      else null end,
    'difference_cents',case when s.status='closed' and s.counted_cash_cents is not null
     then s.counted_cash_cents-s.expected_at_close_cents else null end) item
   from (select * from public.pronto_cash_sessions
    where business_id=v_business and branch_id=v_branch
      and (v_role in ('owner','manager','finance') or operator_id=v_actor)
    order by opened_at desc limit 100) s
   left join public.pronto_profiles pr on pr.user_id=s.operator_id
  ) v;
  return jsonb_build_object('policy',jsonb_build_object('opening_required',v_required,'blind_close',v_blind),
   'sessions',v_items,'generated_at',now());
 elsif p_action='open' then
  if v_role not in ('owner','manager','cashier') then raise exception 'cash_permission' using errcode='42501';end if;
  v_terminal:=btrim(p_data->>'device_id');
  v_open:=nullif(p_data->>'opening_cash_cents','')::bigint;
  if v_terminal is null or length(v_terminal) not between 2 and 100 or
   v_open is null or v_open<0 or v_open>999999999999 then
    raise exception 'invalid_cash_open' using errcode='22023';end if;
  insert into public.pronto_cash_sessions(business_id,branch_id,operator_id,device_id,opening_cash_cents)
   values(v_business,v_branch,v_actor,v_terminal,v_open) returning id into v_id;
  v_result:=jsonb_build_object('session_id',v_id,'opening_cash_cents',v_open,'status','open');
 else
  if v_id is null then raise exception 'session_required' using errcode='22023';end if;
  select * into v_s from public.pronto_cash_sessions
   where id=v_id and business_id=v_business and branch_id=v_branch for update;
  if not found then raise exception 'cash_session_unavailable' using errcode='22023';end if;
  if p_action='note_difference' then
   if v_s.status<>'closed' or v_s.counted_cash_cents is null or
     (v_s.operator_id<>v_actor and v_role not in ('owner','manager')) then
    raise exception 'note_not_allowed' using errcode='42501';end if;
   v_reason:=btrim(p_data->>'reason');
   if v_reason is null or length(v_reason) not between 8 and 500 then
    raise exception 'reason_required' using errcode='22023';end if;
   insert into public.pronto_cash_difference_notes(business_id,session_id,actor_id,note)
    values(v_business,v_id,v_actor,v_reason);
   v_result:=jsonb_build_object('session_id',v_id,'note_added',true);
   insert into public.pronto_audit_events(business_id,actor_id,event,payload)
    values(v_business,v_actor,'cash.note_difference',v_result||
      jsonb_build_object('branch_id',v_branch,'reason',v_reason));
   return v_result;
  end if;
  if v_s.status<>'open' then raise exception 'cash_already_closed' using errcode='22023';end if;
  if p_action in ('block','unblock','admin_close') then
   if v_role<>'owner' then raise exception 'owner_required' using errcode='42501';end if;
  elsif v_s.operator_id<>v_actor or v_role not in('owner','manager','cashier') then
   raise exception 'cash_permission' using errcode='42501';end if;
  if p_action='request_close' then
   if v_s.blocked_at is not null then raise exception 'cash_blocked' using errcode='42501';end if;
   update public.pronto_cash_sessions set close_requested_at=now(),close_requested_by=v_actor
    where id=v_id;
   v_result:=jsonb_build_object('session_id',v_id,'status','pending');
  elsif p_action='close' then
   if v_s.blocked_at is not null then raise exception 'cash_blocked' using errcode='42501';end if;
   v_counted:=nullif(p_data->>'counted_cash_cents','')::bigint;
   if v_counted is null or v_counted<0 or v_counted>999999999999 then
    raise exception 'invalid_counted_cash' using errcode='22023';end if;
   v_totals:=pronto_private.cash_totals(v_business,v_id);
   update public.pronto_cash_sessions set status='closed',closed_at=now(),
    counted_cash_cents=v_counted,expected_at_close_cents=(v_totals->>'expected_cash_cents')::bigint,
    closed_by=v_actor,close_type=case when v_blind then 'blind' else 'standard' end
    where id=v_id;
   v_result:=v_totals||jsonb_build_object('session_id',v_id,'status','closed',
    'close_type',case when v_blind then 'blind' else 'standard' end,
    'counted_cents',v_counted,'expected_cents',(v_totals->>'expected_cash_cents')::bigint,
    'difference_cents',v_counted-(v_totals->>'expected_cash_cents')::bigint);
  elsif p_action='block' or p_action='unblock' then
   v_reason:=btrim(p_data->>'reason');
   if v_reason is null or length(v_reason) not between 8 and 250 then
    raise exception 'reason_required' using errcode='22023';end if;
   if p_action='block' then
    update public.pronto_cash_sessions set blocked_at=now(),blocked_by=v_actor,blocked_reason=v_reason where id=v_id;
   else
    update public.pronto_cash_sessions set blocked_at=null,blocked_by=null,blocked_reason=null where id=v_id;
   end if;
   v_result:=jsonb_build_object('session_id',v_id,'status',case when p_action='block' then 'blocked' else 'open' end,'reason',v_reason);
  elsif p_action='admin_close' then
   v_reason:=btrim(p_data->>'reason');
   if v_reason is null or length(v_reason) not between 12 and 250 then
    raise exception 'reason_required' using errcode='22023';end if;
   v_totals:=pronto_private.cash_totals(v_business,v_id);
   update public.pronto_cash_sessions set status='closed',closed_at=now(),closed_by=v_actor,
    expected_at_close_cents=(v_totals->>'expected_cash_cents')::bigint,
    close_type='administrative_unchecked',close_reason=v_reason,counted_cash_cents=null where id=v_id;
   v_result:=jsonb_build_object('session_id',v_id,'status','closed',
    'close_type','administrative_unchecked','counted_cents',null,'difference_cents',null,'reason',v_reason);
  else
   raise exception 'unknown_cash_action' using errcode='22023';
  end if;
 end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values(v_business,v_actor,'cash.'||p_action,
   v_result||jsonb_build_object('branch_id',v_branch));
 return v_result;
end $function$
;

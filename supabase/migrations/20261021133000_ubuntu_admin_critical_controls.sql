create or replace function pronto_private.ubuntu_admin_critical(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $f$
declare actor uuid:=auth.uid();reason text;bid uuid;res jsonb;
begin
 if actor is null or not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';end if;
 if p_action not in ('business_suspend','business_activate','license_cancel','member_deactivate')
  or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'invalid_action' using errcode='22023';end if;
 reason:=btrim(coalesce(p_data->>'reason',''));
 if length(reason) not between 10 and 500 then raise exception 'reason_required' using errcode='22023';end if;
 bid:=nullif(p_data->>'business_id','')::uuid;
 res:=pronto_private.admin_mutation(p_action,p_data);
 insert into pronto_private.admin_control_log(actor_id,business_id,action,reason,details)
 values(actor,bid,p_action,reason,res);
 return res;
end $f$;
revoke all on function pronto_private.ubuntu_admin_critical(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.ubuntu_admin_critical(text,jsonb) to authenticated;
create or replace function public.pronto_ubuntu_admin_critical(p_action text,p_data jsonb)
returns jsonb language sql set search_path to '' as $f$
 select pronto_private.ubuntu_admin_critical(p_action,p_data)
$f$;
revoke all on function public.pronto_ubuntu_admin_critical(text,jsonb) from public,anon;
grant execute on function public.pronto_ubuntu_admin_critical(text,jsonb) to authenticated;

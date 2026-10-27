-- Synced from the deployed Pronto POS sector-classification migration 20261026222901.
-- Keep shops without an explicit industry as general retail.
alter table public.pronto_businesses add column if not exists business_type text not null
 default 'general' constraint pronto_business_type_check
 check (business_type in ('grocery','pharmacy','hardware','fashion','cosmetics','restaurant','general','other'));
CREATE OR REPLACE FUNCTION pronto_private.normalize_business_type(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case lower(pg_catalog.btrim(coalesce(p_value,'')))
  when 'mercearia' then 'grocery'
  when 'grocery' then 'grocery'
  when 'farmácia' then 'pharmacy'
  when 'farmacia' then 'pharmacy'
  when 'pharmacy' then 'pharmacy'
  when 'ferragem' then 'hardware'
  when 'hardware' then 'hardware'
  when 'roupa e calçado' then 'fashion'
  when 'roupa e calcado' then 'fashion'
  when 'fashion' then 'fashion'
  when 'cosméticos' then 'cosmetics'
  when 'cosmeticos' then 'cosmetics'
  when 'cosmetics' then 'cosmetics'
  when 'restaurante' then 'restaurant'
  when 'restaurant' then 'restaurant'
  when 'loja' then 'general'
  when 'loja / comércio geral' then 'general'
  when 'general' then 'general'
  when 'outro comércio' then 'other'
  when 'outro negócio' then 'other'
  when 'other' then 'other'
  else 'other'
 end;
$function$
;
revoke all on function pronto_private.normalize_business_type(text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION pronto_private.sync_trial_business_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.pronto_businesses
 set business_type=pronto_private.normalize_business_type(new.industry)
 where id=new.business_id;
 return new;
end;
$function$
;
revoke all on function pronto_private.sync_trial_business_type() from public,anon,authenticated;
create trigger pronto_trial_sync_business_type
 after insert or update of industry on pronto_private.self_service_trials
 for each row execute function pronto_private.sync_trial_business_type();
update public.pronto_businesses b set business_type=pronto_private.normalize_business_type(t.industry)
 from pronto_private.self_service_trials t
 where t.business_id=b.id and b.business_type='general';
CREATE OR REPLACE FUNCTION pronto_private.admin_create_typed_business(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=(select auth.uid());
 v_type text;
 v_result jsonb;
 v_business uuid;
begin
 if v_actor is null or not pronto_private.is_ubuntu_super_admin() then
  raise exception 'admin_required' using errcode='42501';
 end if;
 if p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' or pg_catalog.pg_column_size(p_data)>8192 then
  raise exception 'invalid_payload' using errcode='22023';
 end if;
 v_type:=coalesce(nullif(pg_catalog.btrim(p_data->>'business_type'),''),'general');
 if v_type not in ('grocery','pharmacy','hardware','fashion','cosmetics','restaurant','general','other') then
  raise exception 'invalid_business_type' using errcode='22023';
 end if;
 v_result:=pronto_private.admin_mutation('business_create',p_data - 'business_type');
 v_business:=(v_result->>'id')::uuid;
 update public.pronto_businesses set business_type=v_type
 where id=v_business and status='suspended';
 if not found then raise exception 'invalid_business' using errcode='22023'; end if;
 insert into pronto_private.admin_actions(actor_id,action,business_id,payload)
 values(v_actor,'business_type_set',v_business,
  pg_catalog.jsonb_build_object('business_type',v_type));
 return v_result || pg_catalog.jsonb_build_object('business_type',v_type);
end;
$function$
;
revoke all on function pronto_private.admin_create_typed_business(jsonb) from public,anon,authenticated;
grant execute on function pronto_private.admin_create_typed_business(jsonb) to authenticated;
CREATE OR REPLACE FUNCTION public.pronto_admin_mutation(p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select case when p_action='business_create'
  then pronto_private.admin_create_typed_business(p_data)
  else pronto_private.admin_mutation(p_action,p_data)
 end;
$function$
;

-- Pronto POS pharmacy catalogue: one pharmaceutical ficha per existing product.
-- Product, stock, batches, money and checkout tables are untouched.
create table if not exists public.pronto_medicine_details (
 business_id uuid not null,
 product_id uuid not null,
 active_ingredient text not null check (char_length(btrim(active_ingredient)) between 2 and 200),
 strength text not null check (char_length(btrim(strength)) between 1 and 80),
 dosage_form text not null check (char_length(btrim(dosage_form)) between 2 and 100),
 presentation text not null check (char_length(btrim(presentation)) between 2 and 120),
 manufacturer text not null default '' check (char_length(manufacturer)<=160),
 requires_prescription boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key (business_id,product_id),
 foreign key (business_id,product_id) references public.pronto_products(business_id,id) on delete cascade
);
alter table public.pronto_medicine_details enable row level security;
revoke all on public.pronto_medicine_details from anon,authenticated;
grant select on public.pronto_medicine_details to authenticated;
create policy pronto_medicine_details_read on public.pronto_medicine_details
 for select to authenticated using (
 pronto_private.member_role(business_id) is not null
 and exists(select 1 from public.pronto_businesses b where b.id=business_id and b.business_type='pharmacy')
);
CREATE OR REPLACE FUNCTION pronto_private.medicine_upsert(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_business uuid; v_product uuid; v_ingredient text; v_strength text; v_form text; v_presentation text; v_manufacturer text; v_rx boolean;
begin
 if auth.uid() is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
    or pg_catalog.pg_column_size(p_data)>4096 then
  raise exception 'medicine_invalid_request' using errcode='22023';
 end if;
 v_business:=(p_data->>'business_id')::uuid;
 v_product:=(p_data->>'product_id')::uuid;
 if v_business is null or v_product is null or pronto_private.member_role(v_business) not in ('owner','manager') then
  raise exception 'medicine_forbidden' using errcode='42501';
 end if;
 if not exists(select 1 from public.pronto_businesses b
      where b.id=v_business and b.business_type='pharmacy' and b.status='active') then
  raise exception 'pharmacy_required' using errcode='42501';
 end if;
 if not exists(select 1 from public.pronto_products p
      where p.id=v_product and p.business_id=v_business) then
  raise exception 'medicine_product_missing' using errcode='22023';
 end if;
 v_ingredient:=pg_catalog.btrim(coalesce(p_data->>'active_ingredient',''));
 v_strength:=pg_catalog.btrim(coalesce(p_data->>'strength',''));
 v_form:=pg_catalog.btrim(coalesce(p_data->>'dosage_form',''));
 v_presentation:=pg_catalog.btrim(coalesce(p_data->>'presentation',''));
 v_manufacturer:=pg_catalog.btrim(coalesce(p_data->>'manufacturer',''));
 if char_length(v_ingredient) not between 2 and 200
  or char_length(v_strength) not between 1 and 80
  or char_length(v_form) not between 2 and 100
  or char_length(v_presentation) not between 2 and 120
  or char_length(v_manufacturer)>160
  or pg_catalog.jsonb_typeof(p_data->'requires_prescription') <> 'boolean' then
  raise exception 'medicine_invalid_fields' using errcode='22023';
 end if;
 v_rx:=(p_data->>'requires_prescription')::boolean;
 insert into public.pronto_medicine_details (
   business_id,product_id,active_ingredient,strength,dosage_form,presentation,manufacturer,requires_prescription
 ) values (v_business,v_product,v_ingredient,v_strength,v_form,v_presentation,v_manufacturer,v_rx)
 on conflict (business_id,product_id) do update set
   active_ingredient=excluded.active_ingredient,strength=excluded.strength,
   dosage_form=excluded.dosage_form,presentation=excluded.presentation,
   manufacturer=excluded.manufacturer,requires_prescription=excluded.requires_prescription,
   updated_at=now();
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
 values (v_business,(select auth.uid()),'medicine_details_saved',
    pg_catalog.jsonb_build_object('product_id',v_product,'requires_prescription',v_rx));
 return pg_catalog.jsonb_build_object('product_id',v_product,'saved',true);
end;
$function$
;
revoke all on function pronto_private.medicine_upsert(jsonb) from public,anon,authenticated;
grant execute on function pronto_private.medicine_upsert(jsonb) to authenticated;
CREATE OR REPLACE FUNCTION public.pronto_medicine_upsert(p_data jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pronto_private.medicine_upsert(p_data);$function$
;
revoke all on function public.pronto_medicine_upsert(jsonb) from public,anon;
grant execute on function public.pronto_medicine_upsert(jsonb) to authenticated;

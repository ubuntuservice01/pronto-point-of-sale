-- Pharmacy lot and expiry guard: additive to existing POS FEFO/batch model.
-- Existing non-pharmacy merchants and historical stock remain untouched.
create or replace function pronto_private.enforce_pharmacy_batch()
returns trigger language plpgsql security definer set search_path=''
as $pharmacy$
declare v_today date:=(now() at time zone 'Africa/Maputo')::date;
begin
 if exists(select 1 from public.pronto_businesses b where b.id=new.business_id and b.business_type='pharmacy') then
  if new.lot_number is null or pg_catalog.btrim(new.lot_number)='' or
     length(new.lot_number)>100 or new.expires_on is null then
   raise exception 'pharmacy_lot_expiry_required' using errcode='22023';
  end if;
  if (tg_op='INSERT' or (tg_op='UPDATE' and
      (new.expires_on is distinct from old.expires_on or new.lot_number is distinct from old.lot_number)))
      and new.expires_on<=v_today then
   raise exception 'pharmacy_expired_receipt_forbidden' using errcode='22023';
  end if;
  if exists(select 1 from public.pronto_batches b
    where b.business_id=new.business_id and b.product_id=new.product_id
      and lower(pg_catalog.btrim(b.lot_number))=lower(pg_catalog.btrim(new.lot_number))
      and b.expires_on is distinct from new.expires_on
      and (tg_op='INSERT' or b.id<>new.id)) then
   raise exception 'pharmacy_batch_expiry_conflict' using errcode='22023';
  end if;
 end if;
 return new;
end $pharmacy$;
revoke all on function pronto_private.enforce_pharmacy_batch() from public,anon,authenticated;
create trigger pronto_pharmacy_batch_guard
 before insert or update of lot_number,expires_on,product_id,business_id on public.pronto_batches
 for each row execute function pronto_private.enforce_pharmacy_batch();

-- All pharmacy checkouts must consume a traceable, unexpired batch.
-- Prescription items remain blocked until professional validation is implemented.
create or replace function pronto_private.guard_pharmacy_stock_movement()
returns trigger language plpgsql security definer set search_path=''
as $pharmacy$
declare v_today date:=(now() at time zone 'Africa/Maputo')::date;
begin
 if not exists(select 1 from public.pronto_businesses where id=new.business_id and business_type='pharmacy') then
  return new;
 end if;
 if new.kind='adjust' and new.qty_delta>0 then
  raise exception 'pharmacy_receive_stock_via_lot_only' using errcode='22023';
 end if;
 if new.kind='sale' then
  if new.batch_id is null or not exists(select 1 from public.pronto_batches b
    where b.id=new.batch_id and b.business_id=new.business_id and b.product_id=new.product_id
      and b.lot_number is not null and pg_catalog.btrim(b.lot_number)<>'' 
      and b.expires_on>v_today) then
   raise exception 'pharmacy_sale_requires_valid_batch' using errcode='22023';
  end if;
  if exists(select 1 from public.pronto_medicine_details m where
     m.business_id=new.business_id and m.product_id=new.product_id
     and m.requires_prescription) then
   raise exception 'pharmacy_prescription_validation_pending' using errcode='42501';
  end if;
 end if;
 return new;
end $pharmacy$;
revoke all on function pronto_private.guard_pharmacy_stock_movement() from public,anon,authenticated;
create trigger pronto_pharmacy_stock_movement_guard
 before insert on public.pronto_stock_movements
 for each row execute function pronto_private.guard_pharmacy_stock_movement();

-- Copy medicine details between branches before their tracked lots are received.
-- A conflicting target medicine formula is never overwritten silently.
create or replace function pronto_private.sync_transferred_medicine()
returns trigger language plpgsql security definer set search_path=''
as $pharmacy$
declare v_source public.pronto_medicine_details%rowtype;
        v_target public.pronto_medicine_details%rowtype;
begin
 if new.target_product_id is null or
    new.target_product_id is not distinct from old.target_product_id then
  return new;
 end if;
 if not exists(select 1 from public.pronto_businesses
      where id=new.business_id and business_type='pharmacy') then
  return new;
 end if;
 select * into v_source from public.pronto_medicine_details
  where business_id=new.business_id and product_id=new.source_product_id;
 if not found then return new; end if;
 if not exists(select 1 from public.pronto_products
       where id=new.target_product_id and business_id=new.business_id)
 then raise exception 'pharmacy_transfer_invalid_target' using errcode='22023'; end if;
 insert into public.pronto_medicine_details
   (business_id,product_id,active_ingredient,strength,dosage_form,presentation,manufacturer,requires_prescription)
 values(new.business_id,new.target_product_id,v_source.active_ingredient,
  v_source.strength,v_source.dosage_form,v_source.presentation,v_source.manufacturer,v_source.requires_prescription)
 on conflict (business_id,product_id) do nothing;
 select * into v_target from public.pronto_medicine_details
 where business_id=new.business_id and product_id=new.target_product_id;
 if v_target.active_ingredient is distinct from v_source.active_ingredient or
    v_target.strength is distinct from v_source.strength or
    v_target.dosage_form is distinct from v_source.dosage_form or
    v_target.presentation is distinct from v_source.presentation or
    v_target.requires_prescription is distinct from v_source.requires_prescription then
  raise exception 'pharmacy_transfer_medicine_mismatch' using errcode='22023';
 end if;
 return new;
end $pharmacy$;
revoke all on function pronto_private.sync_transferred_medicine() from public,anon,authenticated;
create trigger pronto_pharmacy_transfer_medicine
 after update of target_product_id on public.pronto_stock_transfer_lines
 for each row execute function pronto_private.sync_transferred_medicine();

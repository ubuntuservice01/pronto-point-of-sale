-- New product registration stays invisible until its required photograph is attached.
-- Only explicitly pending registrations may be activated by photo upload.
create table if not exists pronto_private.pending_product_photos(
 product_id uuid primary key references public.pronto_products(id) on delete cascade,
 business_id uuid not null,
 created_at timestamptz not null default now()
);
revoke all on pronto_private.pending_product_photos from public,anon,authenticated;
-- No other product-editing RPC may enable a new product without its photo.
create or replace function pronto_private.require_photo_for_activation()
returns trigger language plpgsql security definer set search_path=''
as $
begin
 if new.active and not old.active and new.photo_path is null
  and exists(select 1 from pronto_private.pending_product_photos
    where product_id=new.id and business_id=new.business_id) then
  raise exception 'product_photo_required' using errcode='23514';
 end if;
 return new;
end;
$;
revoke all on function pronto_private.require_photo_for_activation() from public,anon,authenticated;
create trigger pronto_product_requires_photo_to_activate
before update of active on public.pronto_products
for each row execute function pronto_private.require_photo_for_activation();

-- Existing products and CSV imports retain their behaviour.
create or replace function public.pronto_product_create_pending_photo(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_result jsonb; v_id uuid; v_business uuid; v_branch uuid;
begin
 if (select auth.uid()) is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object' then
  raise exception 'invalid_request' using errcode='22023';
 end if;
 v_result:=pronto_private.merchant_action('product_create',p_data);
 v_id:=(v_result->>'product_id')::uuid;
 v_business:=(p_data->>'business_id')::uuid;
 v_branch:=(p_data->>'branch_id')::uuid;
 update public.pronto_products set active=false
  where id=v_id and business_id=v_business and branch_id=v_branch
   and photo_path is null and revision=0;
 if not found then raise exception 'product_pending_photo_failed' using errcode='22023'; end if;
 insert into pronto_private.pending_product_photos(product_id,business_id)
 values(v_id,v_business);
 return v_result;
end;
$$;
revoke all on function public.pronto_product_create_pending_photo(jsonb) from public,anon,authenticated;
grant execute on function public.pronto_product_create_pending_photo(jsonb) to authenticated;

-- Upload is permitted only for a real product and is validated by photo_attach.
-- Activation and photo attachment are part of one PostgreSQL transaction.
create or replace function public.pronto_product_attach_and_activate(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare v_result jsonb;v_id uuid;v_pending uuid;
begin
 if (select auth.uid()) is null then raise exception 'unauthorized' using errcode='42501';end if;
 v_result:=pronto_private.photo_attach(p_data);
 v_id:=(v_result->>'product_id')::uuid;
 delete from pronto_private.pending_product_photos
  where product_id=v_id and business_id=(p_data->>'business_id')::uuid
  returning product_id into v_pending;
 if v_pending is not null then
 update public.pronto_products
   set active=true
   where id=v_id
    and business_id=(p_data->>'business_id')::uuid
    and branch_id=(p_data->>'branch_id')::uuid
    and photo_path=(v_result->>'photo_path')
    and revision=(v_result->>'revision')::integer;
 if not found then raise exception 'product_activation_failed' using errcode='22023';end if;
 end if;
 return v_result;
end;
$$;
revoke all on function public.pronto_product_attach_and_activate(jsonb) from public,anon,authenticated;
grant execute on function public.pronto_product_attach_and_activate(jsonb) to authenticated;

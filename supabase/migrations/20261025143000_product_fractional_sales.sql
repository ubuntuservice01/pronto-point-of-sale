-- Venda por valor / fractional stock: additive, branch-scoped configuration.
-- Existing divisible articles retain their former fractional-selling behaviour.
alter table public.pronto_products
 add column if not exists allow_fractional boolean not null default false;

update public.pronto_products
 set allow_fractional=true
 where unit in ('m','m²','kg','g','l','ml') and allow_fractional=false;

alter table public.pronto_products
 add constraint pronto_product_fraction_unit_chk
 check(not allow_fractional or unit in ('m','m²','kg','g','l','ml'));

-- A single guarded read/update RPC keeps products private and respects the tenant,
-- branch, member role and optimistic product revision already used in inventory.
create or replace function pronto_private.product_fraction(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_business uuid:=(p_data->>'business_id')::uuid;
 v_branch uuid:=(p_data->>'branch_id')::uuid;
 v_role text;
 v_product uuid;
 v_revision integer;
 v_allowed boolean;
 v_current public.pronto_products%rowtype;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
   or pg_catalog.pg_column_size(p_data)>4096 or v_business is null or v_branch is null then
  raise exception 'invalid_fraction_request' using errcode='22023';
 end if;
 v_role:=pronto_private.member_role(v_business);
 if v_role not in ('owner','manager','stock','cashier','finance') or v_role is null then
  raise exception 'shop_access_required' using errcode='42501';
 end if;
 if not exists(select 1 from public.pronto_branches b
   where b.id=v_branch and b.business_id=v_business and b.active) then
  raise exception 'branch_unavailable' using errcode='22023';
 end if;
 if p_action='list' then
  return pg_catalog.jsonb_build_object('products',coalesce((
   select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'id',p.id,'allow_fractional',p.allow_fractional) order by p.id)
   from public.pronto_products p where p.business_id=v_business and p.branch_id=v_branch
  ),'[]'::jsonb));
 elsif p_action='set' then
  if v_role not in ('owner','manager','stock') then
   raise exception 'stock_permission' using errcode='42501';
  end if;
  if p_data->>'product_id' is null or p_data->>'expected_revision' is null
    or pg_catalog.jsonb_typeof(p_data->'allow_fractional') is distinct from 'boolean' then
   raise exception 'invalid_fraction_request' using errcode='22023';
  end if;
  v_product:=(p_data->>'product_id')::uuid;
  v_revision:=(p_data->>'expected_revision')::integer;
  v_allowed:=(p_data->>'allow_fractional')::boolean;
  select * into v_current from public.pronto_products p where p.id=v_product
   and p.business_id=v_business and p.branch_id=v_branch for update;
  if not found then raise exception 'product_unavailable' using errcode='22023'; end if;
  if v_current.revision<>v_revision then
   raise exception 'product_revision_conflict' using errcode='22023';
  end if;
  if v_allowed and v_current.unit not in ('m','m²','kg','g','l','ml') then
   raise exception 'fractional_unit_invalid' using errcode='22023';
  end if;
  update public.pronto_products set allow_fractional=v_allowed,revision=revision+1
   where id=v_current.id;
  insert into public.pronto_audit_events(business_id,actor_id,event,payload)
   values(v_business,v_actor,'product.fraction_setting',
    pg_catalog.jsonb_build_object('product_id',v_product,
     'previous_allow_fractional',v_current.allow_fractional,
     'allow_fractional',v_allowed));
  return pg_catalog.jsonb_build_object('product_id',v_product,
   'allow_fractional',v_allowed,'revision',v_revision+1);
 end if;
 raise exception 'invalid_fraction_action' using errcode='22023';
end $$;
revoke all on function pronto_private.product_fraction(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.product_fraction(text,jsonb) to authenticated;

create or replace function public.pronto_product_fraction(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$ select pronto_private.product_fraction(p_action,p_data); $$;
revoke all on function public.pronto_product_fraction(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_product_fraction(text,jsonb) to authenticated;

-- Validate at the transaction boundary as well: a modified browser cannot
-- bypass a merchant's switch by posting a fractional quantity directly.
create or replace function pronto_private.guard_fractional_sale_item()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_unit text;v_allowed boolean;
begin
 select p.unit,p.allow_fractional into v_unit,v_allowed
  from public.pronto_products p where p.id=new.product_id and p.business_id=new.business_id;
 if not found then raise exception 'product_unavailable' using errcode='22023';end if;
 if new.qty<>pg_catalog.trunc(new.qty) and
   (not v_allowed or v_unit in ('un','caixa','pacote','saco','rolo','par','conjunto')) then
  raise exception 'fractional_sale_not_allowed' using errcode='22023';
 end if;
 return new;
end $$;
drop trigger if exists pronto_fraction_sale_item_guard on public.pronto_sale_items;
create trigger pronto_fraction_sale_item_guard
 before insert on public.pronto_sale_items for each row
 execute function pronto_private.guard_fractional_sale_item();

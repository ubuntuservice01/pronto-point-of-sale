-- Transferência em duas etapas: expedição (retira stock), recepção (acrescenta stock),
-- cancelamento antes de receber (devolve aos lotes originais). Só membros activos
-- owner, manager e stock; todas as transições são transaccionais e auditadas.
create table public.pronto_stock_transfers (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 source_branch_id uuid not null references public.pronto_branches(id),
 target_branch_id uuid not null references public.pronto_branches(id),
 sent_by uuid not null references auth.users(id),
 received_by uuid references auth.users(id),
 cancelled_by uuid references auth.users(id),
 status text not null default 'in_transit' check(status in('in_transit','received','cancelled')),
 reason text not null check(length(btrim(reason)) between 3 and 250),
 idempotency_key uuid not null,
 request_hash text not null,
 created_at timestamptz not null default now(),
 received_at timestamptz,
 cancelled_at timestamptz,
 check(source_branch_id<>target_branch_id),
 unique(business_id,idempotency_key)
);
create table public.pronto_stock_transfer_lines (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.pronto_businesses(id),
 transfer_id uuid not null references public.pronto_stock_transfers(id),
 source_product_id uuid not null references public.pronto_products(id),
 target_product_id uuid references public.pronto_products(id),
 source_batch_id uuid not null references public.pronto_batches(id),
 quantity numeric(16,3) not null check(quantity>0),
 lot_number text,
 expires_on date,
 unit_cost_cents bigint check(unit_cost_cents>=0),
 created_at timestamptz not null default now()
);
create index pronto_transfers_branch_status on public.pronto_stock_transfers(business_id,status,source_branch_id,target_branch_id,created_at);
create index pronto_transfer_lines_transfer on public.pronto_stock_transfer_lines(transfer_id);
alter table public.pronto_stock_transfers enable row level security;
alter table public.pronto_stock_transfer_lines enable row level security;
revoke all on public.pronto_stock_transfers,public.pronto_stock_transfer_lines from public,anon,authenticated;
grant select on public.pronto_stock_transfers,public.pronto_stock_transfer_lines to authenticated;
create policy "transfers_read_member" on public.pronto_stock_transfers for select to authenticated
 using (pronto_private.member_role(business_id) in('owner','manager','stock','finance'));
create policy "transfer_lines_read_member" on public.pronto_stock_transfer_lines for select to authenticated
 using (pronto_private.member_role(business_id) in('owner','manager','stock','finance'));

create or replace function pronto_private.transfer_action(p_action text,p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());v_business uuid;
 v_source uuid;v_target uuid;v_key uuid;v_transfer uuid;v_reason text;
 v_role text;v_items jsonb;v_hash text;v_current record;v_product record;v_batch record;
 v_line record;v_target_product record;v_item jsonb;
 v_product_id uuid;v_quantity numeric(16,3);v_remaining numeric(16,3);
 v_take numeric(16,3);v_lines int:=0;v_requested int:=0;v_source_code text;
 v_seen uuid[]:='{}'::uuid[];v_dest uuid;v_result jsonb;
begin
 if v_actor is null or p_data is null or pg_catalog.jsonb_typeof(p_data)<>'object'
  or pg_catalog.pg_column_size(p_data)>32768 then
  raise exception 'invalid_transfer_request' using errcode='22023';end if;
 v_business:=nullif(p_data->>'business_id','')::uuid;
 v_role:=pronto_private.member_role(v_business);
 if v_role is null or v_role not in('owner','manager','stock') then
  raise exception 'transfer_permission' using errcode='42501';end if;
 if p_action='send' then
  v_source:=nullif(p_data->>'source_branch_id','')::uuid;
  v_target:=nullif(p_data->>'target_branch_id','')::uuid;
  v_key:=nullif(p_data->>'idempotency_key','')::uuid;
  v_items:=p_data->'items';
  v_reason:=pg_catalog.btrim(p_data->>'reason');
  if v_source is null or v_target is null or v_source=v_target or
   v_key is null or v_reason is null or length(v_reason) not between 3 and 250 or
   pg_catalog.jsonb_typeof(v_items)<>'array' or
   pg_catalog.jsonb_array_length(v_items) not between 1 and 40 then
   raise exception 'invalid_transfer' using errcode='22023';end if;
  if (select count(*) from public.pronto_branches
   where business_id=v_business and id in(v_source,v_target) and active)<>2 then
   raise exception 'branch_unavailable' using errcode='22023';end if;
  v_hash:=pg_catalog.md5(p_data::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   'pronto_transfer:'||v_business::text||':'||v_key::text,0));
  select * into v_current from public.pronto_stock_transfers
   where business_id=v_business and idempotency_key=v_key;
  if found then
   if v_current.request_hash<>v_hash then
    raise exception 'idempotency_conflict' using errcode='22023';end if;
   return pg_catalog.jsonb_build_object('transfer_id',v_current.id,
    'duplicate',true,'status',v_current.status);
  end if;
  -- Bloqueio determinístico, de modo a não inverter a ordem com vendas concorrentes.
  for v_product_id in select distinct (el->>'product_id')::uuid as id
   from pg_catalog.jsonb_array_elements(v_items) el order by id loop
   perform 1 from public.pronto_products p where p.business_id=v_business
    and p.branch_id=v_source and p.id=v_product_id and p.active for update;
   if not found then raise exception 'source_product_unavailable' using errcode='22023';end if;
  end loop;
  -- Recusar duplicações de produto, quantidades inválidas e lotes vencidos.
  for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
   v_product_id:=nullif(v_item->>'product_id','')::uuid;
   v_quantity:=nullif(v_item->>'quantity','')::numeric;
   if v_product_id is null or v_product_id=any(v_seen) or
    v_quantity is null or v_quantity<=0 or v_quantity>1000000 or
    v_quantity<>pg_catalog.round(v_quantity,3) then
    raise exception 'invalid_transfer_item' using errcode='22023';end if;
   select * into v_product from public.pronto_products
    where business_id=v_business and branch_id=v_source and id=v_product_id and active;
   if not found or (v_product.unit in('un','caixa','pacote','saco','rolo','par','conjunto')
    and v_quantity<>trunc(v_quantity)) then
    raise exception 'invalid_transfer_unit' using errcode='22023';end if;
   v_seen:=pg_catalog.array_append(v_seen,v_product_id);
  end loop;
  insert into public.pronto_stock_transfers
   (business_id,source_branch_id,target_branch_id,sent_by,reason,idempotency_key,request_hash)
   values(v_business,v_source,v_target,v_actor,v_reason,v_key,v_hash)
   returning id into v_transfer;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
   v_product_id:=(v_item->>'product_id')::uuid;
   v_quantity:=(v_item->>'quantity')::numeric;
   v_remaining:=v_quantity;
   for v_batch in select * from public.pronto_batches b
    where b.business_id=v_business and b.product_id=v_product_id
     and b.qty>0 and (b.expires_on is null or b.expires_on>current_date)
    order by b.expires_on nulls last,b.received_at,b.id for update loop
    exit when v_remaining=0;
    v_take:=least(v_batch.qty,v_remaining);
    update public.pronto_batches set qty=qty-v_take where id=v_batch.id and qty>=v_take;
    if not found then raise exception 'batch_changed' using errcode='40001';end if;
    insert into public.pronto_stock_transfer_lines
     (business_id,transfer_id,source_product_id,source_batch_id,quantity,
      lot_number,expires_on,unit_cost_cents)
     values(v_business,v_transfer,v_product_id,v_batch.id,v_take,
      v_batch.lot_number,v_batch.expires_on,v_batch.unit_cost_cents);
    insert into public.pronto_stock_movements
     (business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
     values(v_business,v_product_id,v_batch.id,v_actor,'transfer',-v_take,v_transfer,
      'Expedição para filial '||v_target::text);
    v_remaining:=v_remaining-v_take;v_lines:=v_lines+1;
   end loop;
   if v_remaining<>0 then raise exception 'transfer_insufficient_valid_stock' using errcode='22023';end if;
   update public.pronto_products set stock=stock-v_quantity,revision=revision+1
    where id=v_product_id and business_id=v_business and branch_id=v_source
     and stock>=v_quantity;
   if not found then raise exception 'transfer_stock_changed' using errcode='40001';end if;
   v_requested:=v_requested+1;
  end loop;
  v_result:=pg_catalog.jsonb_build_object('transfer_id',v_transfer,
   'status','in_transit','products',v_requested,'lot_lines',v_lines,'duplicate',false);

 elsif p_action in('receive','cancel') then
  v_transfer:=nullif(p_data->>'transfer_id','')::uuid;
  if v_transfer is null then raise exception 'transfer_id_required' using errcode='22023';end if;
  select * into v_current from public.pronto_stock_transfers
   where id=v_transfer and business_id=v_business for update;
  if not found then raise exception 'transfer_not_found' using errcode='22023';end if;
  v_source:=v_current.source_branch_id;v_target:=v_current.target_branch_id;
  if v_current.status='received' and p_action='receive' then
   return pg_catalog.jsonb_build_object('transfer_id',v_transfer,'status','received','duplicate',true);
  end if;
  if v_current.status='cancelled' and p_action='cancel' then
   return pg_catalog.jsonb_build_object('transfer_id',v_transfer,'status','cancelled','duplicate',true);
  end if;
  if v_current.status<>'in_transit' then
   raise exception 'transfer_already_finalised' using errcode='22023';end if;

  if p_action='receive' then
   if not exists(select 1 from public.pronto_branches where business_id=v_business
    and id=v_target and active) then raise exception 'target_branch_inactive' using errcode='22023';end if;
   for v_product in
    select p.* from public.pronto_products p
     where p.id in(select distinct source_product_id
       from public.pronto_stock_transfer_lines where transfer_id=v_transfer)
     order by p.id
   loop
    select * into v_target_product from public.pronto_products
     where business_id=v_business and branch_id=v_target
       and lower(code)=lower(v_product.code) for update;
    if found then
     if not v_target_product.active or v_target_product.name<>v_product.name
      or v_target_product.unit<>v_product.unit or v_target_product.category<>v_product.category then
      raise exception 'destination_product_code_conflict' using errcode='22023';end if;
     v_dest:=v_target_product.id;
    else
     insert into public.pronto_products
      (business_id,branch_id,name,category,code,unit,price_cents,min_stock,stock)
      values(v_business,v_target,v_product.name,v_product.category,v_product.code,
       v_product.unit,v_product.price_cents,v_product.min_stock,0)
      returning id into v_dest;
    end if;
    update public.pronto_stock_transfer_lines set target_product_id=v_dest
     where transfer_id=v_transfer and source_product_id=v_product.id;
   end loop;
   for v_line in select * from public.pronto_stock_transfer_lines
    where transfer_id=v_transfer order by id loop
    insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty,unit_cost_cents)
     values(v_business,v_line.target_product_id,v_line.lot_number,
      v_line.expires_on,v_line.quantity,v_line.unit_cost_cents);
    -- Need destination batch ID for transparent FEFO movements.
    declare v_new_batch uuid;
    begin
     select id into v_new_batch from public.pronto_batches
      where business_id=v_business and product_id=v_line.target_product_id
      order by received_at desc,id desc limit 1;
     update public.pronto_products set stock=stock+v_line.quantity,revision=revision+1
      where id=v_line.target_product_id and business_id=v_business and branch_id=v_target;
     insert into public.pronto_stock_movements
      (business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
      values(v_business,v_line.target_product_id,v_new_batch,v_actor,'transfer',
       v_line.quantity,v_transfer,'Recepção da filial '||v_source::text);
    end;
   end loop;
   update public.pronto_stock_transfers set status='received',
    received_by=v_actor,received_at=now() where id=v_transfer;
   v_result:=pg_catalog.jsonb_build_object('transfer_id',v_transfer,
    'status','received','duplicate',false);
  else
   -- Restaurar lotes originais na filial de origem.
   for v_product_id in select distinct source_product_id
    from public.pronto_stock_transfer_lines where transfer_id=v_transfer order by source_product_id loop
    perform 1 from public.pronto_products where id=v_product_id
     and business_id=v_business and branch_id=v_source for update;
    if not found then raise exception 'source_product_missing' using errcode='22023';end if;
   end loop;
   for v_line in select * from public.pronto_stock_transfer_lines
    where transfer_id=v_transfer order by source_batch_id,id loop
    update public.pronto_batches set qty=qty+v_line.quantity where id=v_line.source_batch_id
     and business_id=v_business and product_id=v_line.source_product_id;
    if not found then raise exception 'source_batch_missing' using errcode='22023';end if;
    update public.pronto_products set stock=stock+v_line.quantity,revision=revision+1
     where id=v_line.source_product_id and business_id=v_business and branch_id=v_source;
    insert into public.pronto_stock_movements
     (business_id,product_id,batch_id,actor_id,kind,qty_delta,reference_id,reason)
     values(v_business,v_line.source_product_id,v_line.source_batch_id,v_actor,
      'transfer',v_line.quantity,v_transfer,'Anulação da transferência');
   end loop;
   update public.pronto_stock_transfers set status='cancelled',
    cancelled_by=v_actor,cancelled_at=now() where id=v_transfer;
   v_result:=pg_catalog.jsonb_build_object('transfer_id',v_transfer,
    'status','cancelled','duplicate',false);
  end if;
 else raise exception 'invalid_transfer_action' using errcode='22023';end if;
 insert into public.pronto_audit_events(business_id,actor_id,event,payload)
  values(v_business,v_actor,'stock.transfer_'||p_action,v_result);
 return v_result;
end $$;
revoke all on function pronto_private.transfer_action(text,jsonb) from public,anon,authenticated;
grant execute on function pronto_private.transfer_action(text,jsonb) to authenticated;
create or replace function public.pronto_transfer_action(p_action text,p_data jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select pronto_private.transfer_action(p_action,p_data);$$;
revoke all on function public.pronto_transfer_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.pronto_transfer_action(text,jsonb) to authenticated;

create or replace function pronto_private.transfer_snapshot(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_role text;
begin
 v_role:=pronto_private.member_role(p_business);
 if v_role is null or v_role not in('owner','manager','stock','finance') then
  raise exception 'transfer_permission' using errcode='42501';end if;
 return pg_catalog.jsonb_build_object('transfers',coalesce((
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',t.id,'source_branch_id',t.source_branch_id,'target_branch_id',t.target_branch_id,
   'status',t.status,'reason',t.reason,'created_at',t.created_at,
   'received_at',t.received_at,'lines',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'product_id',l.source_product_id,'product_name',p.name,
     'product_code',p.code,'quantity',l.quantity,'lot_number',l.lot_number)
     order by p.name)
    from public.pronto_stock_transfer_lines l
    join public.pronto_products p on p.id=l.source_product_id
    where l.transfer_id=t.id and l.business_id=p_business),'[]'::jsonb))
   order by t.created_at desc)
  from (select * from public.pronto_stock_transfers t0
   where t0.business_id=p_business order by t0.created_at desc limit 100) t),'[]'::jsonb),
  'generated_at',now());
end $$;
revoke all on function pronto_private.transfer_snapshot(uuid) from public,anon,authenticated;
grant execute on function pronto_private.transfer_snapshot(uuid) to authenticated;
create or replace function public.pronto_transfer_snapshot(p_business uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select pronto_private.transfer_snapshot(p_business);$$;
revoke all on function public.pronto_transfer_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.pronto_transfer_snapshot(uuid) to authenticated;

-- Fase 7: TEST TRANSACTION ONLY. Never remove ROLLBACK.
-- Uses a temporary pharmacy, two branches, a temporary membership of an existing
-- Auth user, and no real commercial transactions. All records are rolled back.
begin;
do $pharmacy_pilot$
declare v_user uuid; v_plan uuid; v_business uuid; v_branch1 uuid; v_branch2 uuid;
 v_product1 uuid;v_product2 uuid;v_batch uuid;v_transfer uuid;
 v_today date:=(now() at time zone 'Africa/Maputo')::date;
 v_denied bool;v_result jsonb;
begin
 select id into v_user from auth.users order by created_at limit 1;
 select id into v_plan from public.pronto_plans order by id limit 1;
 if v_user is null or v_plan is null then raise exception 'pilot_missing_test_prerequisites';end if;
 insert into public.pronto_businesses(name,business_type,status)
 values('PHARMACY PILOT ROLLBACK ONLY','pharmacy','active') returning id into v_business;
 insert into public.pronto_branches(business_id,name) values(v_business,'Pilot A') returning id into v_branch1;
 insert into public.pronto_branches(business_id,name) values(v_business,'Pilot B') returning id into v_branch2;
 insert into public.pronto_memberships(business_id,user_id,role,active) values(v_business,v_user,'owner',true);
 insert into public.pronto_subscriptions(business_id,plan_id,expires_at,cancelled)
 values(v_business,v_plan,now()+interval '2 days',false);
 insert into public.pronto_products(business_id,branch_id,code,name,unit,price_cents,stock,active)
 values(v_business,v_branch1,'PILOT-MED-01','Medicamento fictício','un',100,4,true)
 returning id into v_product1;
 insert into public.pronto_products(business_id,branch_id,code,name,unit,price_cents,stock,active)
 values(v_business,v_branch2,'PILOT-MED-01','Medicamento fictício','un',100,2,true)
 returning id into v_product2;
 insert into public.pronto_medicine_details(business_id,product_id,active_ingredient,strength,dosage_form,presentation)
 values(v_business,v_product1,'Componente fictício','1 mg','Comprimido','Caixa'),
       (v_business,v_product2,'Componente fictício','1 mg','Comprimido','Caixa');
 insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty)
 values(v_business,v_product1,'LOT-X-001',v_today+120,4) returning id into v_batch;
 insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty)
 values(v_business,v_product2,'LOT-X-001',v_today+120,2);
 perform set_config('request.jwt.claim.sub',v_user::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 -- Stage an already shipped transfer before the recall takes effect.
 insert into public.pronto_stock_transfers
 (business_id,source_branch_id,target_branch_id,sent_by,reason,idempotency_key,request_hash)
 values(v_business,v_branch1,v_branch2,v_user,'Temporary pilot transfer',gen_random_uuid(),'test')
 returning id into v_transfer;
 insert into public.pronto_stock_transfer_lines
 (business_id,transfer_id,source_product_id,source_batch_id,quantity,lot_number,expires_on)
 values(v_business,v_transfer,v_product1,v_batch,1,'LOT-X-001',v_today+120);

 v_result:=pronto_private.pharmacy_lot_action('hold',jsonb_build_object(
   'business_id',v_business,'batch_id',v_batch,'reason','Suspected falsification of manufacturer lot'));
 if v_result->>'active'<>'true' then raise exception 'unexpected_pilot_hold_failed';end if;

 v_denied:=false;
 begin
   perform pronto_private.transfer_action('receive',jsonb_build_object(
     'business_id',v_business,'transfer_id',v_transfer));
 exception when sqlstate '42501' then v_denied:=true;end;
 if not v_denied then raise exception 'unexpected_pilot_quarantined_transfer_accepted';end if;

 v_denied:=false;
 begin
   insert into public.pronto_batches(business_id,product_id,lot_number,expires_on,qty)
   values(v_business,v_product2,'LOT-X-001',v_today+120,3);
 exception when sqlstate '42501' then v_denied:=true;end;
 if not v_denied then raise exception 'unexpected_pilot_recalled_cross_branch_receipt_accepted';end if;

 v_denied:=false;
 begin
   insert into public.pronto_stock_movements(business_id,product_id,batch_id,kind,qty_delta)
   select v_business,v_product2,id,'sale',-1 from public.pronto_batches
    where business_id=v_business and product_id=v_product2 limit 1;
 exception when sqlstate '42501' then v_denied:=true;end;
 if not v_denied then raise exception 'unexpected_pilot_recalled_cross_branch_sale_accepted';end if;

 v_denied:=false;
 begin
   perform pronto_private.return_action('return_confirm',jsonb_build_object(
     'business_id',v_business,'branch_id',v_branch1,'sale_id',gen_random_uuid(),
     'idempotency_key',gen_random_uuid(),'reason','Produto devolvido','method','mpesa',
     'reference','TEST-REF','manually_confirmed',true,
     'items',jsonb_build_array(jsonb_build_object('product_id',v_product1,
       'quantity',1,'resellable',true,'expires_on',v_today+120))));
 exception when sqlstate '42501' then
   if SQLERRM='pharmacy_return_restock_requires_quarantine' then v_denied:=true;end if;
 end;
 if not v_denied then raise exception 'unexpected_pilot_pharmacy_return_to_stock_accepted';end if;

 v_result:=pronto_private.pharmacy_trace_snapshot(v_business,v_branch1,v_today-1,v_today);
 if (v_result->'totals'->>'held_batches')::int<>1 then
   raise exception 'unexpected_pilot_trace_totals';end if;
 v_result:=pronto_private.pharmacy_lot_action('release',jsonb_build_object(
   'business_id',v_business,'batch_id',v_batch,
   'reason','Inspecção e libertação aprovadas em ensaio'));
 if v_result->>'active'<>'false' then raise exception 'unexpected_pilot_release_failed';end if;
end $pharmacy_pilot$;
rollback;

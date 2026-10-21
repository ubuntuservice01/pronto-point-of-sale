-- Disposable end-to-end SQL exercise using the existing active test merchant.
-- All mutations are within a transaction and ROLLBACK at the end.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.pronto_memberships where role='owner' and active limit 1),true);
set local role authenticated;
do $$
declare b uuid; br uuid; prod uuid; cash_session uuid; key1 uuid:=gen_random_uuid(); movement_key uuid:=gen_random_uuid(); result jsonb; sal uuid; n integer;
begin
 select business_id into b from public.pronto_memberships where user_id=auth.uid() and role='owner' and active limit 1;
 select id into br from public.pronto_branches where business_id=b and active limit 1;
 if b is null or br is null then raise exception 'fixture_requires_licensed_owner';end if;
 perform public.pronto_cash_control('configure',jsonb_build_object('business_id',b,'branch_id',br,'opening_required',false,'blind_close',true));
 result:=public.pronto_merchant_action('product_create',jsonb_build_object('business_id',b,'branch_id',br,'name','QA-Test-Cash','category','Mercearia','unit','un','price_cents',7000,'min_stock',0,'code','QA-CASH-20261021'));
 prod:=(result->>'product_id')::uuid;
 perform public.pronto_merchant_action('stock_receive',jsonb_build_object('business_id',b,'branch_id',br,'product_id',prod,'quantity',10));
 result:=public.pronto_merchant_action('sale_complete',jsonb_build_object('business_id',b,'branch_id',br,'session_id',null,'idempotency_key',key1,'items',jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),'allocations',jsonb_build_array(jsonb_build_object('method','cash','amount_cents',2000),jsonb_build_object('method','emola','amount_cents',5000)),'cash_received_cents',2000,'discount_cents',0));
 sal:=(result->>'sale_id')::uuid;
 select count(*) into n from public.pronto_sales where id=sal and business_id=b and session_id is null;
 if n<>1 then raise exception 'optional_sale_must_have_no_drawer';end if;
 result:=public.pronto_merchant_action('sale_complete',jsonb_build_object('business_id',b,'branch_id',br,'session_id',null,'idempotency_key',key1,'items',jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),'allocations',jsonb_build_array(jsonb_build_object('method','cash','amount_cents',2000),jsonb_build_object('method','emola','amount_cents',5000)),'cash_received_cents',2000,'discount_cents',0));
 if result->>'duplicate'<>'true' then raise exception 'duplicate_sale_not_rejected';end if;
 perform public.pronto_cash_control('configure',jsonb_build_object('business_id',b,'branch_id',br,'opening_required',true,'blind_close',true));
 begin
  perform public.pronto_merchant_action('sale_complete',jsonb_build_object('business_id',b,'branch_id',br,'idempotency_key',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),'allocations',jsonb_build_array(jsonb_build_object('method','cash','amount_cents',7000)),'cash_received_cents',7000));
  raise exception 'mandatory_cash_bypass';
 exception when sqlstate '42501' then null;
 end;
 result:=public.pronto_cash_control('open',jsonb_build_object('business_id',b,'branch_id',br,'device_id','QA-CASH-DRAWER','opening_cash_cents',200000));
 cash_session:=(result->>'session_id')::uuid;
 begin
  perform public.pronto_cash_control('open',jsonb_build_object('business_id',b,'branch_id',br,'device_id','QA-CASH-DRAWER','opening_cash_cents',0));
  raise exception 'same_terminal_opened_twice';
 exception when unique_violation then null;
 end;
 perform public.pronto_merchant_action('sale_complete',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'idempotency_key',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),'allocations',jsonb_build_array(jsonb_build_object('method','cash','amount_cents',7000)),'cash_received_cents',7000));
 -- Digital payment must appear in reports without increasing physical drawer cash.
 perform public.pronto_merchant_action('sale_complete',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'idempotency_key',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),'allocations',jsonb_build_array(jsonb_build_object('method','mpesa','amount_cents',7000)),'cash_received_cents',0));
 perform public.pronto_hold_action('cash_move',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'direction','in','amount_cents',5000,'reason','Reforço de fundo','idempotency_key',movement_key));
 perform public.pronto_hold_action('cash_move',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'direction','out','amount_cents',1000,'reason','Retirada de fundo','idempotency_key',gen_random_uuid()));
 perform public.pronto_cash_control('request_close',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session));
 begin
  perform public.pronto_hold_action('cash_move',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'direction','in','amount_cents',5000,'reason','Reforço após pedido de fecho','idempotency_key',gen_random_uuid()));
  raise exception 'pending_movement_was_allowed';
 exception when sqlstate '22023' then null;
 end;
 result:=public.pronto_cash_control('close',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'counted_cash_cents',210000));
 if (result->>'expected_cents')::bigint<>211000 or (result->>'difference_cents')::bigint<>-1000 or result->>'close_type'<>'blind' or
  (result->'payments_by_method'->>'mpesa')::bigint<>7000 then
  raise exception 'wrong_blind_reconciliation: %',result;end if;
 result:=public.pronto_hold_action('cash_move',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'direction','in','amount_cents',5000,'reason','Reforço de fundo','idempotency_key',movement_key));
 if result->>'duplicate'<>'true' then raise exception 'retry_after_close_not_idempotent';end if;
 begin
  perform public.pronto_hold_action('cash_move',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'direction','in','amount_cents',5000,'reason','Movimento tardio não autorizado','idempotency_key',gen_random_uuid()));
  raise exception 'late_movement_after_close_was_allowed';
 exception when sqlstate '22023' then null;
 end;
 result:=public.pronto_cash_control('note_difference',jsonb_build_object('business_id',b,'branch_id',br,'session_id',cash_session,'reason','Justificação de diferença de caixa'));
 if result->>'note_added'<>'true' then raise exception 'missing_immutable_note';end if;
end $$;
rollback;
-- Execute only with a privileged SQL test operator in a controlled environment.
-- Transaction deliberately ROLLBACKs all temporary auth users, businesses, products and sales.
-- Tests 12 core tenant RLS tables for merchant A, merchant B and an unrelated identity.
-- An error aborts the transaction; it must be rolled back before reusing the connection.
BEGIN;
INSERT INTO auth.users(id,aud,role) VALUES ('11000000-0000-4000-8000-000000000101','authenticated','authenticated'),('11000000-0000-4000-8000-000000000102','authenticated','authenticated');
INSERT INTO public.pronto_businesses(id,name,status) VALUES ('22000000-0000-4000-8000-000000000101','RLS audit alpha','active'),('22000000-0000-4000-8000-000000000102','RLS audit beta','active');
INSERT INTO public.pronto_plans(id,name,price_cents,duration_days) VALUES ('88000000-0000-4000-8000-000000000101','RLS audit temporary plan',0,30);
INSERT INTO public.pronto_subscriptions(business_id,plan_id,expires_at) VALUES ('22000000-0000-4000-8000-000000000101','88000000-0000-4000-8000-000000000101',now()+interval '30 days'),('22000000-0000-4000-8000-000000000102','88000000-0000-4000-8000-000000000101',now()+interval '30 days');
INSERT INTO public.pronto_memberships(business_id,user_id,role,active) VALUES ('22000000-0000-4000-8000-000000000101','11000000-0000-4000-8000-000000000101','owner',true),('22000000-0000-4000-8000-000000000102','11000000-0000-4000-8000-000000000102','owner',true);
INSERT INTO public.pronto_branches(id,business_id,name) VALUES ('33000000-0000-4000-8000-000000000101','22000000-0000-4000-8000-000000000101','Principal 0'),('33000000-0000-4000-8000-000000000102','22000000-0000-4000-8000-000000000102','Principal 1');
INSERT INTO public.pronto_products(id,business_id,branch_id,code,name,unit,price_cents,stock) VALUES ('44000000-0000-4000-8000-000000000101','22000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000101','rls-0','RLS product 0','un',100,2),('44000000-0000-4000-8000-000000000102','22000000-0000-4000-8000-000000000102','33000000-0000-4000-8000-000000000102','rls-1','RLS product 1','un',100,2);
INSERT INTO public.pronto_batches(business_id,product_id,lot_number,qty) VALUES ('22000000-0000-4000-8000-000000000101','44000000-0000-4000-8000-000000000101','RLS-0',2),('22000000-0000-4000-8000-000000000102','44000000-0000-4000-8000-000000000102','RLS-1',2);
INSERT INTO public.pronto_stock_movements(business_id,product_id,actor_id,kind,qty_delta) VALUES ('22000000-0000-4000-8000-000000000101','44000000-0000-4000-8000-000000000101','11000000-0000-4000-8000-000000000101','receive',2),('22000000-0000-4000-8000-000000000102','44000000-0000-4000-8000-000000000102','11000000-0000-4000-8000-000000000102','receive',2);
INSERT INTO public.pronto_customers(id,business_id,branch_id,name) VALUES ('55000000-0000-4000-8000-000000000101','22000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000101','RLS Customer 0'),('55000000-0000-4000-8000-000000000102','22000000-0000-4000-8000-000000000102','33000000-0000-4000-8000-000000000102','RLS Customer 1');
INSERT INTO public.pronto_cash_sessions(id,business_id,branch_id,operator_id,device_id) VALUES ('66000000-0000-4000-8000-000000000101','22000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000101','11000000-0000-4000-8000-000000000101','rls-dev-0'),('66000000-0000-4000-8000-000000000102','22000000-0000-4000-8000-000000000102','33000000-0000-4000-8000-000000000102','11000000-0000-4000-8000-000000000102','rls-dev-1');
INSERT INTO public.pronto_sales(id,business_id,branch_id,seller_id,session_id,subtotal_cents,total_cents,method,idempotency_key) VALUES ('77000000-0000-4000-8000-000000000101','22000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000101','11000000-0000-4000-8000-000000000101','66000000-0000-4000-8000-000000000101',100,100,'cash',gen_random_uuid()),('77000000-0000-4000-8000-000000000102','22000000-0000-4000-8000-000000000102','33000000-0000-4000-8000-000000000102','11000000-0000-4000-8000-000000000102','66000000-0000-4000-8000-000000000102',100,100,'cash',gen_random_uuid());
INSERT INTO public.pronto_sale_items(business_id,sale_id,product_id,qty,unit_price_cents,line_total_cents,snapshot_name) VALUES ('22000000-0000-4000-8000-000000000101','77000000-0000-4000-8000-000000000101','44000000-0000-4000-8000-000000000101',1,100,100,'RLS product 0'),('22000000-0000-4000-8000-000000000102','77000000-0000-4000-8000-000000000102','44000000-0000-4000-8000-000000000102',1,100,100,'RLS product 1');
INSERT INTO public.pronto_payment_allocations(business_id,sale_id,method,amount_cents) VALUES ('22000000-0000-4000-8000-000000000101','77000000-0000-4000-8000-000000000101','cash',100),('22000000-0000-4000-8000-000000000102','77000000-0000-4000-8000-000000000102','cash',100);
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000101',true);
SET LOCAL ROLE authenticated;
DO $rls_check$
DECLARE tbl text; seen integer; own integer;
BEGIN
 IF auth.uid() IS DISTINCT FROM '11000000-0000-4000-8000-000000000101'::uuid THEN
   RAISE EXCEPTION 'Failed to assume requested JWT identity';
 END IF;
 FOREACH tbl IN ARRAY ARRAY['pronto_businesses','pronto_memberships','pronto_branches','pronto_products','pronto_batches','pronto_stock_movements','pronto_customers','pronto_cash_sessions','pronto_sales','pronto_sale_items','pronto_payment_allocations','pronto_subscriptions'] LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',tbl) INTO seen;
   IF tbl='pronto_businesses' THEN
       EXECUTE 'SELECT count(*) FROM public.pronto_businesses WHERE id=$1' INTO own USING '22000000-0000-4000-8000-000000000101'::uuid;
     ELSE
       EXECUTE format('SELECT count(*) FROM public.%I WHERE business_id=$1',tbl) INTO own USING '22000000-0000-4000-8000-000000000101'::uuid;
     END IF;
     IF seen<>1 OR own<>1 THEN
       RAISE EXCEPTION 'RLS isolation failed: % saw % total / % own',tbl,seen,own;
     END IF;
 END LOOP;
END $rls_check$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000102',true);
SET LOCAL ROLE authenticated;
DO $rls_check$
DECLARE tbl text; seen integer; own integer;
BEGIN
 IF auth.uid() IS DISTINCT FROM '11000000-0000-4000-8000-000000000102'::uuid THEN
   RAISE EXCEPTION 'Failed to assume requested JWT identity';
 END IF;
 FOREACH tbl IN ARRAY ARRAY['pronto_businesses','pronto_memberships','pronto_branches','pronto_products','pronto_batches','pronto_stock_movements','pronto_customers','pronto_cash_sessions','pronto_sales','pronto_sale_items','pronto_payment_allocations','pronto_subscriptions'] LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',tbl) INTO seen;
   IF tbl='pronto_businesses' THEN
       EXECUTE 'SELECT count(*) FROM public.pronto_businesses WHERE id=$1' INTO own USING '22000000-0000-4000-8000-000000000102'::uuid;
     ELSE
       EXECUTE format('SELECT count(*) FROM public.%I WHERE business_id=$1',tbl) INTO own USING '22000000-0000-4000-8000-000000000102'::uuid;
     END IF;
     IF seen<>1 OR own<>1 THEN
       RAISE EXCEPTION 'RLS isolation failed: % saw % total / % own',tbl,seen,own;
     END IF;
 END LOOP;
END $rls_check$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000103',true);
SET LOCAL ROLE authenticated;
DO $rls_check$
DECLARE tbl text; seen integer; own integer;
BEGIN
 IF auth.uid() IS DISTINCT FROM '11000000-0000-4000-8000-000000000103'::uuid THEN
   RAISE EXCEPTION 'Failed to assume requested JWT identity';
 END IF;
 FOREACH tbl IN ARRAY ARRAY['pronto_businesses','pronto_memberships','pronto_branches','pronto_products','pronto_batches','pronto_stock_movements','pronto_customers','pronto_cash_sessions','pronto_sales','pronto_sale_items','pronto_payment_allocations','pronto_subscriptions'] LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',tbl) INTO seen;
   IF seen<>0 THEN
       RAISE EXCEPTION 'RLS isolation failed: unauthorised user saw % records in %',seen,tbl;
     END IF;
 END LOOP;
END $rls_check$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: 12 tables, two merchants, outsider, rolled back' AS outcome,
       (SELECT count(*) FROM public.pronto_businesses) AS businesses_after,
       (SELECT count(*) FROM public.pronto_sales) AS sales_after;

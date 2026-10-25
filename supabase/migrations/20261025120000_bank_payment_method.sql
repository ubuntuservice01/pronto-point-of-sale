-- Distinguish Banco from Transferência throughout the merchant ledger.
-- This migration does not modify existing payments or cash balances.
begin;

alter table public.pronto_sales
 drop constraint pronto_sales_method_check,
 add constraint pronto_sales_method_check
 check (method in ('cash','mpesa','emola','transfer','bank','mixed','credit'));

alter table public.pronto_payment_allocations
 drop constraint pronto_payment_allocations_method_check,
 add constraint pronto_payment_allocations_method_check
 check (method in ('cash','mpesa','emola','transfer','bank'));

alter table public.pronto_debt_payments
 drop constraint pronto_debt_payments_method_check,
 add constraint pronto_debt_payments_method_check
 check (method in ('cash','mpesa','emola','transfer','bank'));

alter table public.pronto_return_headers
 drop constraint pronto_return_headers_method_check,
 add constraint pronto_return_headers_method_check
 check (method in ('cash','mpesa','emola','transfer','bank'));

alter table public.pronto_purchase_payments
 drop constraint pronto_purchase_payments_method_check,
 add constraint pronto_purchase_payments_method_check
 check (method in ('cash','mpesa','emola','transfer','bank'));

alter table public.pronto_expenses
 drop constraint pronto_expenses_method_check,
 add constraint pronto_expenses_method_check
 check (method in ('cash','mpesa','emola','transfer','bank'));

-- Keep the current (audited) implementations of the private RPC functions.
-- Only expand their explicit payment-method allowlists and the split-payment
-- limit, preserving all security checks, ownership and cash-session policies.
-- Guard against unexpected function changes rather than silently patching
-- a different implementation.
do $migration$
declare
 v_signature text;
 v_source text;
 v_changed text;
begin
 foreach v_signature in array array[
  'pronto_private.merchant_action(text,jsonb)',
  'pronto_private.credit_action(text,jsonb)',
  'pronto_private.return_action(text,jsonb)',
  'pronto_private.finance_action(text,jsonb)'
 ] loop
  select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
   into v_source;
  if v_source is null then
   raise exception 'Missing payment function: %',v_signature;
  end if;
  v_changed:=pg_catalog.replace(
   v_source,
   $$'cash','mpesa','emola','transfer'$$,
   $$'cash','mpesa','emola','transfer','bank'$$);
  if v_changed=v_source then
   raise exception 'Payment allowlist changed; review function before migration: %',v_signature;
  end if;
  if v_signature='pronto_private.merchant_action(text,jsonb)' then
   if pg_catalog.strpos(v_changed,'not between 1 and 4')=0 then
    raise exception 'Merchant split-payment limit changed; review before migration';
   end if;
   v_changed:=pg_catalog.replace(v_changed,'not between 1 and 4','not between 1 and 5');
  end if;
  execute v_changed;
 end loop;
end;
$migration$;

commit;

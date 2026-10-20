import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20261020170239_pronto_debt_ledger_least_privilege.sql',import.meta.url),'utf8');
const rollbackTest=readFileSync(new URL('./sql/pronto_core_rls_rollback.sql',import.meta.url),'utf8');

test('Debt ledger privileges prevent anonymous reads and require tenant RLS for authenticated reads',()=>{
  assert.match(migration,/REVOKE ALL PRIVILEGES ON TABLE public\.pronto_debt_ledger FROM anon, authenticated;/i);
  assert.match(migration,/GRANT SELECT ON TABLE public\.pronto_debt_ledger TO authenticated;/i);
  assert.doesNotMatch(migration,/DISABLE ROW LEVEL SECURITY/i);
});

test('Tenant isolation verification covers owner A, owner B and unauthorised actor without retaining fixtures',()=>{
  for(const table of ["pronto_businesses","pronto_memberships","pronto_branches","pronto_products","pronto_batches","pronto_stock_movements","pronto_customers","pronto_cash_sessions","pronto_sales","pronto_sale_items","pronto_payment_allocations","pronto_subscriptions"]){
    assert.ok(rollbackTest.includes("'"+table+"'"),table);
  }
  assert.match(rollbackTest,/\bBEGIN\s*;/i);
  assert.match(rollbackTest,/\bROLLBACK\s*;/i);
  assert.match(rollbackTest,/SET LOCAL ROLE authenticated;/);
  assert.match(rollbackTest,/auth\.uid\(\)/);
});

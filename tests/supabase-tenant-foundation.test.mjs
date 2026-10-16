import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261014190000_pronto_pos_core.sql',import.meta.url),'utf8');

test('Core merchant tables have RLS enabled',()=>{
 for(const table of ['pronto_businesses','pronto_memberships','pronto_products','pronto_sales','pronto_cash_sessions']){
  assert.ok(sql.includes('alter table public.'+table+' enable row level security;'),table);
 }
});
test('Tenant foreign keys include business identifier',()=>{
 for(const clause of [
  'foreign key(business_id,session_id) references public.pronto_cash_sessions(business_id,id)',
  'foreign key(business_id,sale_id) references public.pronto_sales(business_id,id)',
  'foreign key(business_id,product_id) references public.pronto_products(business_id,id)']){
  assert.ok(sql.includes(clause),clause);
 }
});

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

test('Every initially created public tenant table has RLS explicitly enabled',()=>{
 const tables=[...sql.matchAll(/create table public\.(pronto_\w+)\s*\(/g)].map(m=>m[1]);
 assert.ok(tables.length>=20);
 for(const table of tables)assert.ok(sql.includes('alter table public.'+table+' enable row level security;'),table);
});

test('Tenant lookup requires authenticated user, active membership, and matching business',()=>{
 const fn=sql.slice(sql.indexOf('create or replace function pronto_private.member_role('),sql.indexOf('-- By design'));
 for(const clause of ['m.business_id=target_business','m.user_id=(select auth.uid())','m.active=true'])
  assert.ok(fn.includes(clause),clause);
 assert.match(fn,/security definer set search_path=''/);
});

test('Financial and stock reads require business membership or scoped parent records',()=>{
 const policies=sql.slice(sql.indexOf('create policy business_read'),sql.indexOf('-- Keep license plans'));
 for(const table of ['pronto_products','pronto_customers','pronto_debts','pronto_sales','pronto_cash_sessions','pronto_stock_movements']){
  const name=table.replace('pronto_','');
  assert.match(policies,new RegExp('create policy '+name+'_read on public\\.'+table));
 }
 for(const table of ['pronto_sale_items','pronto_payment_allocations','pronto_cash_movements']){
  assert.ok(policies.includes('on public.'+table+' for select to authenticated'),table);
 }
 assert.ok(sql.includes('revoke insert,update,delete,truncate,references,trigger on'));
 assert.ok(sql.includes('from authenticated;'));
});

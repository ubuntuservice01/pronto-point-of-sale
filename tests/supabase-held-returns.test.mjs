import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeReturnSnapshot,renderReturnView} from '../src/supabase-returns-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111',BR='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333',P='44444444-4444-4444-8444-444444444444';
const source={sales:[{id:U,total_cents:30000,status:'completed',method:'cash',created_at:'2026-10-15',items:[
 {product_id:P,name:'Arroz <especial>',unit:'kg',qty:3,returned_qty:1,unit_price_cents:10000}]}],
 returns:[{id:P,sale_id:U,amount_cents:10000,method:'cash',reason:'Devolução inicial',created_at:'2026-10-15'}]};
test('Returns model maps prior refunds and limits available quantities',()=>{
 const data=normalizeReturnSnapshot(source);
 assert.equal(data.sales[0].items[0].returned,1);
 assert.equal(data.sales[0].total,30000);
 assert.throws(()=>normalizeReturnSnapshot({sales:[]}),/returns_snapshot_invalid/);
});
test('Refund forms show sold/returned quantities, cash/digital means and manual acknowledgment',()=>{
 const data=normalizeReturnSnapshot(source);
 const html=renderReturnView({returns:data,selectedSaleId:U,session:{id:BR}});
 assert.ok(html.includes('data-shop-form="return_confirm"'));
 assert.ok(html.includes('max="2"'));
 assert.ok(html.includes('name="resellable_0"'));
 assert.ok(html.includes('name="confirmed"'));
 assert.ok(html.includes('M-Pesa'));
 assert.ok(html.includes('Arroz &lt;especial&gt;'));
 assert.ok(!html.includes('<especial>'));
 assert.match(html,/nem emite nota de crédito fiscal/i);
});
test('Held-sale, cashier movement and refund RPC require signed-in user and exact action allowlists',async()=>{
 const calls=[];const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return reply({access_token:'test-token',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply({id:U,email:'test@pronto.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(false);
  if(url.includes('/pronto_memberships?'))return reply([{business_id:B,role:'owner',active:true}]);
  if(url.includes('/pronto_businesses?'))return reply([{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_hold_list'))return reply([{id:P,cart:[{productId:U,quantity:2}],operator_id:U}]);
  if(url.endsWith('/rpc/pronto_return_snapshot'))return reply(source);
  if(url.endsWith('/rpc/pronto_hold_action'))return reply({ok:true});
  if(url.endsWith('/rpc/pronto_return_action'))return reply({return_id:P,amount_cents:10000});
  return reply({},404);
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await assert.rejects(()=>client.holdList(B,BR),/supabase_unauthorized/);
 await client.signIn('test@pronto.org','password');
 assert.equal((await client.holdList(B,BR))[0].cart[0].quantity,2);
 assert.equal((await client.returnSnapshot(B,BR)).sales[0].items.length,1);
 await client.holdAction('cash_move',{business_id:B,branch_id:BR,idempotency_key:P,session_id:BR,amount_cents:100,direction:'in',reason:'teste'});
 await client.returnAction('return_confirm',{business_id:B,branch_id:BR,sale_id:U});
 assert.ok(calls.some(c=>c.url.endsWith('/rpc/pronto_hold_action')&&c.opts.headers.Authorization==='Bearer test-token'));
 assert.ok(calls.some(c=>c.url.endsWith('/rpc/pronto_return_action')&&c.opts.headers.Authorization==='Bearer test-token'));
 await assert.rejects(()=>client.returnAction('delete_all',{}),/return_action_invalid/);
 await assert.rejects(()=>client.holdAction('refund_anything',{}),/hold_action_invalid/);
});
test('SQL enforces tenant membership, stock ledger and idempotent inventory/cash returns',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015194500_pronto_partial_returns.sql',import.meta.url),'utf8');
 const fix=readFileSync(new URL('../supabase/migrations/20261015194800_pronto_refund_stock_kind.sql',import.meta.url),'utf8');
 const hold=readFileSync(new URL('../supabase/migrations/20261015193000_pronto_held_cash.sql',import.meta.url),'utf8');
 const cash=readFileSync(new URL('../supabase/migrations/20261015193500_pronto_idempotent_cash_movement.sql',import.meta.url),'utf8');
 for(const pattern of [/security definer/,/member_role/,/idempotency_conflict/,/pronto_return_lines/,/pronto_stock_movements/,/pronto_cash_movements/,/return_over_sold/,/manually_confirmed/])assert.match(sql,pattern);
 assert.match(fix,/'refund',v_qty,v_refund/);
 assert.match(hold,/stock_reserved',false/);
 assert.match(cash,/pronto_cash_movements_unique_request/);
 assert.match(cash,/pg_advisory_xact_lock/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeFinanceSnapshot,renderFinanceView} from '../src/supabase-finance-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111',BR='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333',P='44444444-4444-4444-8444-444444444444';
const raw={suppliers:[{id:U,name:'Fornecedor <A>',phone:'84',active:true}],
 purchases:[{id:P,supplier:'Fornecedor <A>',total_cents:12000,balance_cents:8000,items:[{product_id:U,quantity:2}]}],
 expenses:[{id:U,label:'Combustível',category:'Transportes',amount_cents:2500,method:'cash'}],
 schedules:[{id:U,label:'Energia',amount_cents:1000,next_due_on:'2026-09-01',repeat_months:1,active:true}]};
const data=normalizeFinanceSnapshot(raw);
test('Supplier form supports creation and editing, names escaped',()=>{
 const html=renderFinanceView({view:'suppliers',finance:data,role:'owner',supplierId:U});
 assert.ok(html.includes('supplier_save'));
 assert.ok(html.includes('name="supplier_id"'));
 assert.ok(html.includes('Fornecedor &lt;A&gt;'));
 assert.ok(!html.includes('<A>'));
});
test('Multi-line purchase accepts real stock items and payable balance',()=>{
 const html=renderFinanceView({view:'purchases',finance:data,
  role:'manager',products:[{id:P,name:'Arroz'}],lines:3});
 assert.equal((html.match(/class="finance-purchase-line"/g)||[]).length,3);
 assert.ok(html.includes('data-shop-form="purchase_receive"'));
 assert.ok(html.includes('data-shop-form="purchase_payment"'));
 assert.ok(html.includes('Fornecedor &lt;A&gt;'));
 assert.ok(html.includes('80,00 MT'));
});
test('Expenses are manual transactions; recurrent expenses are explicit reminders',()=>{
 const html=renderFinanceView({view:'expenses',finance:data,role:'finance'});
 assert.ok(html.includes('data-shop-form="expense_add"'));
 assert.ok(html.includes('data-shop-form="expense_schedule_save"'));
 assert.ok(html.includes('NÃO são efectuados automaticamente'));
 assert.ok(html.includes('Combustível'));
 assert.ok(html.includes('25,00 MT'));
});
test('Finance RPCs are guarded and scoped to the authenticated tenant',async()=>{
 const calls=[],reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return reply(200,{access_token:'test-token',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply(200,{id:U,email:'shop@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(200,false);
  if(url.includes('pronto_memberships?'))return reply(200,[{business_id:B,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return reply(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_finance_snapshot'))return reply(200,raw);
  if(url.endsWith('/rpc/pronto_finance_action'))return reply(200,{expense_id:U});
  return reply(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.signIn('shop@example.org','password');
 assert.equal((await client.financeSnapshot(B,BR)).suppliers.length,1);
 await client.financeAction('expense_add',{business_id:B,branch_id:BR,label:'Energia'});
 const call=calls.find(c=>c.url.endsWith('/rpc/pronto_finance_action'));
 assert.deepEqual(JSON.parse(call.opts.body),{p_action:'expense_add',p_data:{business_id:B,branch_id:BR,label:'Energia'}});
 assert.equal(call.opts.headers.Authorization,'Bearer test-token');
 await assert.rejects(()=>client.financeAction('delete_business',{}),/finance_action_invalid/);
 await assert.rejects(()=>client.financeSnapshot(B,'bad'),/shop_scope/);
});
test('DB creates entries and cash movements only inside auditable protected tenant RPCs',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015185000_pronto_finance_purchases_expenses.sql',import.meta.url),'utf8');
 for(const text of [/security definer/,/pg_advisory_xact_lock/,/for update/,/pronto_stock_movements/,
  /pronto_cash_movements/,/pronto_expenses/,/idempotency_conflict/,/pronto_private.member_role/,
  /manual_confirmed/,/reminder_only/])assert.match(sql,text);
 assert.match(sql,/revoke all on function public.pronto_finance_action/);
});

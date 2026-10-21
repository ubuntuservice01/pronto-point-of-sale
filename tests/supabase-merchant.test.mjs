import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {toCents,toQuantity,cartTotal,makeSaleRequest,normalizeMerchantSnapshot} from '../src/supabase-shop-core.js';
import {renderShopScreen,shopPaymentPanel} from '../src/supabase-shop-ui.js';
const ID=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const products=[
 {id:ID[2],code:'PR-000001',name:'Arroz',unit:'kg',category:'Alimentação',priceCents:8500,stock:50,minStock:5},
 {id:ID[3],code:'10002',name:'Sabonete',unit:'un',category:'Higiene',priceCents:4500,stock:12,minStock:4}
];
const stock={business_id:ID[0],branch_id:ID[1],role:'cashier',branches:[{id:ID[1],name:'Principal'}],
 products:products.map(p=>({id:p.id,name:p.name,code:p.code,unit:p.unit,category:p.category,
  price_cents:p.priceCents,stock:p.stock,min_stock:p.minStock,active:true})),
 cash_sessions:[{id:ID[1],operator_id:ID[0],status:'open',opening_cash_cents:20000,opened_at:'2026-10-15T12:00:00Z'}],
 recent_sales:[],generated_at:'2026-10-15T12:00:00Z'};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json'}});
function fakeSupabase(access=true){
 const calls=[];const fetchImpl=async(url,config)=>{
  calls.push({url,...config});
  if(url.includes('/auth/v1/token?'))return json(200,{access_token:'test-token',user:{id:ID[0]},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return json(200,{id:ID[0],email:'caixa@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return json(200,false);
  if(url.includes('/rest/v1/pronto_memberships?'))return json(200,[{business_id:ID[0],role:'cashier',active:true}]);
  if(url.includes('/rest/v1/pronto_businesses?'))return json(200,[{id:ID[0],name:'Loja Principal',status:'active'}]);
  if(url.includes('/rest/v1/pronto_branches?'))return json(200,[{id:ID[1],name:'Principal'}]);
  if(url.endsWith('/rest/v1/rpc/pronto_merchant_snapshot'))return json(access?200:403,access?stock:{error:'denied'});
  if(url.endsWith('/rest/v1/rpc/pronto_merchant_action'))return json(access?200:403,access?{sale_id:ID[3],duplicate:false,total_cents:7000,change_cents:0}:{error:'denied'});
  return json(404,{});
 };
 return {calls,fetchImpl};
}
test('Money conversion uses exact integer cents and fractional stock units are checked',()=>{
 assert.equal(toCents('1.250,50'),125050);
 assert.equal(toCents('1250.50'),125050);
 assert.equal(toCents('70'),7000);
 assert.throws(()=>toCents('-1'),/amount_invalid/);
 assert.throws(()=>toCents('1.1234'),/amount_invalid/);
 assert.equal(toQuantity('1,250','kg'),1.25);
 assert.throws(()=>toQuantity('0,25','un'),/quantity_invalid/);
 assert.throws(()=>toQuantity('2.1234','kg'),/quantity_invalid/);
});
test('Split tender 20 MT cash and 50 MT e-Mola is one 70 MT sale with a stable idempotency key',()=>{
 const article={...products[0],priceCents:7000};
 const key=ID[3];
 const payload=makeSaleRequest({businessId:ID[0],branchId:ID[1],sessionId:ID[2],
  cart:[{productId:article.id,quantity:1}],products:[article],discount:'0',
  allocations:[{method:'cash',amount:'20'},{method:'emola',amount:'50',reference:'EM-9'}],
  cashReceived:'20',idempotencyKey:key});
 assert.equal(payload.discount_cents,0);
 assert.equal(payload.cash_received_cents,2000);
 assert.deepEqual(payload.allocations,[
  {method:'cash',amount_cents:2000,reference:''},
  {method:'emola',amount_cents:5000,reference:'EM-9'}
 ]);
 assert.equal(payload.idempotency_key,key);
 const same=makeSaleRequest({businessId:ID[0],branchId:ID[1],sessionId:ID[2],
  cart:[{productId:article.id,quantity:1}],products:[article],discount:'0',
  allocations:[{method:'cash',amount:'20'},{method:'emola',amount:'50',reference:'EM-9'}],
  cashReceived:'20',idempotencyKey:key});
 assert.deepEqual(same,payload);
});
test('Rejects partial/mismatched payments, double methods, short cash and oversold stock',()=>{
 const args={businessId:ID[0],branchId:ID[1],sessionId:ID[2],
  cart:[{productId:products[1].id,quantity:1}],products,discount:'0',
  idempotencyKey:ID[3],cashReceived:'20'};
 assert.throws(()=>makeSaleRequest({...args,allocations:[{method:'cash',amount:'10'}]}),/payment_mismatch/);
 assert.throws(()=>makeSaleRequest({...args,allocations:[{method:'cash',amount:'20'},{method:'cash',amount:'25'}]}),/payment_invalid/);
 assert.throws(()=>makeSaleRequest({...args,allocations:[{method:'cash',amount:'45'}]}),/cash_short/);
 assert.throws(()=>makeSaleRequest({...args,cart:[{productId:products[1].id,quantity:50}],allocations:[{method:'cash',amount:'45'}]}),/stock_unavailable/);
});
test('Authorized merchant can list branches, fetch a branch-scoped snapshot and invoke checkout RPC',async()=>{
 const fake=fakeSupabase();
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:fake.fetchImpl});
 const account=await client.signIn('caixa@example.org','password');
 assert.equal(account.ubuntuAdmin,false);
 assert.equal(account.grants[0].name,'Loja Principal');
 const branches=await client.merchantBranches(ID[0]);
 assert.deepEqual(branches,[{id:ID[1],name:'Principal'}]);
 const snap=await client.merchantSnapshot(ID[0],ID[1]);
 assert.equal(snap.products.length,2);
 assert.equal(snap.sessions[0].openingCash,20000);
 await client.merchantAction('sale_complete',{business_id:ID[0],branch_id:ID[1],idempotency_key:ID[3]});
 const rpc=fake.calls.find(c=>c.url.endsWith('/rest/v1/rpc/pronto_merchant_action'));
 assert.equal(rpc.headers.Authorization,'Bearer test-token');
 assert.deepEqual(JSON.parse(rpc.body),{p_action:'sale_complete',p_data:{business_id:ID[0],branch_id:ID[1],idempotency_key:ID[3]}});
 await assert.rejects(()=>client.merchantAction('delete_all',{business_id:ID[0]}),/shop_action_invalid/);
 assert.ok(fake.calls.every(c=>c.cache==='no-store'));
});
test('Forbidden merchant RPC denies the operation without erasing the login',async()=>{
 const fake=fakeSupabase(false);
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:fake.fetchImpl});
 await client.signIn('caixa@example.org','pw');
 await assert.rejects(()=>client.merchantSnapshot(ID[0],ID[1]),/supabase_forbidden/);
 await assert.rejects(()=>client.merchantAction('sale_complete',{}),/supabase_forbidden/);
 assert.equal((await client.account()).userId,ID[0]);
});
test('Sales page has persistent fixed payment buttons, split fields, branch selector and no fictitious merchandise',()=>{
 const snapshot=normalizeMerchantSnapshot(stock);
 const account={userId:ID[0],email:'caixa@example.org',grants:[{id:ID[0],name:'Loja Principal',role:'cashier'}]};
 const html=renderShopScreen({account,grants:account.grants,grant:account.grants[0],branches:snapshot.branches,
  branchId:ID[1],data:snapshot,cart:[{productId:products[1].id,quantity:1}],
  view:'sell',method:'mixed',discount:'0',query:'',feedback:'',pending:null});
 assert.ok(html.includes('shop-search'));
 assert.ok(html.includes('data-shop-method="emola"'));
 assert.ok(html.includes('data-shop-method="mixed"'));
 assert.ok(html.includes('data-cart-qty'));
 assert.ok(html.includes('name="pay_emola"'));
 assert.ok(html.includes('name="pay_cash"'));
 assert.ok(html.includes('data-shop-add'));
 assert.ok(html.includes('shop-branch-select'));
 const other=shopPaymentPanel({method:'cash',cart:[],products,discount:'0',session:null});
 assert.ok(!other.includes('shop-error'));
});
test('Merchant rendered names are HTML escaped to prevent injection',()=>{
 const snapshot=normalizeMerchantSnapshot({...stock,products:[{...stock.products[0],name:'<script>alert(1)</script>'}]});
 const account={userId:ID[0],email:'"><img src=x onerror=alert(1)>',grants:[{id:ID[0],name:'Loja',role:'cashier'}]};
 const html=renderShopScreen({account,grants:account.grants,grant:account.grants[0],branches:snapshot.branches,branchId:ID[1],data:snapshot,cart:[],view:'sell',method:'cash',discount:'0',query:'',feedback:'',pending:null});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img src=x'));
});
test('Database migration implements atomic stock ledger, FEFO, idempotency and strict authorization',()=>{
 const initial=readFileSync(new URL('../supabase/migrations/20261015145000_pronto_merchant_transactions.sql',import.meta.url),'utf8');
 const fixed=readFileSync(new URL('../supabase/migrations/20261015150500_pronto_checkout_json_iteration.sql',import.meta.url),'utf8');
 assert.match(initial,/pronto_private\.member_role\(v_business\)/);
 assert.match(initial,/pg_advisory_xact_lock/);
 assert.match(initial,/idempotency_conflict/);
 assert.match(initial,/insufficient_unexpired_lots/);
 assert.match(initial,/order by b\.expires_on asc nulls last/);
 assert.match(initial,/insert into public\.pronto_payment_allocations/);
 assert.match(initial,/insert into public\.pronto_stock_movements/);
 assert.match(initial,/create table public\.pronto_product_code_counters/);
 assert.match(fixed,/v_line\.item/);
 assert.doesNotMatch(initial,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

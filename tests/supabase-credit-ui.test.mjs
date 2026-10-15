import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCreditView,normalizeCreditSnapshot,creditCheckoutFields,creditStatementHTML,creditWhatsAppURL} from '../src/supabase-credit-ui.js';
import {renderShopScreen,shopPaymentPanel} from '../src/supabase-shop-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111',BR='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',D='55555555-5555-4555-8555-555555555555';
const raw={
 business_id:B,branch_id:BR,role:'owner',today:'2026-10-15',
 customers:[{id:C,name:'Maria <Silva>',phone:'841234567',active:true,credit_limit_cents:500000,credit_blocked:false,credit_revision:2,note:'',created_at:'2026-10-01'}],
 debts:[{id:D,sale_id:U,customer_id:C,original_cents:20000,balance_cents:12000,status:'open',state:'vencido',due_on:'2026-09-01',created_at:'2026-08-01',items:[{name:'Arroz',qty:2,unit_price_cents:10000,line_total_cents:20000}]}],
 payments:[{id:U,debt_id:D,method:'cash',amount_cents:8000,balance_after_cents:12000,created_at:'2026-10-10'}],
 customer_sales:[{id:U,customer_id:C,customer_name:'Maria',method:'credit',total_cents:20000,created_at:'2026-08-01'}]
};
const credit=normalizeCreditSnapshot(raw);
test('Credit snapshot maps client, balances, payments and overdue state',()=>{
 assert.equal(credit.customers[0].creditLimit,500000);
 assert.equal(credit.debts[0].balance,12000);
 assert.equal(credit.debts[0].items[0].total,20000);
 assert.equal(credit.today,'2026-10-15');
 assert.throws(()=>normalizeCreditSnapshot({customers:[]}),/credit_snapshot_invalid/);
});
test('Customer CRUD and credit-policy forms are escaped and owner-only',()=>{
 const html=renderCreditView({view:'customers',credit,role:'owner',selectedCustomerId:C});
 assert.ok(html.includes('customer_save')&&html.includes('credit_policy'));
 assert.ok(html.includes('Histórico de compras')&&html.includes('200,00 MT'));
 assert.ok(html.includes('Maria &lt;Silva&gt;'));assert.ok(!html.includes('<Silva>'));
 const cashier=renderCreditView({view:'customers',credit,role:'cashier',selectedCustomerId:C});
 assert.ok(!cashier.includes('data-shop-form="credit_policy"'));
});
test('Debt register displays due dates and manual split payments with filters and receipts',()=>{
 const owner=renderCreditView({view:'debts',credit,role:'owner',session:{id:U},filter:'open'});
 assert.ok(owner.includes('1 dívida(s) vencida(s)'));
 assert.ok(owner.includes('data-credit-whatsapp'));
 assert.ok(owner.includes('data-credit-receipt'));
 assert.ok(owner.includes('data-shop-form="debt_payment"'));
 assert.ok(owner.includes('M-Pesa'));
 const paid=renderCreditView({view:'debts',credit,role:'cashier',session:null,filter:'liquidado'});
 assert.ok(!paid.includes('1 dívida(s) vencida(s)'));
 assert.ok(!paid.includes('credit-debt-item'));
});
test('Sales are customer-linked and credit-specific fields are only enabled on credit',()=>{
 const c=creditCheckoutFields({credit,selected:C,method:'cash'});
 assert.ok(c.includes('shop-sale-customer'));
 assert.ok(!c.includes('shop-credit-due'));
 const product={id:U,name:'Arroz',code:'PR-000001',unit:'kg',priceCents:10000,stock:10,minStock:1};
 const html=shopPaymentPanel({method:'credit',products:[product],cart:[{productId:U,quantity:2}],session:{id:BR},role:'cashier',credit,selectedCustomerId:C,creditDue:'2026-11-10'});
 assert.ok(html.includes('shop-credit-due'));
 assert.ok(html.includes('value="2026-11-10"'));
 assert.ok(html.includes('Vender a crédito')||html.includes('Voltar a pagamento imediato'));
 assert.ok(html.includes('Registar dívida'));
});
test('Receipt HTML is informative only; WhatsApp requires valid client phone and user action',()=>{
 const html=creditStatementHTML(credit,C,{debtId:D});
 assert.ok(html.includes('não fiscal'));
 assert.ok(html.includes('120,00 MT'));
 assert.ok(!html.includes('<Silva>'));
 const url=creditWhatsAppURL(credit,D);
 assert.ok(url.startsWith('https://wa.me/258841234567?text='));
 assert.ok(decodeURIComponent(url).includes('120,00 MT'));
 assert.throws(()=>creditWhatsAppURL({...credit,customers:[{...credit.customers[0],phone:'not a phone'}]},D),/customer_phone/);
});
test('Supabase client requests customer snapshot as an authenticated tenant/branch-scoped RPC',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(url.includes('grant_type=password'))return reply(200,{access_token:'token',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply(200,{id:U,email:'caixa@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(200,false);
  if(url.includes('pronto_memberships?'))return reply(200,[{business_id:B,role:'cashier',active:true}]);
  if(url.includes('pronto_businesses?'))return reply(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_credit_snapshot'))return reply(200,raw);
  if(url.endsWith('/rpc/pronto_merchant_action'))return reply(200,{customer_id:C});
  return reply(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.signIn('caixa@example.org','test');
 assert.equal((await client.creditSnapshot(B,BR)).debts.length,1);
 await client.merchantAction('customer_save',{business_id:B,branch_id:BR,name:'Cliente'});
 const q=calls.find(c=>c.url.endsWith('/rpc/pronto_credit_snapshot'));
 assert.deepEqual(JSON.parse(q.opts.body),{p_business:B,p_branch:BR});
 assert.equal(q.opts.headers.Authorization,'Bearer token');
 await assert.rejects(()=>client.creditSnapshot(B,'unscoped'),/shop_scope/);
 await assert.rejects(()=>client.merchantAction('delete_all_debts',{}),/shop_action_invalid/);
});

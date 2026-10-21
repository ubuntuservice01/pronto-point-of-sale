import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {shopPaymentPanel} from '../src/supabase-shop-ui.js';
import {creditCheckoutFields} from '../src/supabase-credit-ui.js';
import {makeCreditSaleRequest} from '../src/supabase-credit-core.js';

const products=[{id:'p1',name:'Produto',code:'P01',unit:'un',priceCents:39932,stock:10}];
const cart=[{productId:'p1',quantity:1}];
const customer={id:'c1',name:'Gabriel',active:true,creditLimit:0,creditBlocked:false};
const credit=(overrides={})=>({today:'2026-10-21',customers:[customer],debts:[],...overrides});
const panel=(data)=>shopPaymentPanel({
 method:'credit',cart,products,session:{id:'shift1'},role:'cashier',
 selectedCustomerId:'c1',creditDue:'2026-10-31',credit:data,
});

test('client with zero limit sees explanation beside the Register Debt button',()=>{
 const html=panel(credit());
 assert.match(html,/data-credit-limit-warning/);
 assert.match(html,/crédito disponível de 0,00 MT/);
 assert.match(html,/venda de 399,32 MT/);
 assert.match(html,/opção Clientes/);
 assert.match(html,/id="shop-checkout-feedback"/);
 assert.match(html,/Registar dívida · 399,32 MT/);
});

test('client with sufficient limit sees no warning',()=>{
 const html=panel(credit({customers:[{...customer,creditLimit:50000}]}));
 assert.doesNotMatch(html,/data-credit-limit-warning/);
});

test('positive outstanding balances are shown even without a status property',()=>{
 const html=creditCheckoutFields({credit:credit({debts:[{id:'d1',customerId:'c1',balance:1000}]}),selected:'c1',method:'credit'});
 assert.match(html,/Em dívida: 10,00 MT/);
});

test('a previous debt reduces available credit even without a status property',()=>{
 const html=panel(credit({customers:[{...customer,creditLimit:40000}],debts:[{customerId:'c1',balance:1000}]}));
 assert.match(html,/crédito disponível de 390,00 MT/);
 assert.match(html,/data-credit-limit-warning/);
});

test('credit policy still blocks a sale exceeding the approved limit',()=>{
 assert.throws(()=>makeCreditSaleRequest({
  businessId:'b1',branchId:'br1',sessionId:'s1',cart,customer,
  dueOn:'2026-10-31',today:'2026-10-21',outstanding:0,total:39932,
  idempotencyKey:'operation1',
 }),/debt_limit/);
});

test('sale submission retains clear messages and inline warning after rerender',()=>{
 const source=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 assert.match(source,/querySelector\('#shop-checkout-feedback'\)/);
 assert.match(source,/debt_limit:'Limite de crédito insuficiente/);
 assert.match(source,/render\(\);\s*showMessage\('Venda ainda sem confirmação/);
});

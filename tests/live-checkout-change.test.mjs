import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkoutCashPreview} from '../src/supabase-checkout-change.js';
import {shopPaymentPanel} from '../src/supabase-shop-ui.js';
const p={id:'33333333-3333-4333-8333-333333333333',name:'Arroz',code:'AR-9',unit:'saco',
 priceCents:85000,stock:10,minStock:2};
const cart=[{productId:p.id,quantity:1}];
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Troco updates from exact centavos when the cashier enters cash',()=>{
 assert.deepEqual(checkoutCashPreview({method:'cash',totalCents:85000,receivedRaw:'1000'}),{
  state:'change',cashDue:85000,received:100000,change:15000,shortfall:0});
 assert.equal(checkoutCashPreview({method:'cash',totalCents:85000,receivedRaw:'850'}).state,'exact');
 const missing=checkoutCashPreview({method:'cash',totalCents:85000,receivedRaw:'800'});
 assert.equal(missing.state,'short');assert.equal(missing.shortfall,5000);
 assert.equal(checkoutCashPreview({method:'cash',totalCents:85000,receivedRaw:''}).state,'waiting');
 assert.equal(checkoutCashPreview({method:'cash',totalCents:0,receivedRaw:'1000'}).state,'empty');
 assert.equal(checkoutCashPreview({method:'cash',totalCents:85000,receivedRaw:'-1'}).state,'invalid');
});
test('Split tender calculates change only on the cash portion, not on digital money',()=>{
 const change=checkoutCashPreview({method:'mixed',totalCents:100000,cashPortionRaw:'200',receivedRaw:'250'});
 assert.equal(change.cashDue,20000);assert.equal(change.change,5000);
 assert.equal(checkoutCashPreview({method:'mixed',totalCents:100000,cashPortionRaw:'300',receivedRaw:'200'}).shortfall,10000);
 assert.equal(checkoutCashPreview({method:'mixed',totalCents:100000,cashPortionRaw:'0',receivedRaw:''}).state,'no_cash');
 assert.equal(checkoutCashPreview({method:'mixed',totalCents:100000,cashPortionRaw:'1500',receivedRaw:'1600'}).state,'invalid_split');
 assert.equal(checkoutCashPreview({method:'emola',totalCents:100000,receivedRaw:''}).state,'hidden');
});
test('Checkout panel shows large live change beneath a blank received field',()=>{
 const cash=shopPaymentPanel({method:'cash',cart,products:[p],session:{id:'a'}});
 assert.match(cash,/name="cash_received" value=""/);
 assert.match(cash,/data-shop-total-cents="85000"/);
 assert.match(cash,/data-shop-change-preview/);
 assert.match(cash,/data-shop-change-amount/);
 assert.match(cash,/aria-live="polite"/);
 const mixed=shopPaymentPanel({method:'mixed',cart,products:[p],session:{id:'a'}});
 assert.match(mixed,/data-shop-change-preview/);
 assert.doesNotMatch(mixed,/name="cash_received" value=""[^>]*required/);
 const digital=shopPaymentPanel({method:'emola',cart,products:[p],session:{id:'a'}});
 assert.doesNotMatch(digital,/data-shop-change-preview/);
 const dashboard=read('src/supabase-shop-dashboard.js');
 assert.match(dashboard,/checkoutCashPreview\(/);
 assert.match(dashboard,/el\.name==='cash_received'/);
 assert.match(dashboard,/el\.name==='pay_cash'/);
 assert.match(dashboard,/Falta '\+MONEY\(/);
 const modal=read('src/ui/pronto-sale-success.js');
 assert.match(modal,/pronto-sale-success-change/);
 assert.match(modal,/receipt\.change/);
 const css=read('src/supabase-checkout-flow.css');
 assert.match(css,/shop-change-preview\[data-state="short"\]/);
 assert.match(css,/#087f68/);
});

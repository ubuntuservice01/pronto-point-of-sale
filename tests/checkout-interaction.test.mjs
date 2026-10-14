import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesSaleProduct, productByExactCode } from '../src/product-search.js';

test('Search finds product names without accents or case sensitivity', () => {
 const p = { name: 'Óleo alimentar', code: 'XyZ-19', category: 'Alimentação', active: true };
 assert.equal(matchesSaleProduct(p, 'OLEO'), true);
 assert.equal(matchesSaleProduct(p, 'xYZ-19'), true);
 assert.equal(matchesSaleProduct(p, '   xYz-19 '), true);
 assert.equal(matchesSaleProduct(p, 'banana'), false);
 assert.equal(matchesSaleProduct(p, 'óleo', 'Higiene'), false);
 assert.equal(matchesSaleProduct(p, '', 'Alimentação'), true);
});

test('Products with missing codes never crash search or become accidental Enter matches', () => {
 const noCode = { name: 'Arroz', category: 'Alimentação', active: true };
 const inactive = { name: 'Sabonete', code: '123', active: false };
 assert.equal(matchesSaleProduct(noCode, 'arroz'), true);
 assert.equal(matchesSaleProduct(noCode, 'ABC'), false);
 assert.equal(productByExactCode([noCode, inactive], '123'), null);
 assert.equal(productByExactCode([noCode], ''), null);
 assert.equal(productByExactCode([noCode], 'arroz'), null);
 assert.equal(productByExactCode([{ ...noCode, code: 'A123' }], ' a123 ' )?.name, 'Arroz');
});

test('Quick-payment and live-search handlers avoid full-app rebuilds', () => {
 const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
 const between = (begin, end) => {
  assert.ok(app.includes(begin), begin);
  assert.ok(app.includes(end), end);
  return app.split(begin)[1].split(end)[0];
 };
 const quick = between('function setCheckoutPayment(next){', 'function updatePaymentMessage(){');
 assert.doesNotMatch(quick, /\brender\s*\(/);
 assert.match(quick, /details\.innerHTML=paymentDetails\(\)/);
 assert.match(quick, /button\.setAttribute\('aria-pressed'/);
 const search = between('function bindSearch(){', 'function setCheckoutPayment(next){');
 assert.match(search, /search\.oninput=\(\)=>\{selectedProductCode='';query=search\.value;updateProductResults\(\)/);
 assert.match(search, /productByExactCode/);
 assert.match(search, /focusSearch:true/);
 assert.match(app, /previousCartScroll/);
 assert.match(app, /#payment-details/);
});

test('Cashier layout container never receives the cashier navigation click handler', () => {
 const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
 assert.match(app, /document\.querySelectorAll\('button\[data-cashier-view\]'\)/);
 assert.doesNotMatch(app, /document\.querySelectorAll\('\[data-cashier-view\]'\)/);
});

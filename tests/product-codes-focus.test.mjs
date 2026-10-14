import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed, addProduct } from '../src/model.js';
import { nextProductCode, allocateProductCode } from '../src/product-code.js';
import { productByExactCode, matchesSaleProduct } from '../src/product-search.js';

const newProduct = (name, code = '') => ({
 name, category: 'Mercearia', code, unit: 'un', price: 1500, stock: 2, min: 0
});

test('Cada novo produto recebe automaticamente um código exclusivo na sua loja', () => {
 let state = seed();
 const first = nextProductCode(state, 't1').code;
 assert.equal(first, 'PR-000001');
 state = addProduct(state, 't1', newProduct('Arroz'));
 const product = state.products.at(-1);
 assert.equal(product.code, first);
 assert.equal(productByExactCode(state.products, product.code)?.id, product.id);
 assert.equal(matchesSaleProduct(product, product.code), true);
 state = addProduct(state, 't1', newProduct('Arroz'));
 assert.equal(state.products.at(-1).code, 'PR-000002');
 assert.notEqual(state.products.at(-1).id, product.id);
 assert.equal(state.productCodeSequences.t1, 2);
});
test('Uma fotografia não muda a unicidade e outros estabelecimentos têm sequências próprias', () => {
 let state = seed();
 state = addProduct(state, 't1', {...newProduct('Produto fotografado'),photo:''});
 state = addProduct(state, 't1', {...newProduct('Outro produto com foto'),photo:''});
 state = addProduct(state, 't2', newProduct('Produto de outra filial'));
 assert.equal(state.products.at(-1).code, 'PR-000001');
 assert.equal(state.productCodeSequences.t1, 2);
 assert.equal(state.productCodeSequences.t2, 1);
});
test('Preserva códigos externos e evita colisões, inclusive variações de maiúsculas', () => {
 let state = seed();
 state = addProduct(state, 't1', newProduct('Importado', 'FBR-1234'));
 assert.equal(state.products.at(-1).code, 'FBR-1234');
 assert.throws(()=>addProduct(state,'t1',newProduct('Duplicado','fbr-1234')),/code/);
 assert.throws(()=>addProduct(state,'t1',newProduct('Duplicado','10001')),/code/);
 state = addProduct(state, 't1', newProduct('Reservado', 'PR-000025'));
 assert.equal(nextProductCode(state, 't1').code, 'PR-000026');
 state = addProduct(state, 't1', newProduct('Automático'));
 assert.equal(state.products.at(-1).code, 'PR-000026');
});
test('Sequências históricas impedem reutilizar códigos apagados ou alterados', () => {
 let state = addProduct(seed(),'t1',newProduct('Original'));
 state = {...state,products:state.products.filter(p=>p.code!=='PR-000001')};
 assert.equal(nextProductCode(state,'t1').code,'PR-000002');
 assert.equal(allocateProductCode(state,'t1','MAN-003').code,'MAN-003');
});
test('A interface usa códigos e protege o foco da pesquisa, pagamentos e eventos externos', () => {
 const code = readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(code,/chooseSaleProduct\(b\.dataset\.product\)/);
 assert.match(code,/selectedProductCode=product\.code\|\|''/);
 assert.match(code,/query\|\|selectedProductCode/);
 assert.match(code,/nextProductCode\(state,tenantId\)\.code/);
 assert.match(code,/refreshConnectionWithoutFocusLoss/);
 assert.match(code,/window\.addEventListener\('offline',refreshConnectionWithoutFocusLoss\)/);
 assert.match(code,/channel\.onmessage=async\(\)=>\{state=await read\(\);refreshConnectionWithoutFocusLoss\(\);\}/);
 const payment=code.split('function setCheckoutPayment(next){')[1].split('function updatePaymentMessage(){')[0];
 assert.ok(payment.includes('details.innerHTML=paymentDetails()'));
 assert.doesNotMatch(payment,/\brender\(/);
 const refresh=code.split('function refreshConnectionWithoutFocusLoss(){')[1].split("window.addEventListener('online'")[0];
 assert.ok(refresh.includes("if(page!=='sell')return render()"));
 assert.ok(refresh.includes('updateProductResults()'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {cartIssues,filterSaleHistory} from '../src/quality.js';
import {seed} from '../src/model.js';

test('Cart handles missing, disabled, overstocked and fractional products',()=>{
 const products=seed().products;
 assert.deepEqual(cartIssues([{productId:'missing',quantity:1}],products),[{productId:'missing',reason:'unavailable'}]);
 assert.deepEqual(cartIssues([{productId:'p1',quantity:49}],products),[{productId:'p1',reason:'quantity'}]);
 assert.deepEqual(cartIssues([{productId:'p3',quantity:1.2}],products),[{productId:'p3',reason:'quantity'}]);
 assert.deepEqual(cartIssues([{productId:'p1',quantity:1}],products),[]);
 assert.deepEqual(cartIssues([{productId:'p1',quantity:1}],products.map(p=>p.id==='p1'?{...p,active:false}:p)),[{productId:'p1',reason:'unavailable'}]);
});
test('Cart detects duplicates and unsupported precision',()=>{
 const products=seed().products;
 assert.equal(cartIssues([{productId:'p1',quantity:1},{productId:'p1',quantity:1}],products)[0].reason,'duplicate');
 assert.equal(cartIssues([{productId:'p1',quantity:1.0005}],products)[0].reason,'quantity');
});
test('History supports text, date, payment and refund filters',()=>{
 const sales=[
  {id:'a-2026',method:'cash',createdAt:'2026-10-12T10:00:00Z',lines:[{name:'Arroz',productId:'p1'}]},
  {id:'b-2026',method:'mixed',payments:[{method:'cash',amount:10},{method:'mpesa',amount:20}],createdAt:'2026-10-13T12:00:00Z',refundId:'refund-1',lines:[{name:'Sabonete',productId:'p3'}]},
  {id:'c-2026',method:'mpesa',createdAt:'2026-10-14T15:00:00Z',lines:[{name:'Cimento',productId:'p7'}]}
 ];
 assert.deepEqual(filterSaleHistory(sales,{search:'ARROZ'}).map(s=>s.id),['a-2026']);
 assert.deepEqual(filterSaleHistory(sales,{search:'p7'}).map(s=>s.id),['c-2026']);
 assert.deepEqual(filterSaleHistory(sales,{method:'mixed',status:'refunded'}).map(s=>s.id),['b-2026']);
 assert.deepEqual(filterSaleHistory(sales,{from:'2026-10-13',to:'2026-10-13'}).map(s=>s.id),['b-2026']);
 assert.deepEqual(filterSaleHistory(sales,{status:'completed'}).map(s=>s.id),['a-2026','c-2026']);
});
test('Filtering does not mutate the original order',()=>{
 const sales=[{id:'2',method:'cash'},{id:'1',method:'cash'}];
 assert.deepEqual(filterSaleHistory(sales,{}).map(x=>x.id),['2','1']);
 assert.deepEqual(sales.map(x=>x.id),['2','1']);
});

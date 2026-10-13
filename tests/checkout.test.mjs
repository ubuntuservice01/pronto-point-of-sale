import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale} from '../src/model.js';
import {openCash,activeCash,attachCashSale,cashSummary,refundSale} from '../src/cash.js';
import {createStore} from '../server/store.mjs';
const ctx={tenantId:'t1',userId:'owner',role:'owner',deviceId:'phone'};
test('Discount and mixed payment are reconciled with correct change',()=>{
 let s=seed();s=createSale(s,{...ctx,cart:[{productId:'p1',quantity:2}],discount:1000,payments:[{method:'cash',amount:6000},{method:'mpesa',amount:10000}],received:10000,id:'mix-1'});
 const sale=s.sales[0];assert.equal(sale.subtotal,17000);assert.equal(sale.total,16000);assert.equal(sale.change,4000);assert.equal(sale.method,'mixed');
 assert.deepEqual(sale.payments.map(x=>x.amount),[6000,10000]);
});
test('Invalid discounts and forged payment allocations are rejected',()=>{
 const base={...ctx,cart:[{productId:'p1',quantity:1}],id:'invalid',received:10000};
 assert.throws(()=>createSale(seed(),{...base,method:'cash',discount:8500}),/discount/);
 assert.throws(()=>createSale(seed(),{...base,payments:[{method:'cash',amount:2000}]}),/payment_total/);
 assert.throws(()=>createSale(seed(),{...base,payments:[{method:'cash',amount:4000},{method:'cash',amount:4500}]}),/payment/);
});
test('Full refund restores stock once and reduces only the processing shift',()=>{
 let s=openCash(seed(),ctx,10000);
 s=createSale(s,{...ctx,id:'r1',cart:[{productId:'p1',quantity:1}],method:'cash',received:10000});
 s=attachCashSale(s,ctx,'r1');
 const before=s.products[0].stock;
 s=refundSale(s,ctx,{id:'refund-1',saleId:'r1',reason:'Produto devolvido'});
 assert.equal(s.products[0].stock,before+1);assert.equal(cashSummary(s,activeCash(s,ctx)).total,0);
 assert.equal(refundSale(s,ctx,{id:'refund-1',saleId:'r1',reason:'Produto devolvido'}),s);
 assert.throws(()=>refundSale(s,ctx,{id:'refund-2',saleId:'r1',reason:'Outra'}),/already_refunded/);
});
test('Refund requires manager or owner and an available cash balance',()=>{
 let s=openCash(seed(),ctx,0);
 s=createSale(s,{...ctx,id:'r2',cart:[{productId:'p1',quantity:1}],method:'cash',received:8500});
 s=attachCashSale(s,ctx,'r2');
 assert.throws(()=>refundSale(s,{...ctx,role:'cashier'},{id:'other',saleId:'r2',reason:'return'}),/permission/);
 assert.throws(()=>refundSale(s,{...ctx,deviceId:'other'},{id:'other2',saleId:'r2',reason:'return'}),/cash_not_open/);
});
test('Authenticated cashier cannot sell without an open cash shift',()=>{
 const store=createStore(':memory:',{bootstrapUser:'admin',bootstrapPassword:'VeryLongPassword123!',secure:false});
 try{
 const admin=store.session(store.login('admin','VeryLongPassword123!','admin-device').token);
 const b=store.createBusiness(admin,{name:'Shop',type:'Grocery',owner:'Owner'});
 const login=store.login(b.onboarding.username,b.onboarding.temporaryPassword,'pos-device');
 const u=store.session(login.token);store.changePassword(u,b.onboarding.temporaryPassword,'OtherPassword123!ZZ',login.token);
 const owner=store.session(login.token),product=store.product(owner,{tenantId:owner.business_id,name:'Item',category:'General',unit:'un',code:'1',price:1000,stock:5,min:0}).products[0];
 const sale={id:'s1',tenantId:owner.business_id,cart:[{productId:product.id,quantity:1}],method:'cash',received:1000,deviceId:'pos-device'};
 assert.throws(()=>store.sale(owner,sale),/cash_not_open/);
 store.cashOpen(owner,{opening:1000});
 assert.equal(store.sale(owner,sale).sales[0].cashSessionId!==undefined,true);
 }finally{store.close();}
});

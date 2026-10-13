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

test('Server cash register supports a complete discounted sale and refund reconciliation',()=>{
 const store=createStore(':memory:',{bootstrapUser:'ubuntu.root',bootstrapPassword:'VeryLongPassword123!',secure:false});
 try {
 const admin=store.session(store.login('ubuntu.root','VeryLongPassword123!','root').token);
 const welcome=store.createBusiness(admin,{name:'Store',type:'Retail',owner:'Ana'});
 const login=store.login(welcome.onboarding.username,welcome.onboarding.temporaryPassword,'phone');
 store.changePassword(store.session(login.token),welcome.onboarding.temporaryPassword,'ChangedPassword2026!',login.token);
 const owner=store.session(login.token),tenantId=owner.business_id;
 const product=store.product(owner,{tenantId,name:'Oil',category:'Food',unit:'un',code:'A',price:2000,stock:5,min:1}).products[0];
 store.cashOpen(owner,{opening:5000});
 const after=store.sale(owner,{id:'sale-1',tenantId,deviceId:'forged-device',cart:[{productId:product.id,quantity:1}],discount:200,payments:[{method:'cash',amount:1000},{method:'emola',amount:800}],received:1500});
 const sale=after.sales[0];assert.equal(sale.total,1800);assert.equal(sale.change,500);
 assert.equal(sale.cashSessionId,after.cashSessions[0].id);
 assert.equal(sale.deviceId,'phone');
 assert.throws(()=>store.refund(owner,{id:'refund-1',saleId:'sale-1',reason:'Defect'}),/refund_not_confirmed/);
 const returned=store.refund(owner,{id:'refund-1',saleId:'sale-1',reason:'Defect',manualConfirmed:true});
 assert.equal(returned.products[0].stock,5);assert.equal(returned.sales[0].refundId,'refund-1');
 assert.throws(()=>store.refund(owner,{id:'refund-2',saleId:'sale-1',reason:'Duplicate',manualConfirmed:true}),/already_refunded/);
 const closed=store.cashClose(owner,{counted:{cash:5000,mpesa:0,emola:0,transfer:0},note:''});
 assert.equal(closed.cashSessions[0].status,'closed');
 assert.throws(()=>store.sale(owner,{id:'sale-2',tenantId,cart:[{productId:product.id,quantity:1}],method:'cash',received:2000}),/cash_not_open/);
 }finally{store.close();}
});
test('Cash closing validates its reconciliation object at API boundary',()=>{
 const store=createStore(':memory:',{bootstrapUser:'ubuntu.root',bootstrapPassword:'VeryLongPassword123!',secure:false});
 try{
  const admin=store.session(store.login('ubuntu.root','VeryLongPassword123!','root').token);
  const welcome=store.createBusiness(admin,{name:'Store',type:'Retail',owner:'Ana'});
  const login=store.login(welcome.onboarding.username,welcome.onboarding.temporaryPassword,'phone');
  store.changePassword(store.session(login.token),welcome.onboarding.temporaryPassword,'ChangedPassword2026!',login.token);
  const owner=store.session(login.token);
  store.cashOpen(owner,{opening:0});
  assert.throws(()=>store.cashClose(owner,{}),/cash_amount/);
 }finally{store.close();}
});

test('Cashier cannot apply an unauthorised discount',()=>{
 const s=seed();
 assert.equal(createSale(s,{tenantId:'t1',role:'cashier',cart:[{productId:'p1',quantity:1}],method:'cash',received:8500,deviceId:'phone',userId:'u2',id:'cashier-ok'}).sales[0].total,8500);
 assert.throws(()=>createSale(s,{tenantId:'t1',role:'cashier',cart:[{productId:'p1',quantity:1}],method:'cash',received:8500,discount:500,deviceId:'phone',userId:'u2',id:'cashier-discount'}),/permission/);
});

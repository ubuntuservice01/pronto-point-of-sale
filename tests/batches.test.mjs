import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale} from '../src/model.js';
import {receiveBatch,productBatches,allocateFEFO,sellableQty,adjustProductBatch,legacyQty} from '../src/batches.js';
import {recordPurchase} from '../src/commercial.js';
import {recordInventoryMovement} from '../src/inventory.js';
import {openCash,attachCashSale,refundSale} from '../src/cash.js';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
import {productBatchSummary,batchRowsHTML} from '../src/batch-ui.js';

function blank(){
 const s=seed();
 return {...s,products:s.products.map(p=>p.id==='p1'?{...p,stock:0,expiryDate:''}:p)};
}
function incoming(id,number,expiryDate,quantity){
 return {id,productId:'p1',batchNumber:number,expiryDate,quantity,reason:'Entrega do fornecedor'};
}
test('Same article accepts distinct lots with different expiry dates and FEFO allocates soonest first',()=>{
 let s=blank();
 s=receiveBatch(s,'t1',incoming('op-first','LOT-FEFO-LATE','2099-11-01',4),'owner');
 s=receiveBatch(s,'t1',incoming('op-second','LOT-FEFO-EARLY','2099-05-01',3),'owner');
 assert.equal(s.products[0].stock,7);
 assert.equal(productBatches(s,s.products[0]).length,2);
 const prepared=allocateFEFO(s,s.products[0],5);
 assert.deepEqual(prepared.map(b=>[b.batchNumber,b.quantity]),[['LOT-FEFO-EARLY',3],['LOT-FEFO-LATE',2]]);
 const after=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:5}],method:'cash',received:42500,id:'batch-sale',userId:'owner',deviceId:'phone'});
 assert.equal(after.sales[0].lines[0].batchAllocations.length,2);
 assert.equal(after.products[0].stock,2);
 assert.equal(after.stockBatches.find(b=>b.number==='LOT-FEFO-EARLY').quantity,0);
 assert.equal(after.stockBatches.find(b=>b.number==='LOT-FEFO-LATE').quantity,2);
});
test('Expired stock is never selected even when total stock is positive, including legacy expiry',()=>{
 let s=blank();
 s=receiveBatch(s,'t1',incoming('expired','OLD','2020-01-01',9),'owner');
 assert.equal(sellableQty(s,s.products[0]),0);
 assert.throws(()=>createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:1}],method:'cash',received:8500,id:'bad-sale'}),/stock_expired_or_insufficient/);
 s=receiveBatch(s,'t1',incoming('valid','NEW','2099-01-01',2),'owner');
 assert.equal(sellableQty(s,s.products[0]),2);
 const after=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:2}],method:'cash',received:17000,id:'valid-only'});
 assert.equal(after.stockBatches.find(b=>b.number==='OLD').quantity,9);
 assert.equal(after.stockBatches.find(b=>b.number==='NEW').quantity,0);
 const legacy=seed();legacy.products[0].expiryDate='2020-01-01';
 assert.equal(sellableQty(legacy,legacy.products[0]),0);
});
test('Existing stock stays untracked without inventing a lot or date; dated lots sell before it',()=>{
 let s=seed(); const p=s.products[0];
 assert.equal(legacyQty(s,p),48);
 assert.deepEqual(productBatches(s,p).map(b=>[b.id,b.number,b.expiryDate,b.quantity]),[[null,'','',48]]);
 s=receiveBatch(s,'t1',incoming('add-dated','DATED-1','2099-04-09',3),'owner');
 assert.equal(legacyQty(s,s.products[0]),48);
 const after=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:5}],method:'cash',received:42500,id:'use-legacy'});
 assert.deepEqual(after.sales[0].lines[0].batchAllocations.map(b=>[b.batchNumber,b.quantity]),[['DATED-1',3],['',2]]);
 assert.equal(legacyQty(after,after.products[0]),46);
 assert.equal(after.products[0].stock,46);
});
test('Repeated receipts do not duplicate stock and same lot number cannot acquire a conflicting expiry',()=>{
 let s=blank(); const op=incoming('receipt-id','FOOD-10','2099-01-01',2);
 s=receiveBatch(s,'t1',op,'owner');
 assert.strictEqual(receiveBatch(s,'t1',op,'owner'),s);
 assert.throws(()=>receiveBatch(s,'t1',{...op,quantity:3},'owner'),/operation_conflict/);
 s=receiveBatch(s,'t1',{...incoming('receipt-2','FOOD-10','2099-01-01',1)},'owner');
 assert.equal(s.stockBatches.length,1);
 assert.equal(s.stockBatches[0].quantity,3);
 assert.throws(()=>receiveBatch(s,'t1',incoming('receipt-3','food-10','2099-02-01',2),'owner'),/batch_expiry_conflict/);
 assert.throws(()=>receiveBatch(s,'t1',incoming('receipt-4','OTHER','2025-02-30',2),'owner'),/expiry_date/);
});
test('Batch adjustments protect concurrent counts and legacy non-batch adjustments cannot corrupt tracked stock',()=>{
 let s=blank();s=receiveBatch(s,'t1',incoming('batch-stock','BATCH-A','2099-07-01',5),'owner');
 const b=s.stockBatches[0];
 const request={id:'count-a',productId:'p1',batchId:b.id,quantity:3,expectedQuantity:5,reason:'Contagem física'};
 s=adjustProductBatch(s,'t1',request,'owner');
 assert.equal(s.products[0].stock,3);
 assert.equal(s.stockBatches[0].quantity,3);
 assert.strictEqual(adjustProductBatch(s,'t1',request,'owner'),s);
 assert.throws(()=>adjustProductBatch(s,'t1',{...request,id:'stale',quantity:1},'owner'),/stock_conflict/);
 assert.throws(()=>recordInventoryMovement(s,'t1',{id:'generic-adjust',productId:'p1',kind:'adjust',quantity:1,expectedStock:3,reason:'sem lote'},'owner'),/batch_adjust_required/);
});
test('Full refund restores quantities to the original lots instead of generating untracked stock',()=>{
 const ctx={tenantId:'t1',userId:'owner',deviceId:'phone',role:'owner'};
 let s=openCash(blank(),ctx,50000);
 s=receiveBatch(s,'t1',incoming('return-a','BATCH-1','2099-01-01',3),'owner');
 s=receiveBatch(s,'t1',incoming('return-b','BATCH-2','2099-04-01',2),'owner');
 s=createSale(s,{...ctx,id:'sold-to-return',cart:[{productId:'p1',quantity:4}],method:'cash',received:34000});
 s=attachCashSale(s,ctx,'sold-to-return');
 s=refundSale(s,ctx,{id:'full-return',saleId:'sold-to-return',reason:'Produto devolvido'});
 assert.equal(s.products[0].stock,5);
 assert.equal(s.stockBatches.find(b=>b.number==='BATCH-1').quantity,3);
 assert.equal(s.stockBatches.find(b=>b.number==='BATCH-2').quantity,2);
 assert.equal(legacyQty(s,s.products[0]),0);
});
test('Purchase with batch number updates lot quantity and stock once',()=>{
 let s=blank();
 const purchase={id:'purchase-with-lot',productId:'p1',supplier:'Armazém',reference:'F-1',unitCost:6000,quantity:2,batchNumber:'PROD-LOTE-01',expiryDate:'2099-06-01'};
 s=recordPurchase(s,'t1',purchase,'owner');
 assert.equal(s.products[0].stock,2);
 assert.equal(s.stockBatches.length,1);
 assert.equal(s.stockBatches[0].expiryDate,'2099-06-01');
 assert.strictEqual(recordPurchase(s,'t1',purchase,'owner'),s);
 assert.throws(()=>recordPurchase(s,'t1',{...purchase,expiryDate:'2099-08-01'},'owner'),/purchase_conflict/);
});
test('Snapshots isolate lots by business; server records lot operations with permissions',()=>{
 const store=createStore(':memory:',{bootstrapUser:'lot-root',bootstrapPassword:'A-Strong-Password-2026!',secure:false});
 try{
  const root=store.session(store.login('lot-root','A-Strong-Password-2026!','desktop').token);
  function setup(name){
   const account=store.createBusiness(root,{name,type:'Retail',owner:name+' Owner'});
   const login=store.login(account.onboarding.username,account.onboarding.temporaryPassword,'device');
   store.changePassword(store.session(login.token),account.onboarding.temporaryPassword,'Strong-New-Password-2026!',login.token);
   return store.session(login.token);
  }
  const a=setup('A'),b=setup('B');
  const p=store.product(a,{tenantId:a.business_id,name:'Leite',category:'Food',unit:'un',price:2500,stock:0,min:2,code:'LEITE'}).products[0];
  const result=store.batchReceive(a,{tenantId:a.business_id,...{...incoming('api-lot-1','LEITE-01','2099-02-01',10),productId:p.id}});
  assert.equal(result.stockBatches[0].quantity,10);
  assert.equal(store.snapshot(b).stockBatches.length,0);
  assert.throws(()=>store.batchReceive(b,{tenantId:b.business_id,...{...incoming('cross','wrong','2099-03-01',2),productId:p.id}}),e=>e.status===400);
  const cashierSetup=store.createMember(a,{name:'Caixa',role:'cashier'}).onboarding;
  const login=store.login(cashierSetup.username,cashierSetup.temporaryPassword,'cash');
  store.changePassword(store.session(login.token),cashierSetup.temporaryPassword,'AnotherStrongPassword2026!',login.token);
  const cashier=store.session(login.token);
  assert.throws(()=>store.batchReceive(cashier,{tenantId:a.business_id,...{...incoming('forbidden','L','2099-03-01',1),productId:p.id}}),e=>e.status===403);
  assert.equal(store.snapshot(cashier).stockBatches.length,1);
 }finally{store.close();}
});
test('Batch frontend escapes supplied identifiers and indicates expired amounts',()=>{
 let s=blank();s=receiveBatch(s,'t1',incoming('frontend-lot','<script>alert(1)</script>','2020-01-01',2),'owner');
 const html=batchRowsHTML(s,s.products[0],'pt');
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/Venda bloqueada/);
 assert.match(productBatchSummary(s,s.products[0],'pt'),/Vencido/);
});

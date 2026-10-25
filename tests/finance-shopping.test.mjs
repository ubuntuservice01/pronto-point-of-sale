import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale} from '../src/model.js';
import {recordPurchase,recordExpense,commercialReport} from '../src/commercial.js';
import {openCash,attachCashSale,refundSale} from '../src/cash.js';
import {createShoppingList,updateShoppingList,shoppingListMessage} from '../src/shopping.js';
import {createStore} from '../server/store.mjs';
const owner={id:'owner',role:'owner',tenantId:'t1'};
const ready=()=>({...seed(),products:seed().products.map(p=>p.id==='p1'?{...p,stock:0}:p)});
test('Lucro operacional só surge com custo de aquisição comprovado, sem subtrair compras duas vezes',()=>{
 let s=ready();
 s=recordPurchase(s,'t1',{id:'purchase-one',productId:'p1',quantity:5,batchNumber:'LOTE-CUSTO',expiryDate:'2099-06-01',unitCost:5000,supplier:'Armazém',reference:'INV-1'},'owner');
 s=recordExpense(s,'t1',{id:'expense-one',category:'Electricidade',note:'Facturação',amount:2000},'owner');
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:2}],id:'sale-one',method:'cash',received:17000});
 const report=commercialReport(s,'t1');
 assert.equal(s.sales[0].lines[0].costAmount,10000);
 assert.equal(s.sales[0].lines[0].batchAllocations[0].unitCost,5000);
 assert.equal(report.net,17000);
 assert.equal(report.purchasesTotal,25000);
 assert.equal(report.cogs,10000);
 assert.equal(report.knownGrossProfit,7000);
 assert.equal(report.netOperatingResult,5000);
 assert.equal(report.completeCostData,true);
 assert.equal(report.moneyByMethod.cash,17000);
});
test('Stock antigo sem custo não gera falsa estimativa de lucro líquido',()=>{
 const s=createSale(seed(),{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:1}],id:'unknown-cost',method:'cash',received:8500});
 const report=commercialReport(s,'t1');
 assert.equal(report.completeCostData,false);
 assert.equal(report.netOperatingResult,null);
 assert.equal(report.unknownSales,1);
 assert.equal(s.sales[0].lines[0].costAmount,null);
});
test('Lotes com custos distintos atribuem custo FEFO correcto e não mudam vendas antigas',()=>{
 let s=ready();
 s=recordPurchase(s,'t1',{id:'p1',productId:'p1',quantity:2,batchNumber:'A',expiryDate:'2099-01-01',unitCost:5000,supplier:'A'},'owner');
 s=recordPurchase(s,'t1',{id:'p2',productId:'p1',quantity:3,batchNumber:'B',expiryDate:'2099-02-01',unitCost:7000,supplier:'B'},'owner');
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:4}],id:'mixed',method:'cash',received:34000});
 assert.equal(s.sales[0].lines[0].costAmount,24000);
 assert.equal(commercialReport(s,'t1').cogs,24000);
 s=recordPurchase(s,'t1',{id:'p3',productId:'p1',quantity:3,batchNumber:'B',expiryDate:'2099-02-01',unitCost:9000,supplier:'B'},'owner');
 assert.equal(s.sales[0].lines[0].costAmount,24000);
});
test('Pagamentos por M-Pesa, e-Mola, dinheiro e transferência não duplicam vendas a crédito',()=>{
 let s=ready();s=recordPurchase(s,'t1',{id:'goods',productId:'p1',quantity:5,batchNumber:'PAY',expiryDate:'2099-05-01',unitCost:4000,supplier:'A'},'owner');
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:2}],id:'split',method:'cash',payments:[{method:'cash',amount:5000},{method:'mpesa',amount:12000}],received:5000});
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:1}],id:'emola',method:'emola',received:0});
 s={...s,debtPayments:[{id:'debt-pay',tenantId:'t1',method:'transfer',amount:3000,createdAt:new Date().toISOString()}]};
 const report=commercialReport(s,'t1');
 assert.deepEqual(report.moneyByMethod,{cash:5000,mpesa:12000,emola:8500,transfer:3000,bank:0});
 assert.equal(report.net,25500);assert.equal(report.debtCollections,3000);
});
test('Lista automática guarda recomendações reais e não inventa um pedido ao fornecedor',()=>{
 let s=seed();
 s.products=s.products.map(p=>p.id==='p1'?{...p,stock:2,min:12}:p);
 const req={id:'shop-test-0001',reason:'Reposição semanal'};
 s=createShoppingList(s,'t1',req,owner);
 const list=s.shoppingLists[0];
 assert.equal(list.status,'draft');assert.equal(list.tenantId,'t1');
 assert.ok(list.items.some(i=>i.productId==='p1'&&i.quantity>=10));
 assert.strictEqual(createShoppingList(s,'t1',req,owner),s);
 assert.match(shoppingListMessage(list,'pt'),/Lista de compras/);
 assert.throws(()=>createShoppingList(s,'t2',{id:'separate',reason:'x'},owner),/tenant/);
});
test('Lista de compras pode ser revista e marcada encomendada, com revisão optimista e auditoria',()=>{
 let s=seed();s.products=s.products.map(p=>p.id==='p1'?{...p,stock:2,min:12}:p);
 s=createShoppingList(s,'t1',{id:'shopping-1000',reason:'Reposição'},owner);
 const original=s.shoppingLists[0],items=original.items.map(i=>({...i,quantity:i.quantity+1}));
 s=updateShoppingList(s,'t1',{id:original.id,expectedRevision:0,status:'ordered',reason:'Quantidades confirmadas',items},owner);
 assert.equal(s.shoppingLists[0].revision,1);assert.equal(s.shoppingLists[0].status,'ordered');
 assert.equal(s.shoppingEvents[0].actorId,'owner');
 assert.throws(()=>updateShoppingList(s,'t1',{id:original.id,expectedRevision:0,status:'closed',reason:'x',items},owner),/revision_conflict/);
 assert.throws(()=>updateShoppingList(s,'t1',{id:original.id,expectedRevision:1,status:'draft',reason:'x',items},owner),/shopping_status/);
 const after=updateShoppingList(s,'t1',{id:original.id,expectedRevision:1,status:'closed',reason:'Recepção confirmada externamente',items},owner);
 assert.equal(after.shoppingLists[0].status,'closed');
 assert.throws(()=>updateShoppingList(after,'t1',{id:original.id,expectedRevision:2,status:'ordered',reason:'x',items},owner),/shopping_closed/);
});
test('Servidor protege listas e separa comerciantes',()=>{
 const store=createStore(':memory:',{bootstrapUser:'root-shopping',bootstrapPassword:'VeryStrongBootstrap2026!',secure:false});
 try{
  const root=store.session(store.login('root-shopping','VeryStrongBootstrap2026!','desktop').token);
  function shop(name){
   const x=store.createBusiness(root,{name,type:'Retail',owner:name+' Owner'});
   const l=store.login(x.onboarding.username,x.onboarding.temporaryPassword,'phone');
   store.changePassword(store.session(l.token),x.onboarding.temporaryPassword,'OwnerStrongPassword2026!',l.token);
   return store.session(l.token);
  }
  const a=shop('A'),b=shop('B'),id=a.business_id;
  store.product(a,{tenantId:id,name:'Açúcar',category:'Food',unit:'un',price:1200,stock:1,min:10,code:'ACUC'});
  const saved=store.shoppingCreate(a,{tenantId:id,id:'server-list-1000',reason:'Compra'});
  assert.equal(saved.shoppingLists.length,1);
  assert.equal(store.snapshot(b).shoppingLists.length,0);
  assert.throws(()=>store.shoppingCreate(b,{tenantId:id,id:'foreign-list',reason:'X'}),e=>e.status===403);
  const cashierInfo=store.createMember(a,{name:'Caixa',role:'cashier'}).onboarding;
  const ticket=store.login(cashierInfo.username,cashierInfo.temporaryPassword,'cash');
  store.changePassword(store.session(ticket.token),cashierInfo.temporaryPassword,'CashierStrongPassword2026!',ticket.token);
  const cashier=store.session(ticket.token);
  assert.deepEqual(store.snapshot(cashier).shoppingLists,[]);
  assert.throws(()=>store.shoppingCreate(cashier,{tenantId:id,id:'cashier-list',reason:'X'}),e=>e.status===403);
 }finally{store.close();}
});

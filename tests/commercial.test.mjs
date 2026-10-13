import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale,can} from '../src/model.js';
import {saveCustomer,recordPurchase,recordExpense,commercialReport,csvCell,reportCsv} from '../src/commercial.js';
import {createStore} from '../server/store.mjs';

const base=()=>seed();
test('Customer edits are scoped to their business and may be linked to sales',()=>{
 let state=saveCustomer(base(),'t1',{id:'c1',name:'Alice',phone:'841234567',email:'alice@example.com',note:''});
 state=saveCustomer(state,'t1',{id:'c1',name:'Alice B',phone:'841234567',email:'alice@example.com',note:'Regular'});
 assert.equal(state.customers.length,1);
 assert.equal(state.customers[0].name,'Alice B');
 assert.throws(()=>saveCustomer(state,'t2',{id:'c1',name:'Impersonator'}),/customer_id/);
 assert.throws(()=>saveCustomer(state,'t1',{id:'other',name:'Someone',email:'bad'}),/customer_email/);
 const sale=createSale(state,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:1}],id:'s1',customerId:'c1',method:'cash',received:8500,deviceId:'phone',userId:'owner'});
 assert.equal(sale.sales[0].customerId,'c1');
 assert.throws(()=>createSale(state,{tenantId:'t2',role:'owner',cart:[{productId:'p6',quantity:1}],id:'s2',customerId:'c1',method:'cash',received:999999}),/customer/);
});
test('Purchases update stock and latest cost without altering previous sale snapshots',()=>{
 let s=base();
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:1}],id:'old',method:'cash',received:8500});
 assert.equal(s.sales[0].lines[0].cost,null);
 const purchase={id:'purch1',productId:'p1',quantity:2.5,unitCost:6500,supplier:'Supply',reference:'INV-1'};
 s=recordPurchase(s,'t1',purchase,'owner');
 assert.equal(s.products.find(p=>p.id==='p1').stock,49.5);
 assert.equal(s.products.find(p=>p.id==='p1').cost,6500);
 assert.equal(s.purchases[0].total,16250);
 assert.strictEqual(recordPurchase(s,'t1',purchase,'owner'),s);
 assert.throws(()=>recordPurchase(s,'t2',{...purchase,id:'cross'},'owner'),/product/);
 assert.throws(()=>recordPurchase(s,'t1',{...purchase,id:'new',quantity:-1},'owner'),/purchase_amount/);
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:1}],id:'new',method:'cash',received:8500});
 assert.equal(s.sales[0].lines[0].cost,6500);
 assert.equal(s.sales[1].lines[0].cost,null);
});
test('Expenses are distinct from cash movements and reject invalid or conflicting IDs',()=>{
 let s=recordExpense(base(),'t1',{id:'ex1',category:'Renda',note:'Outubro',amount:5000},'finance');
 assert.equal(s.expenses[0].amount,5000);
 assert.equal((s.cashSessions||[]).length,0);
 assert.strictEqual(recordExpense(s,'t1',{id:'ex1',category:'Renda',note:'Outubro',amount:5000},'finance'),s);
 assert.throws(()=>recordExpense(s,'t1',{id:'ex1',category:'Renda',note:'Outro',amount:5000},'finance'),/expense_conflict/);
 assert.throws(()=>recordExpense(s,'t1',{id:'invalid',category:'Renda',note:'Outubro',amount:12.5},'finance'),/expense/);
});
test('Reports reconcile sales, expenses, purchases and known cost coverage',()=>{
 let s=recordPurchase(base(),'t1',{id:'purchase',productId:'p1',quantity:4,unitCost:5000,supplier:'A',reference:''},'owner');
 s=recordExpense(s,'t1',{id:'expense',category:'Energia',note:'Monthly',amount:2000},'owner');
 s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity:2}],id:'s1',method:'cash',received:17000});
 const report=commercialReport(s,'t1');
 assert.equal(report.net,17000);assert.equal(report.purchasesTotal,20000);
 assert.equal(report.expensesTotal,2000);assert.equal(report.marginRevenue,17000);
 assert.equal(report.cogs,10000);assert.equal(report.estimatedGrossMargin,7000);
 assert.equal(report.costedSales,1);
 assert.equal(report.products[0].quantity,2);
 assert.throws(()=>commercialReport(s,'t1',{from:'2026-11-02',to:'2026-10-01'}),/date/);
});
test('CSV preserves numeric negative values, escapes formulas and adds UTF-8 BOM',()=>{
 assert.equal(csvCell('-120.50'),'"-120.50"');
 assert.equal(csvCell('=HYPERLINK(1)'),'"\'=HYPERLINK(1)"');
 assert.equal(csvCell('texto "exemplo"'),'"texto ""exemplo"""');
 const output=reportCsv(commercialReport(base(),'t1'));
 assert.ok(output.startsWith('\uFEFF'));assert.match(output,/Data \(UTC\)/);
});
test('Server grants role-specific access and maintains separation between businesses',()=>{
 const store=createStore(':memory:',{bootstrapUser:'administrator',bootstrapPassword:'LongBootstrap2026!',secure:false});
 try{
  const root=store.session(store.login('administrator','LongBootstrap2026!','desktop').token);
  function business(name){
   const created=store.createBusiness(root,{name,type:'General',owner:name+' Owner'});
   const login=store.login(created.onboarding.username,created.onboarding.temporaryPassword,'phone');
   store.changePassword(store.session(login.token),created.onboarding.temporaryPassword,'ChangedPassword2026!',login.token);
   return store.session(login.token);
  }
  const ownerA=business('A'),ownerB=business('B');
  const tenantId=ownerA.business_id;
  const customer=store.customerSave(ownerA,{id:'client',name:'Customer A',phone:'',email:'',note:''});
  assert.equal(customer.customers.length,1);
  assert.equal(store.snapshot(ownerB).customers.length,0);
  const created=store.product(ownerA,{tenantId,name:'Rice',category:'Food',unit:'un',price:3000,stock:2,min:0,code:'010'}).products[0];
  const purchased=store.purchaseCreate(ownerA,{id:'buy',productId:created.id,supplier:'Depot',reference:'x',quantity:3,unitCost:1200});
  assert.equal(purchased.products[0].stock,5);
  const expense=store.expenseCreate(ownerA,{id:'rent',category:'Rent',note:'Office',amount:4500});
  assert.equal(expense.expenses.length,1);
  assert.equal(store.snapshot(ownerB).expenses.length,0);
  const member=store.createMember(ownerA,{name:'Cashier',role:'cashier'}).onboarding;
  const login=store.login(member.username,member.temporaryPassword,'tablet');
  store.changePassword(store.session(login.token),member.temporaryPassword,'ChangedPassword2026!',login.token);
  const cashier=store.session(login.token);
  assert.equal(store.snapshot(cashier).customers.length,1);
  assert.equal(store.snapshot(cashier).purchases.length,0);
  assert.equal(store.snapshot(cashier).expenses.length,0);
  assert.equal(store.snapshot(cashier).cashSessions.length,0);
  assert.equal('cost' in store.snapshot(cashier).products[0],false);
  assert.throws(()=>store.purchaseCreate(cashier,{id:'bad',productId:created.id,supplier:'X',quantity:1,unitCost:200}),/forbidden/);
  assert.throws(()=>store.expenseCreate(cashier,{id:'bad',category:'Rent',note:'X',amount:100}),/forbidden/);
  assert.equal(can('finance','reports'),true);
 }finally{store.close();}
});

test('Stock accounts cannot read financial shifts or refunds in a snapshot',()=>{
 const store=createStore(':memory:',{bootstrapUser:'rootadmin',bootstrapPassword:'LongBootstrap2026!',secure:false});
 try{
  const root=store.session(store.login('rootadmin','LongBootstrap2026!','desktop').token);
  const opened=store.createBusiness(root,{name:'Shop',type:'Retail',owner:'Own'});
  const l=store.login(opened.onboarding.username,opened.onboarding.temporaryPassword,'owner-phone');
  store.changePassword(store.session(l.token),opened.onboarding.temporaryPassword,'ChangedPassword2026!',l.token);
  const owner=store.session(l.token);
  store.cashOpen(owner,{opening:1000});
  const member=store.createMember(owner,{name:'Stock',role:'stock'}).onboarding;
  const sl=store.login(member.username,member.temporaryPassword,'stock-phone');
  store.changePassword(store.session(sl.token),member.temporaryPassword,'ChangedPassword2026!',sl.token);
  const stock=store.snapshot(store.session(sl.token));
  assert.equal(stock.cashSessions.length,0);
  assert.equal(stock.refunds.length,0);
  assert.equal(stock.expenses.length,0);
  assert.equal(can('stock','purchases'),true);
 }finally{store.close();}
});

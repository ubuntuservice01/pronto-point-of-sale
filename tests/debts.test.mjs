import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale} from '../src/model.js';
import {saveCustomer} from '../src/commercial.js';
import {saveCreditPolicy,registerDebtPayment,customerOutstanding,debtBalance,debtStatus,debtOverview,whatsAppDebtUrl} from '../src/debts.js';
import {openCash,cashSummary,attachCashSale,refundSale,closeCash} from '../src/cash.js';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
import {debtsPage} from '../src/debts-ui.js';
const due='2099-11-30';
const ctx={tenantId:'t1',userId:'caixa',deviceId:'phone',role:'cashier'};
function base(){
 let s=saveCustomer(seed(),'t1',{id:'maria',name:'Maria',phone:'841234567',email:'',note:''});
 return saveCreditPolicy(s,'t1',{customerId:'maria',creditLimit:200000,creditBlocked:false,expectedRevision:0,reason:'Cliente autorizado',actorRole:'owner'},'owner');
}
function credit(s,id='venda1',quantity=2,customerId='maria',date=due){return createSale(s,{tenantId:'t1',role:'cashier',cart:[{productId:'p1',quantity}],method:'credit',id,customerId,debtDueDate:date,userId:'caixa',deviceId:'phone',received:0});}
test('Venda a crédito cria dívida, preserva stock e não recebe dinheiro no caixa',()=>{
 let s=openCash(base(),ctx,2500);
 s=attachCashSale(credit(s),ctx,'venda1');
 assert.equal(s.debts.length,1);assert.equal(s.debts[0].amount,17000);
 assert.equal(s.sales[0].received,0);assert.equal(s.sales[0].debtDueDate,due);
 assert.equal(customerOutstanding(s,'t1','maria'),17000);
 assert.equal(cashSummary(s,s.cashSessions[0]).expected.cash,2500);
 assert.equal(s.products[0].stock,46);
});
test('Cliente obrigatório, limite, bloqueio, vencimento e concorrência são protegidos',()=>{
 let s=base();
 assert.throws(()=>credit(s,'a',2,null),/debt_customer_required/);
 assert.throws(()=>credit(s,'a',2,'maria','2020-01-01'),/debt_due_date/);
 assert.throws(()=>credit(s,'a',30),/debt_limit/);
 s=credit(s);
 assert.throws(()=>credit(s,'b',23),/debt_limit/);
 assert.throws(()=>saveCreditPolicy(s,'t1',{customerId:'maria',creditLimit:200000,creditBlocked:true,expectedRevision:1,reason:'Sem aprovação',actorRole:'cashier'},'caixa'),/permission/);
 s=saveCreditPolicy(s,'t1',{customerId:'maria',creditLimit:200000,creditBlocked:true,expectedRevision:1,reason:'Bloqueado',actorRole:'manager'},'gestor');
 assert.throws(()=>credit(s,'c'),/debt_blocked/);
 assert.throws(()=>saveCreditPolicy(s,'t1',{customerId:'maria',creditLimit:200000,creditBlocked:false,expectedRevision:1,reason:'Desbloquear',actorRole:'owner'},'dono'),/revision_conflict/);
});
test('Pagamento parcial, repetição idempotente e reconciliação no caixa',()=>{
 let s=attachCashSale(credit(openCash(base(),ctx,10000)),ctx,'venda1');
 const one={id:'p1',debtId:'venda1',amount:3000,method:'cash',reference:'REC-1',manualConfirmed:true};
 s=registerDebtPayment(s,'t1',one,ctx);
 assert.strictEqual(registerDebtPayment(s,'t1',one,ctx),s);
 assert.equal(customerOutstanding(s,'t1','maria'),14000);
 assert.equal(cashSummary(s,s.cashSessions[0]).expected.cash,13000);
 s=registerDebtPayment(s,'t1',{id:'p2',debtId:'venda1',amount:5000,method:'mpesa',reference:'M1',manualConfirmed:true},ctx);
 assert.equal(cashSummary(s,s.cashSessions[0]).expected.mpesa,5000);
 assert.equal(debtBalance(s,s.debts[0]),9000);
 assert.throws(()=>registerDebtPayment(s,'t1',{...one,id:'p3',amount:10000},ctx),/debt_amount/);
 assert.throws(()=>registerDebtPayment(s,'t1',{...one,amount:6000},ctx),/payment_conflict/);
 assert.equal(closeCash(s,ctx,{cash:13000,mpesa:5000,emola:0,transfer:0}).cashSessions[0].status,'closed');
});
test('Pagamentos exigem sessão de caixa aberta e confirmação manual',()=>{
 const s=credit(base()),p={id:'p1',debtId:'venda1',amount:100,method:'emola',manualConfirmed:true};
 assert.throws(()=>registerDebtPayment(s,'t1',p,ctx),/cash_not_open/);
 const opened=openCash(s,ctx,0);
 assert.throws(()=>registerDebtPayment(opened,'t1',{...p,manualConfirmed:false},ctx),/debt_payment/);
 assert.throws(()=>registerDebtPayment(opened,'t1',{...p,method:'credit'},ctx),/debt_payment/);
 assert.throws(()=>registerDebtPayment(opened,'t2',p,ctx),/debt_not_found/);
});
test('Devolução anula dívida se não houve pagamentos e impede devolução financeira incorrecta',()=>{
 const owner={...ctx,role:'owner'};
 let s=attachCashSale(credit(openCash(base(),ctx,1000)),ctx,'venda1');
 const cancelled=refundSale(s,owner,{id:'r1',saleId:'venda1',reason:'Devolução total'});
 assert.equal(debtStatus(cancelled,cancelled.debts[0]),'cancelled');
 assert.equal(cashSummary(cancelled,cancelled.cashSessions[0]).expected.cash,1000);
 s=registerDebtPayment(s,'t1',{id:'p1',debtId:'venda1',amount:100,method:'cash',reference:'',manualConfirmed:true},ctx);
 assert.throws(()=>refundSale(s,owner,{id:'r2',saleId:'venda1',reason:'Erro'}),/debt_has_payments/);
});
test('Dívidas liquidadas e vencidas são distinguidas nos indicadores',()=>{
 let s=openCash(credit(base()),ctx,0);
 s=registerDebtPayment(s,'t1',{id:'full',debtId:'venda1',amount:17000,method:'transfer',reference:'B1',manualConfirmed:true},ctx);
 assert.equal(debtStatus(s,s.debts[0]),'settled');
 assert.equal(debtOverview(s,'t1').openCount,0);
 const next=credit(base());
 assert.equal(debtStatus(next,next.debts[0],new Date('2100-01-01T12:00:00Z')),'overdue');
 assert.equal(debtOverview(next,'t1',new Date('2100-01-01T12:00:00Z')).overdueAmount,17000);
});
test('Lembretes WhatsApp preparam URL sem envio automático',()=>{
 const text='Olá, saldo pendente de 170 MT';
 assert.match(whatsAppDebtUrl('84 123 4567',text),/^https:\/\/wa\.me\/258841234567\?text=/);
 assert.match(whatsAppDebtUrl('+258 86 1234567',text),/^https:\/\/wa\.me\/258861234567/);
 assert.equal(whatsAppDebtUrl('123456',text),'');
 assert.ok(whatsAppDebtUrl('841234567',text).includes(encodeURIComponent(text)));
});
test('Servidor mantém dívidas isoladas e protege limites de crédito e pagamentos',()=>{
 const store=createStore(':memory:',{bootstrapUser:'root-debts',bootstrapPassword:'VeryStrongBootstrap2026!',secure:false});
 try{
  const root=store.session(store.login('root-debts','VeryStrongBootstrap2026!','root').token);
  const company=store.createBusiness(root,{name:'Mercearia',type:'Mercearia',owner:'João'});
  const login=store.login(company.onboarding.username,company.onboarding.temporaryPassword,'android');
  store.changePassword(store.session(login.token),company.onboarding.temporaryPassword,'OwnerPasswordForDebts2026!',login.token);
  const owner=store.session(login.token),tenantId=owner.business_id;
  const saved=store.customerSave(owner,{id:'c1',name:'Maria',phone:'841234567'});
  assert.equal(saved.customers[0].creditLimit,0);
  store.customerCredit(owner,{customerId:'c1',creditLimit:50000,creditBlocked:false,expectedRevision:0,reason:'Compra regular'});
  const product=store.product(owner,{tenantId,name:'Açúcar',category:'Alimentação',unit:'un',price:3000,stock:10,min:1,code:'SUGAR'}).products[0];
  const staff=store.createMember(owner,{name:'Caixa',role:'cashier'}).onboarding;
  const ticket=store.login(staff.username,staff.temporaryPassword,'pos');
  store.changePassword(store.session(ticket.token),staff.temporaryPassword,'CashierPasswordForDebts2026!',ticket.token);
  const cashier=store.session(ticket.token);
  store.cashOpen(cashier,{opening:0});
  const input={id:'sale-api',tenantId,cart:[{productId:product.id,quantity:2}],method:'credit',customerId:'c1',debtDueDate:due,received:0};
  const sold=store.sale(cashier,input);
  assert.equal(sold.debts[0].amount,6000);assert.equal(sold.sales[0].received,0);
  assert.equal(store.sale(cashier,input).debts.length,1);
  assert.throws(()=>store.customerCredit(cashier,{customerId:'c1',creditLimit:80000,creditBlocked:false,expectedRevision:1,reason:'Fraude'}),e=>[400,403].includes(e.status));
  assert.equal(store.debtPayment(cashier,{id:'payment-api',debtId:'sale-api',amount:2000,method:'cash',reference:'R1',manualConfirmed:true}).debtPayments.length,1);
  const second=store.createBusiness(root,{name:'Ferragem',type:'Ferragem',owner:'Ana'});
  const secondLogin=store.login(second.onboarding.username,second.onboarding.temporaryPassword,'tablet');
  store.changePassword(store.session(secondLogin.token),second.onboarding.temporaryPassword,'OtherOwnerPassword2026!',secondLogin.token);
  const secondOwner=store.session(secondLogin.token);
  assert.equal(store.snapshot(secondOwner).debts.length,0);
  assert.throws(()=>store.debtPayment(secondOwner,{id:'wrong',debtId:'sale-api',amount:100,method:'cash',manualConfirmed:true}),e=>e.status===400);
 }finally{store.close();}
});
test('API rejeita escrita sem sessão e pedidos de outra origem',async()=>{
 const store=createStore(':memory:',{bootstrapUser:'root-api',bootstrapPassword:'VeryStrongBootstrap2026!',secure:false});
 const root=store.login('root-api','VeryStrongBootstrap2026!','laptop');
 const app=createApp(store);await new Promise(done=>app.listen(0,'127.0.0.1',done));
 const host='http://127.0.0.1:'+app.address().port;
 try{
  const body=JSON.stringify({customerId:'any',creditLimit:1000,creditBlocked:false,expectedRevision:0,reason:'test'});
  const send=(token,origin)=>fetch(host+'/api/customers/credit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Cookie:'pronto_session='+token}:{})},body});
  assert.equal((await send(null,host)).status,401);
  assert.equal((await send(root.token,'https://attacker.invalid')).status,403);
  assert.ok([400,403].includes((await send(root.token,host)).status));
 }finally{await new Promise(done=>app.close(done));store.close();}
});
test('Interface usa Gestão de Dívidas, saldo e opção de lembrete',()=>{
 const s=credit(base());
 const html=debtsPage({state:s,tenantId:'t1',lang:'pt',money:n=>(n/100)+' MT',role:'owner'});
 assert.match(html,/Gestão de Dívidas/);
 assert.match(html,/Registar pagamento/);assert.match(html,/Limites de crédito/);
 assert.match(html,/Lembrar pelo WhatsApp/);assert.doesNotMatch(html,/<script>/);
});

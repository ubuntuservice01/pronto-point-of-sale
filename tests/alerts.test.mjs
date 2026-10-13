import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryAlerts,aggregateDemand,suggestedReorder,alertSettings,updateAlertSettings} from '../src/alerts.js';
import {alertsPage,alertsHomeHTML} from '../src/alerts-ui.js';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
const at=new Date('2026-10-13T22:30:00Z'); // 14/10 in Mozambique
const product=(overrides={})=>({id:'milk',tenantId:'t1',name:'Leite',unit:'un',category:'Mercearia',price:10000,stock:12,min:4,active:true,...overrides});
const batch=(id,expiryDate,quantity,tenantId='t1',productId='milk')=>({id,tenantId,productId,number:'LOTE-'+id,expiryDate,quantity});
const state=(products=[product()],stockBatches=[])=>({products,stockBatches,sales:[],refunds:[],tenants:[{id:'t1',name:'Mercearia Central'},{id:'t2',name:'Outra Loja'}]});
test('Validades independentes por lote distinguem vencido, hoje, urgente e próximo',()=>{
 const s=state([product({stock:12})],[
  batch('expired','2026-10-13',2),batch('today','2026-10-14',1),batch('urgent','2026-10-17',3),
  batch('soon','2026-11-02',4)
 ]);
 const v=inventoryAlerts(s,'t1',{at});
 assert.equal(v.counts.expired,1);assert.equal(v.counts.today,1);
 assert.equal(v.counts.urgent,1);assert.equal(v.counts.soon,1);
 assert.equal(v.counts.low,0);assert.equal(v.counts.out,0);
 assert.equal(v.expiredQuantity,2);
 assert.equal(v.alerts.find(a=>a.type==='urgent').batchNumber,'LOTE-urgent');
 assert.equal(v.alerts.find(a=>a.type==='today').days,0);
 assert.ok(v.alerts.every(a=>a.productId==='milk'));
});
test('O stock vendável, e não físico, determina ruptura e nível mínimo',()=>{
 const s=state([product({stock:7,min:5})],[batch('vencido','2020-01-01',7)]);
 const v=inventoryAlerts(s,'t1',{at});
 assert.equal(v.counts.expired,1);assert.equal(v.counts.out,1);
 assert.equal(v.counts.low,0);
 assert.equal(v.alerts.find(a=>a.type==='out').physical,7);
 assert.equal(v.alerts.find(a=>a.type==='out').available,0);
 assert.equal(v.recommendations[0].quantity,5);
 assert.equal(v.recommendations[0].basis,'minimum_only');
});
test('Produtos sem data não geram falsos avisos de validade; stock legado mantém data real',()=>{
 const s=state([product({stock:6,min:4,expiryDate:''})]);
 assert.equal(inventoryAlerts(s,'t1',{at}).total,0);
 const old=state([product({stock:4,min:1,expiryDate:'2026-10-13'})]);
 const v=inventoryAlerts(old,'t1',{at});
 assert.equal(v.counts.expired,1);
 assert.equal(v.alerts.find(a=>a.type==='expired').legacy,true);
 assert.equal(v.alerts.find(a=>a.type==='expired').quantity,4);
 assert.equal(v.counts.out,1);
});
test('Produto inactivo não gera sugestões de reposição nem alertas de stock baixo',()=>{
 const s=state([product({active:false,stock:0,min:10})]);
 const v=inventoryAlerts(s,'t1',{at});
 assert.equal(v.total,0);assert.equal(v.recommendations.length,0);
});
test('Lotes sem quantidade não geram alertas, mesmo se estiverem vencidos',()=>{
 const s=state([product({stock:4,min:2})],[batch('zero','2020-01-01',0)]);
 assert.equal(inventoryAlerts(s,'t1',{at}).counts.expired,0);
});
test('Cada comerciante só obtém produtos e lotes próprios',()=>{
 const s=state([product({stock:0}),product({id:'other',tenantId:'t2',name:'Segredo da loja B',stock:0})],[batch('b','2020-01-01',5,'t2','other')]);
 assert.equal(inventoryAlerts(s,'t1',{at}).alerts.some(a=>a.productName==='Segredo da loja B'),false);
 assert.equal(inventoryAlerts(s,'t1',{at}).counts.expired,0);
});
test('Sugestão de reposição usa os últimos 30 dias, stock mínimo e duração configurável',()=>{
 const s=state([product({stock:5,min:10})]);
 s.sales=[{id:'recent',tenantId:'t1',createdAt:'2026-10-12T09:00:00Z',lines:[{productId:'milk',quantity:60}]},
          {id:'old',tenantId:'t1',createdAt:'2026-08-01T10:00:00Z',lines:[{productId:'milk',quantity:700}]},
          {id:'other',tenantId:'t2',createdAt:'2026-10-10T10:00:00Z',lines:[{productId:'milk',quantity:300}]}];
 const v=inventoryAlerts(s,'t1',{at});
 assert.equal(v.recommendations[0].sold30,60);
 assert.equal(v.recommendations[0].quantity,23); // daily 2 × 14 days = 28, less 5 available
 assert.equal(v.recommendations[0].target,28);
 assert.equal(v.recommendations[0].basis,'sales_and_minimum');
 assert.equal(v.counts.low,1);
});
test('Vendas devolvidas são excluídas da velocidade; dias sem vendas não inventam procura',()=>{
 const s=state([product({stock:3,min:8})]);
 s.sales=[{id:'s1',tenantId:'t1',createdAt:'2026-10-12T09:00:00Z',lines:[{productId:'milk',quantity:25}],refundId:'r1'}];
 assert.equal(inventoryAlerts(s,'t1',{at}).recommendations[0].quantity,5);
 assert.equal(inventoryAlerts(s,'t1',{at}).recommendations[0].basis,'minimum_only');
 const d=aggregateDemand(s,'t1',at);
 assert.equal(d.byProduct.milk,undefined);
});
test('Recomendação respeita unidade inteira, casas decimais e evita arredondamento negativo',()=>{
 assert.equal(suggestedReorder(product({unit:'un',min:4}),3.8,0,alertSettings({})).quantity,0.2);
 assert.equal(suggestedReorder(product({unit:'kg',min:4.25}),4.1,0,alertSettings({})).quantity,0.15);
 assert.equal(suggestedReorder(product({unit:'un',min:0}),4,0,alertSettings({})).quantity,0);
 const x=suggestedReorder(product({unit:'un',min:0}),2,15,{reorderDays:7});
 assert.equal(x.target,4);assert.equal(x.quantity,2);
});
test('Quando há demanda agregada do servidor não são necessários dados de vendas no perfil de stock',()=>{
 const s=state([product({stock:3,min:4})]);s.alertDemand={windowDays:30,byProduct:{milk:90}};
 const summary=inventoryAlerts(s,'t1',{at});
 assert.equal(summary.recommendations[0].sold30,90);
 assert.equal(summary.recommendations[0].quantity,39); // daily 3 x 14 - 3
});
test('Configurações validadas: gerente/proprietário, motivo e revisão, sem alterações silenciosas',()=>{
 let s=state();const actor={id:'u1',role:'owner',tenantId:'t1'};
 assert.deepEqual(alertSettings(s),{expiryDays:30,urgentDays:7,reorderDays:14,revision:0});
 const body={expiryDays:45,urgentDays:10,reorderDays:21,expectedRevision:0,reason:'Proximidade da estação das chuvas'};
 s=updateAlertSettings(s,body,actor);
 assert.equal(s.alertSettings.revision,1);
 assert.equal(s.alertEvents[0].actorId,'u1');
 assert.throws(()=>updateAlertSettings(s,body,actor),/revision_conflict/);
 assert.throws(()=>updateAlertSettings(s,{...body,expectedRevision:1},actor),/no_change/);
 assert.throws(()=>updateAlertSettings(s,{...body,expectedRevision:1,urgentDays:70},actor),/alert_settings/);
 assert.throws(()=>updateAlertSettings(s,{...body,expectedRevision:1,reorderDays:0},actor),/alert_settings/);
 assert.throws(()=>updateAlertSettings(s,{...body,expectedRevision:1,reorderDays:12}, {...actor,role:'cashier'}),/permission/);
});
test('Interface apresenta alertas em português de Moçambique, pesquisa e acções úteis',()=>{
 const s=state([product({name:'Arroz <script>',stock:3,min:6})],[batch('bad','2026-10-16',1)]);
 const html=alertsPage({state:s,tenantId:'t1',lang:'pt',role:'owner'});
 assert.match(html,/Alertas de Stock e Validade/);
 assert.match(html,/Sugestões de reposição/);
 assert.match(html,/Preparar lista de compras/);
 assert.match(html,/data-alert-receive="milk"/);
 assert.match(html,/data-alert-product="milk"/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 const home=alertsHomeHTML({state:s,tenantId:'t1',lang:'pt'});
 assert.match(home,/Consultar alertas/);
 assert.match(home,/data-page="alerts"/);
});
const pw='VeryStrongBootstrap2026!';
function setup(){
 const store=createStore(':memory:',{bootstrapUser:'alerts-root',bootstrapPassword:pw,secure:false});
 const login=store.login('alerts-root',pw,'admin-device'),root=store.session(login.token);
 const makeShop=name=>{
  const newShop=store.createBusiness(root,{name,type:'Retail',owner:'Dono de '+name});
  const user=store.login(newShop.onboarding.username,newShop.onboarding.temporaryPassword,'android');
  store.changePassword(store.session(user.token),newShop.onboarding.temporaryPassword,'VeryStrongOwnerPassword2026!',user.token);
  return {owner:store.session(user.token),id:store.session(user.token).business_id,token:user.token};
 };
 return {store,root,login,makeShop};
}
function staff(store,owner,role,name){
 const newPerson=store.createMember(owner,{name,role}).onboarding;
 const login=store.login(newPerson.username,newPerson.temporaryPassword,'staff-phone');
 store.changePassword(store.session(login.token),newPerson.temporaryPassword,'StrongEmployeePassword2026!',login.token);
 return {...store.session(login.token),token:login.token};
}
test('Servidor isola definições por negócio; papel de stock lê avisos e apenas agregado de vendas',()=>{
 const f=setup();
 try{
  const a=f.makeShop('A'),b=f.makeShop('B');
  const p=f.store.product(a.owner,{tenantId:a.id,name:'Bolachas',category:'Loja',unit:'un',price:5000,stock:12,min:8,code:'123'}).products[0];
  f.store.cashOpen(a.owner,{opening:1000});
  f.store.sale(a.owner,{id:'alert-sale-1',tenantId:a.id,cart:[{productId:p.id,quantity:4}],method:'cash',received:20000});
  const person=staff(f.store,a.owner,'stock','Responsável de stock');
  const snapshot=f.store.snapshot(person);
  assert.equal(snapshot.sales.length,0);
  assert.equal(snapshot.alertDemand.byProduct[p.id],4);
  assert.equal(snapshot.alertDemand.windowDays,30);
  assert.equal(snapshot.alertSettings.expiryDays,30);
  assert.ok(snapshot.products.find(x=>x.id===p.id));
  const cashier=staff(f.store,a.owner,'cashier','Caixa');
  const cash=f.store.snapshot(cashier);
  assert.deepEqual(cash.alertDemand.byProduct,{});
  assert.equal(cash.alertSettings,null);
  assert.equal(cash.alertEvents.length,0);
  const request={tenantId:a.id,expiryDays:15,urgentDays:4,reorderDays:10,expectedRevision:0,reason:'Nova política de validade'};
  assert.throws(()=>f.store.alertConfigure(person,request),e=>e.status===403);
  assert.throws(()=>f.store.alertConfigure(cashier,request),e=>e.status===403);
  assert.throws(()=>f.store.alertConfigure(b.owner,request),e=>e.status===403);
  const update=f.store.alertConfigure(a.owner,request);
  assert.equal(update.alertSettings.revision,1);
  assert.equal(update.alertEvents.length,1);
  assert.equal(f.store.snapshot(b.owner).alertSettings.expiryDays,30);
  assert.throws(()=>f.store.alertConfigure(a.owner,{...request,urgentDays:5}),e=>e.status===409);
 }finally{f.store.close();}
});
test('Endpoint configura alertas: requer sessão, origem legítima e perfil autorizado',async()=>{
 const f=setup(),a=f.makeShop('HTTP'),stock=staff(f.store,a.owner,'stock','Armazém');
 const server=createApp(f.store);await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const payload={tenantId:a.id,expiryDays:20,urgentDays:7,reorderDays:14,expectedRevision:0,reason:'Configuração da loja'};
  const req=(token,origin)=>fetch(base+'/api/alerts/settings',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Cookie:'pronto_session='+token}:{})},body:JSON.stringify(payload)});
  assert.equal((await req(null,base)).status,401);
  assert.equal((await req(a.token,'https://attacker.invalid')).status,403);
  assert.equal((await req(stock.token,base)).status,403);
  assert.equal((await req(a.token,base)).status,200);
  assert.equal((await req(a.token,base)).status,409);
 }finally{await new Promise(done=>server.close(done));f.store.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
import {planPanelHTML,licenseDetailHTML,licenseBadge} from '../src/licensing-ui.js';
import {adminPage,businessDetail} from '../src/admin-ui.js';
const password='RootPassword2026NotShort!';
function fixture(){
 let time=Date.UTC(2026,9,13,8,0,0);
 const store=createStore(':memory:',{bootstrapUser:'license-admin',bootstrapPassword:password,now:()=>time,secure:false});
 const root=store.login('license-admin',password,'root-device'),admin=store.session(root.token);
 function shop(name){
  const created=store.createBusiness(admin,{name,type:'Retail',owner:name+' Owner'});
  const a=store.login(created.onboarding.username,created.onboarding.temporaryPassword,'merchant');
  store.changePassword(store.session(a.token),created.onboarding.temporaryPassword,'MerchantPassword2026Strong!',a.token);
  return {id:store.session(a.token).business_id,username:created.onboarding.username,token:a.token,owner:store.session(a.token)};
 }
 const advance=days=>{time+=days*86400000;};
 return {store,admin,root,shop,advance,getTime:()=>time};
}
test('Legacy merchants retain access until a plan is explicitly assigned',()=>{
 const f=fixture();
 try{
  const s=f.shop('Legacy Store');f.advance(1000);
  assert.equal(f.store.snapshot(s.owner).tenants[0].license.status,'legacy');
  assert.equal(f.store.login(s.username,'MerchantPassword2026Strong!','relogin').user.role,'owner');
  assert.deepEqual(f.store.snapshot(f.admin).plans,[]);
 }finally{f.store.close();}
});
test('Create configurable paid/free plans and block duplicate names or disabled assignments',()=>{
 const f=fixture();
 try{
  const data=f.store.planCreate(f.admin,{name:'Mensal',priceCents:125000,durationDays:30});
  const plan=data.plans.find(p=>p.name==='Mensal');
  assert.equal(plan.priceCents,125000);assert.equal(plan.durationDays,30);
  assert.throws(()=>f.store.planCreate(f.admin,{name:'mensal',priceCents:10,durationDays:30}),e=>e.status===409);
  assert.throws(()=>f.store.planCreate(f.admin,{name:'Negative',priceCents:-1,durationDays:30}),e=>e.status===400);
  assert.throws(()=>f.store.planCreate(f.admin,{name:'Fractional',priceCents:100,durationDays:1.5}),e=>e.status===400);
  const free=f.store.planCreate(f.admin,{name:'Avaliação',priceCents:0,durationDays:7}).plans.find(p=>p.name==='Avaliação');
  assert.equal(free.priceCents,0);
  f.store.planStatus(f.admin,{planId:plan.id,active:false});
  assert.throws(()=>f.store.licenseAssign(f.admin,{businessId:f.shop('New').id,planId:plan.id,expectedRevision:0,reason:'Atribuição',operationId:'test-op-plan-1'}),e=>e.status===400);
  assert.equal(f.store.planStatus(f.admin,{planId:plan.id,active:true}).plans.find(p=>p.id===plan.id).active,true);
 }finally{f.store.close();}
});
test('License expiration is enforced by server clock for active cookies and new logins; renewal restores access',()=>{
 const f=fixture();
 try{
  const store=f.store,shop=f.shop('Rice Store'),plan=store.planCreate(f.admin,{name:'30 days',priceCents:50000,durationDays:30}).plans[0];
  store.product(shop.owner,{tenantId:shop.id,name:'Rice',category:'Food',code:'R',unit:'kg',price:1000,stock:15,min:1});
  const body={businessId:shop.id,planId:plan.id,expectedRevision:0,operationId:'uuid-test-assign-123456',reason:'Licença aprovada'};
  let data=store.licenseAssign(f.admin,body);assert.equal(data.tenants.find(b=>b.id===shop.id).license.status,'active');
  assert.equal(store.snapshot(shop.owner).products.length,1);
  const once=store.licenseAssign(f.admin,body);assert.equal(once.licenseEvents.filter(e=>e.action==='assigned').length,1);
  assert.throws(()=>store.licenseAssign(f.admin,{...body,operationId:'another-assignment-1',expectedRevision:1}),e=>e.status===409);
  f.advance(29.75);const nearExpiry=store.login(shop.username,'MerchantPassword2026Strong!','near-expiry');assert.equal(store.session(nearExpiry.token).role,'owner');
  f.advance(0.25);assert.throws(()=>store.session(nearExpiry.token),e=>e.status===403&&e.message==='license_expired');
  assert.throws(()=>store.login(shop.username,'MerchantPassword2026Strong!','return'),e=>e.status===403&&e.message==='license_expired');
  assert.throws(()=>store.login(shop.username,'WRONG','return'),e=>e.status===401);
  assert.equal(store.snapshot(f.admin).tenants.find(b=>b.id===shop.id).license.status,'expired');
  data=store.licenseRenew(f.admin,{businessId:shop.id,expectedRevision:0,periods:2,operationId:'uuid-test-renew-123456',reason:'Renovação autorizada',reference:'RECIBO-EXTERNO'});
  assert.equal(data.tenants.find(b=>b.id===shop.id).license.status,'active');
  assert.equal(data.licenseEvents.find(e=>e.action==='renewed').reference,'RECIBO-EXTERNO');
  assert.equal(store.login(shop.username,'MerchantPassword2026Strong!','return').user.role,'owner');
  assert.equal(store.snapshot(f.admin,shop.id).products.length,1);
  f.advance(59);assert.equal(store.login(shop.username,'MerchantPassword2026Strong!','next').user.role,'owner');
  f.advance(1);assert.throws(()=>store.login(shop.username,'MerchantPassword2026Strong!','later'),/license_expired/);
 }finally{f.store.close();}
});
test('Active renewal adds time; cancellation invalidates sessions; renewal reactivates without deleting transactions',()=>{
 const f=fixture();
 try{
  const s=f.shop('Glass Shop'),p=f.store.planCreate(f.admin,{name:'10-day pass',priceCents:3000,durationDays:10}).plans[0];
  f.store.licenseAssign(f.admin,{businessId:s.id,planId:p.id,expectedRevision:0,operationId:'license-assign-case-12',reason:'Contrato'});
  f.advance(2);
  let result=f.store.licenseRenew(f.admin,{businessId:s.id,expectedRevision:0,periods:1,operationId:'license-renew-case-121',reason:'Recebido externamente',reference:'caixa'});
  assert.equal(result.tenants.find(x=>x.id===s.id).license.revision,1);
  f.advance(17.75);const nearEnd=f.store.login(s.username,'MerchantPassword2026Strong!','near-end');assert.equal(f.store.session(nearEnd.token).role,'owner');
  f.advance(0.25);assert.throws(()=>f.store.session(nearEnd.token),/license_expired/);
  f.store.licenseRenew(f.admin,{businessId:s.id,expectedRevision:1,periods:1,operationId:'license-renew-case-122',reason:'Renovar'});
  const active=f.store.login(s.username,'MerchantPassword2026Strong!','fresh');
  result=f.store.licenseCancel(f.admin,{businessId:s.id,expectedRevision:2,reason:'Pedido de cancelamento'});
  assert.equal(result.tenants.find(x=>x.id===s.id).license.status,'cancelled');
  assert.throws(()=>f.store.session(active.token),e=>e.status===401||e.status===403);
  assert.throws(()=>f.store.login(s.username,'MerchantPassword2026Strong!','fresh'),/license_cancelled/);
  f.store.licenseRenew(f.admin,{businessId:s.id,expectedRevision:3,periods:1,operationId:'license-renew-case-123',reason:'Reactivar'});
  assert.equal(f.store.login(s.username,'MerchantPassword2026Strong!','again').user.role,'owner');
 }finally{f.store.close();}
});
test('Only Super Admin may license a merchant and revisions prevent overwriting updates',()=>{
 const f=fixture();
 try{
  const a=f.shop('A'),b=f.shop('B'),p=f.store.planCreate(f.admin,{name:'SaaS Gold',priceCents:65000,durationDays:90}).plans[0];
  const op={businessId:a.id,planId:p.id,expectedRevision:0,operationId:'assign-admin-only-12345',reason:'Aprovado'};
  assert.throws(()=>f.store.licenseAssign(a.owner,op),e=>e.status===403);
  assert.throws(()=>f.store.planCreate(b.owner,{name:'Injected',priceCents:1,durationDays:1}),e=>e.status===403);
  f.store.licenseAssign(f.admin,op);
  assert.throws(()=>f.store.licenseRenew(f.admin,{businessId:a.id,expectedRevision:99,periods:1,operationId:'renew-with-stale-uuid',reason:'Wrong'}),e=>e.status===409);
  assert.throws(()=>f.store.licenseAssign(f.admin,{...op,businessId:b.id}),e=>e.status===409);
  assert.equal(f.store.snapshot(a.owner).plans,undefined);
  assert.equal(f.store.snapshot(a.owner).licenseEvents,undefined);
  assert.equal(f.store.snapshot(b.owner).tenants[0].license.status,'legacy');
 }finally{f.store.close();}
});
test('Admin licence frontend renders escaped text, expiry status, actions and empty state',()=>{
 const merchant={id:'1',name:'Loja <script>',type:'Retail',owner:'Ana',active:1,license:{status:'active',revision:1,planName:'Pago',priceCents:50000,durationDays:30,expiresAt:'2026-11-12T10:00:00Z'}};
 const state={tenants:[merchant],plans:[{id:'p',name:'Trial <script>',priceCents:0,durationDays:7,active:true}],licenseEvents:[{tenantId:'1',action:'assigned',actorName:'Admin',reason:'<img src=x>',createdAt:'2026-10-13T10:00:00Z'}]};
 const panel=planPanelHTML({state,lang:'pt',remote:true}),detail=licenseDetailHTML({business:merchant,state,lang:'pt',remote:true});
 assert.match(panel,/new-plan/);assert.match(panel,/&lt;script&gt;/);assert.doesNotMatch(panel,/<script>/);
 assert.match(detail,/license-renew/);assert.match(detail,/license-cancel/);assert.doesNotMatch(detail,/license-assign/);
 assert.match(detail,/&lt;img src=x&gt;/);assert.doesNotMatch(detail,/<img src=x>/);
 assert.match(adminPage({businesses:state.tenants,state,lang:'pt',remote:true,search:'',type:''}),/licensing-panel/);
 assert.match(businessDetail({business:merchant,state,lang:'pt',remote:true}),/license-detail/);
 assert.match(licenseBadge({status:'expired'},'pt'),/Licença expirada/);
});
test('HTTP licensing endpoints require admin, authentication and same-origin writes',async()=>{
 const f=fixture(),s=f.shop('Merchant HTTP'),p=f.store.planCreate(f.admin,{name:'Semanal',priceCents:0,durationDays:7}).plans[0];
 const app=createApp(f.store);await new Promise(done=>app.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.address().port;
 try{
  const input={businessId:s.id,planId:p.id,expectedRevision:0,operationId:'http-assign-license-123',reason:'Teste API'};
  const request=(token,origin)=>fetch(base+'/api/licenses/assign',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Cookie:'pronto_session='+token}:{})},body:JSON.stringify(input)});
  assert.equal((await request(null,base)).status,401);
  assert.equal((await request(f.root.token,'https://attacker.invalid')).status,403);
  assert.equal((await request(s.token,base)).status,403);
  assert.equal((await request(f.root.token,base)).status,200);
 }finally{await new Promise(done=>app.close(done));f.store.close();}
});

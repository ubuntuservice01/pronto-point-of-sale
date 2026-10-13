import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
import {adminPage,businessResults,businessDetail,filterBusinesses} from '../src/admin-ui.js';
const password='TestBootstrapPassword2026!';
function setup(path=':memory:'){
 const store=createStore(path,{bootstrapUser:'main-admin',bootstrapPassword:password,secure:false});
 const superLogin=store.login('main-admin',password,'admin-desktop');
 const admin=store.session(superLogin.token);
 function merchant(name){
  const created=store.createBusiness(admin,{name,type:'Mercearia',owner:name+' Owner',phone:'841234567',email:'shop@example.com',address:'Lichinga'});
  const ownerLogin=store.login(created.onboarding.username,created.onboarding.temporaryPassword,name+'-phone');
  store.changePassword(store.session(ownerLogin.token),created.onboarding.temporaryPassword,'MerchantOwnerPassword2026!',ownerLogin.token);
  return {id:created.tenants.find(x=>x.name===name).id,owner:store.session(ownerLogin.token),token:ownerLogin.token,username:created.onboarding.username};
 }
 return {store,admin,superLogin,merchant};
}
test('Business editing persists contact data and leaves login credentials intact',()=>{
 const {store,admin,merchant}=setup();
 try{
  const a=merchant('Loja A');
  const input={businessId:a.id,expectedRevision:0,name:'Loja Principal',type:'Boutique',owner:'Nova designação',phone:'860123456',email:'contacto@lojaprincipal.co.mz',address:'Av. Eduardo Mondlane',reason:'Actualização dos dados'};
  const result=store.businessEdit(admin,input);
  const updated=result.tenants.find(x=>x.id===a.id);
  assert.equal(updated.name,'Loja Principal');assert.equal(updated.revision,1);
  assert.equal(updated.phone,'860123456');assert.equal(updated.email,'contacto@lojaprincipal.co.mz');
  assert.equal(store.snapshot(a.owner).tenants[0].name,'Loja Principal');
  assert.equal(store.session(a.token).role,'owner');
  assert.equal(store.login(a.username,'MerchantOwnerPassword2026!','new-device').user.role,'owner');
  assert.equal(result.businessEvents[0].action,'edited');assert.equal(result.businessEvents[0].actorId,admin.id);
  assert.equal(result.businessEvents[0].reason,'Actualização dos dados');
  assert.throws(()=>store.businessEdit(admin,input),e=>e.status===409&&e.message==='revision_conflict');
  assert.throws(()=>store.businessEdit(admin,{...input,expectedRevision:1}),e=>e.status===400&&e.message==='no_change');
 }finally{store.close();}
});
test('Suspending merchant revokes every owner and staff session while preserving business data',()=>{
 const {store,admin,merchant}=setup();
 try{
  const a=merchant('Suspend Shop'),b=merchant('Other Shop');
  const second=store.login(a.username,'MerchantOwnerPassword2026!','second-device');
  const created=store.createMember(a.owner,{name:'Staff',role:'cashier'}).onboarding;
  const staffLogin=store.login(created.username,created.temporaryPassword,'cashphone');
  store.changePassword(store.session(staffLogin.token),created.temporaryPassword,'MerchantStaffPassword2026!',staffLogin.token);
  store.product(a.owner,{tenantId:a.id,name:'Arroz',category:'Food',unit:'kg',code:'AR',price:1500,stock:10,min:2});
  const saved=store.snapshot(a.owner).products.length;
  const paused=store.businessStatus(admin,{businessId:a.id,expectedRevision:0,active:false,reason:'Pagamento em atraso'});
  assert.equal(paused.tenants.find(x=>x.id===a.id).active,0);
  assert.equal(paused.tenants.find(x=>x.id===a.id).revision,1);
  for(const token of [a.token,second.token,staffLogin.token])assert.throws(()=>store.session(token),e=>e.status===401);
  assert.throws(()=>store.login(a.username,'MerchantOwnerPassword2026!','again'),e=>e.status===401);
  assert.throws(()=>store.login(created.username,'MerchantStaffPassword2026!','again'),e=>e.status===401);
  assert.equal(store.session(b.token).role,'owner');
  assert.equal(store.snapshot(admin,a.id).products.length,saved);
  assert.equal(paused.businessEvents[0].action,'status');assert.equal(paused.businessEvents[0].reason,'Pagamento em atraso');
  assert.equal(paused.businessEvents[0].after.active,false);
  assert.throws(()=>store.businessStatus(admin,{businessId:a.id,expectedRevision:0,active:true,reason:'Stale'}),e=>e.status===409);
  const reopened=store.businessStatus(admin,{businessId:a.id,expectedRevision:1,active:true,reason:'Regularizado'});
  assert.equal(reopened.tenants.find(x=>x.id===a.id).active,1);
  assert.equal(store.login(a.username,'MerchantOwnerPassword2026!','reopened').user.role,'owner');
  assert.equal(store.login(created.username,'MerchantStaffPassword2026!','reopened').user.role,'cashier');
 }finally{store.close();}
});
test('Merchant owners cannot mutate other shops or invoke Super Admin actions',()=>{
 const {store,admin,merchant}=setup();
 try{
  const a=merchant('A'),b=merchant('B');
  const edit={businessId:a.id,expectedRevision:0,name:'X',type:'Shop',owner:'X',reason:'Admin'};
  assert.throws(()=>store.businessEdit(a.owner,edit),e=>e.status===403);
  assert.throws(()=>store.businessStatus(a.owner,{businessId:b.id,expectedRevision:0,active:false,reason:'No'}),e=>e.status===403);
  assert.throws(()=>store.businessStatus(admin,{businessId:'not-a-business',expectedRevision:0,active:false,reason:'No'}),e=>e.status===404);
  assert.throws(()=>store.businessStatus(admin,{businessId:a.id,expectedRevision:0,active:'false',reason:'No'}),e=>e.status===400);
  assert.throws(()=>store.businessStatus(admin,{businessId:a.id,expectedRevision:0,active:false,reason:''}),e=>e.status===400);
  assert.throws(()=>store.businessEdit(admin,{...edit,email:'invalid@email'}),e=>e.status===400);
  assert.equal(store.snapshot(a.owner).businessEvents,undefined);
 }finally{store.close();}
});
test('Migration preserves four-column legacy businesses and does not recreate merchant accounts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pronto-merchant-migrate-')),path=join(dir,'merchant.db');
 try{
  const sqlite=new DatabaseSync(path);
  sqlite.exec('CREATE TABLE businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,owner TEXT NOT NULL)');
  sqlite.exec("INSERT INTO businesses VALUES('legacy-shop','Legacy','Retail','Existing owner')");
  sqlite.close();
  const {store,admin}=setup(path);
  try{
   const b=store.snapshot(admin).tenants.find(x=>x.id==='legacy-shop');
   assert.equal(b.name,'Legacy');assert.equal(b.revision,0);assert.equal(b.active,1);
   assert.equal(b.email,'');assert.equal(b.phone,'');
   const updated=store.businessEdit(admin,{businessId:'legacy-shop',expectedRevision:0,name:'Legacy 2',type:'Retail',owner:'Existing owner',phone:'84',email:'',address:'',reason:'Migrated'});
   assert.equal(updated.tenants.find(x=>x.id==='legacy-shop').name,'Legacy 2');
  }finally{store.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Admin filters and detail safely display suspended businesses and administrative history',()=>{
 const active={id:'a',name:'Arroz & Cia',type:'Mercearia',owner:'Ana',active:1};
 const paused={id:'b',name:'Comércio <script>',type:'Ferragem',owner:'Bento',active:0,phone:'84',revision:1};
 const businesses=[active,paused];
 assert.deepEqual(filterBusinesses(businesses,'','','suspended').map(x=>x.id),['b']);
 assert.deepEqual(filterBusinesses(businesses,'arroz','','active').map(x=>x.id),['a']);
 const listing=adminPage({businesses,lang:'pt',search:'',type:'',remote:true,status:'suspended'});
 assert.match(listing,/Suspenso/);assert.match(listing,/business-status-filter/);
 assert.match(listing,/Comércio &lt;script&gt;/);assert.doesNotMatch(listing,/<script>/);
 const detail=businessDetail({business:paused,lang:'pt',remote:true,events:[{tenantId:'b',action:'status',reason:'<img src=x>',actorName:'Ubuntu',createdAt:'2026-10-13T10:00:00Z',after:{active:false}}]});
 assert.match(detail,/status-business/);assert.match(detail,/edit-business/);assert.match(detail,/&lt;img src=x&gt;/);
 assert.doesNotMatch(detail,/<img src=x>/);
});
test('HTTP admin routes require authentication and prevent cross-origin suspension',async()=>{
 const {store,admin,superLogin,merchant}=setup(),shop=merchant('Internet Shop');
 const app=createApp(store);await new Promise(done=>app.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+app.address().port;
 try{
  const body=JSON.stringify({businessId:shop.id,expectedRevision:0,active:false,reason:'Security test'});
  const send=(url,cookie,requestOrigin)=>fetch(origin+url,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(cookie?{Cookie:'pronto_session='+cookie}:{})},body});
  assert.equal((await send('/api/businesses/status',null,origin)).status,401);
  assert.equal((await send('/api/businesses/status',superLogin.token,'https://attacker.invalid')).status,403);
  assert.equal((await send('/api/businesses/status',shop.token,origin)).status,403);
  const ok=await send('/api/businesses/status',superLogin.token,origin);assert.equal(ok.status,200);
  assert.equal((await send('/api/businesses/status',superLogin.token,origin)).status,409);
  assert.equal((await fetch(origin+'/api/me',{headers:{Cookie:'pronto_session='+shop.token}})).status,401);
 }finally{await new Promise(resolve=>app.close(resolve));store.close();}
});

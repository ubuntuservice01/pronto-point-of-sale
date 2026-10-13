import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';
const rootPass='VeryStrongAdminPassword2026!';
const memberPass='ChangedMemberPassword2026!';
function bootstrap(){
 const store=createStore(':memory:',{bootstrapUser:'ubuntu.main',bootstrapPassword:rootPass,secure:false});
 const root=store.session(store.login('ubuntu.main',rootPass,'ubuntu-device').token);
 const create=name=>{
  const started=store.createBusiness(root,{name,type:'Retail',owner:name+' Owner'});
  const login=store.login(started.onboarding.username,started.onboarding.temporaryPassword,name+'-owner');
  store.changePassword(store.session(login.token),started.onboarding.temporaryPassword,'OwnerPassword2026!',login.token);
  return {owner:store.session(login.token),id:store.session(login.token).business_id,token:login.token};
 };
 return {store,root,create};
}
function staff(store,owner,name='Maria',role='cashier'){
 const created=store.createMember(owner,{name,role});
 const access=created.onboarding,login=store.login(access.username,access.temporaryPassword,'android');
 store.changePassword(store.session(login.token),access.temporaryPassword,memberPass,login.token);
 return {member:created.members.find(m=>m.username===access.username),credentials:access,token:login.token,user:store.session(login.token)};
}
test('Owner edits team member with optimistic revision; sessions are revoked and new role is effective',()=>{
 const {store,create}=bootstrap();
 try{
  const a=create('Alpha'),staffer=staff(store,a.owner);
  const second=store.login(staffer.credentials.username,memberPass,'tablet');
  assert.equal(store.sessions(staffer.user,staffer.token).length,2);
  const changed=store.memberEdit(a.owner,{memberId:staffer.member.id,expectedRevision:0,name:'Maria Gestora',role:'manager'});
  const user=changed.members.find(m=>m.id===staffer.member.id);
  assert.equal(user.name,'Maria Gestora');assert.equal(user.role,'manager');assert.equal(user.revision,1);assert.equal(user.active,true);
  assert.throws(()=>store.session(staffer.token),/unauthorized/);
  assert.throws(()=>store.session(second.token),/unauthorized/);
  const fresh=store.login(staffer.credentials.username,memberPass,'android');
  assert.equal(store.session(fresh.token).role,'manager');
  assert.equal(changed.memberEvents[0].before.role,'cashier');
  assert.equal(changed.memberEvents[0].after.role,'manager');
  assert.equal(changed.memberEvents[0].actorName,a.owner.name);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:staffer.member.id,expectedRevision:0,name:'Stale',role:'finance'}),e=>e.status===409);
 }finally{store.close();}
});
test('Deactivation blocks all sessions and login; reactivation preserves password',()=>{
 const {store,create}=bootstrap();
 try{
  const a=create('Beta'),s=staff(store,a.owner,'Luis','cashier');
  const revoked=store.memberStatus(a.owner,{memberId:s.member.id,expectedRevision:0,active:false});
  assert.equal(revoked.members.find(m=>m.id===s.member.id).active,false);
  assert.throws(()=>store.session(s.token),/unauthorized/);
  assert.throws(()=>store.login(s.credentials.username,memberPass,'mobile'),/invalid_credentials/);
  assert.throws(()=>store.memberStatus(a.owner,{memberId:s.member.id,expectedRevision:0,active:true}),e=>e.status===409);
  const reactivated=store.memberStatus(a.owner,{memberId:s.member.id,expectedRevision:1,active:true});
  assert.equal(reactivated.members.find(m=>m.id===s.member.id).active,true);
  assert.equal(reactivated.members.find(m=>m.id===s.member.id).revision,2);
  const login=store.login(s.credentials.username,memberPass,'mobile');
  assert.equal(store.session(login.token).role,'cashier');
  assert.equal(reactivated.memberEvents.filter(e=>e.action==='status').length,2);
 }finally{store.close();}
});
test('Role and tenant enforcement prevent horizontal account takeover',()=>{
 const {store,root,create}=bootstrap();
 try{
  const a=create('CompanyOne'),b=create('CompanyTwo'),sa=staff(store,a.owner,'Ana','cashier'),sb=staff(store,b.owner,'Eva','stock');
  assert.throws(()=>store.memberStatus(a.owner,{memberId:sb.member.id,expectedRevision:0,active:false}),e=>e.status===404);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:sb.member.id,expectedRevision:0,name:'Hijacked',role:'manager'}),e=>e.status===404);
  assert.throws(()=>store.memberEdit(sa.user,{memberId:sb.member.id,expectedRevision:0,name:'Hijacked',role:'manager'}),e=>e.status===403);
  assert.throws(()=>store.memberStatus(root,{memberId:sa.member.id,expectedRevision:0,active:false}),e=>e.status===403);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:a.owner.id,expectedRevision:0,name:'New owner',role:'cashier'}),e=>e.status===403);
  assert.throws(()=>store.memberStatus(a.owner,{memberId:a.owner.id,expectedRevision:0,active:false}),e=>e.status===403);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:sa.member.id,expectedRevision:0,name:'Root',role:'owner'}),e=>e.status===400);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:sa.member.id,expectedRevision:0,name:'Super',role:'super'}),e=>e.status===400);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:sa.member.id,expectedRevision:0,name:' ',role:'manager'}),e=>e.status===400);
  assert.throws(()=>store.memberStatus(a.owner,{memberId:sa.member.id,expectedRevision:0,active:'false'}),e=>e.status===400);
  assert.equal(store.snapshot(b.owner).members.some(m=>m.id===sa.member.id),false);
  assert.equal(store.snapshot(sa.user).members.length,0);
  assert.equal(store.snapshot(sa.user).memberEvents.length,0);
 }finally{store.close();}
});
test('Editing role or name without changes is rejected and does not revoke active sessions',()=>{
 const {store,create}=bootstrap();
 try{
  const a=create('Shop'),s=staff(store,a.owner);
  assert.throws(()=>store.memberEdit(a.owner,{memberId:s.member.id,expectedRevision:0,name:'Maria',role:'cashier'}),e=>e.status===400&&e.message==='no_change');
  assert.equal(store.session(s.token).role,'cashier');
  assert.throws(()=>store.memberStatus(a.owner,{memberId:s.member.id,expectedRevision:0,active:true}),e=>e.status===400&&e.message==='no_change');
  assert.equal(store.session(s.token).role,'cashier');
 }finally{store.close();}
});
test('Automatic SQLite migration upgrades an existing eight-column users table',()=>{
 const directory=mkdtempSync(join(tmpdir(),'pronto-users-')),path=join(directory,'pos.sqlite');
 let old;
 try{
  old=new DatabaseSync(path);
  old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,business_id TEXT,role TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);`);
  old.close();old=null;
  const store=createStore(path,{bootstrapUser:'ubuntu.root',bootstrapPassword:rootPass,secure:false});
  try{
   const logged=store.login('ubuntu.root',rootPass,'laptop');
   assert.equal(logged.user.role,'super');
   assert.equal(store.session(logged.token).revision,0);
  }finally{store.close();}
  const migrated=new DatabaseSync(path);
  try{assert.ok(migrated.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='revision'));}
  finally{migrated.close();}
 }finally{if(old)old.close();rmSync(directory,{recursive:true,force:true});}
});
test('HTTP team edit/status endpoints require valid owner session and same-origin POST',async()=>{
 const {store,create}=bootstrap();const a=create('HTTPshop'),s=staff(store,a.owner);
 const app=createApp(store);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 const cookie='pronto_session='+a.token;
 try{
  const input={memberId:s.member.id,expectedRevision:0,active:false};
  const req=(origin,cookieHeader)=>fetch(base+'/api/members/status',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookieHeader?{Cookie:cookieHeader}:{})},body:JSON.stringify(input)});
  assert.equal((await req(base,null)).status,401);
  assert.equal((await req('https://evil.test',cookie)).status,403);
  assert.equal((await req(base,cookie)).status,200);
  assert.equal((await req(base,cookie)).status,409);
  assert.throws(()=>store.session(s.token),/unauthorized/);
 }finally{await new Promise(resolve=>app.close(resolve));store.close();}
});

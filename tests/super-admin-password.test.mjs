import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderUbuntuAdminTab} from '../src/supabase-admin-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';

const U='11111111-1111-4111-8111-111111111111';
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function mock({admin=true,actualPassword='Old-Private-Password-2026'}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  const payload=opts.body?JSON.parse(opts.body):{};
  calls.push({url,method:opts.method,endpointBody:payload});
  if(url.endsWith('/auth/v1/token?grant_type=password')){
   if(payload.password!==actualPassword)return response(400,{error:'invalid_grant'});
   return response(200,{access_token:'test-session',user:{id:U},expires_in:3600});
  }
  if(url.endsWith('/auth/v1/user')&&opts.method==='PUT'){
   assert.equal(payload.password,'My-New-Long-Password-2026');
   assert.ok(!Object.hasOwn(payload,'app_metadata'));
   actualPassword=payload.password;
   return response(200,{id:U,email:'admin@example.org'});
  }
  if(url.endsWith('/auth/v1/user'))return response(200,{id:U,email:'admin@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(200,admin);
  if(url.includes('/rest/v1/pronto_memberships?'))return response(200,[]);
  if(url.endsWith('/auth/v1/logout'))return response(200,{});
  return response(404,{message:'not_found'});
 };
 return {calls,fetchImpl};
}
test('Super Admin security tab contains a password form for the current account only',()=>{
 const html=renderUbuntuAdminTab('security',{businesses:[],plans:[]},{insights:{}});
 for(const name of ['current_password','new_password','confirm_password']){
  assert.match(html,new RegExp('name="'+name+'"'));
 }
 assert.match(html,/data-admin-password-change/);
 assert.match(html,/autocomplete="current-password"/);
 assert.match(html,/autocomplete="new-password"/);
 assert.match(html,/minlength="12"/);
 assert.doesNotMatch(html,/name="user_id"|name="business_id"/);
 assert.match(html,/Alterar a minha palavra-passe/);
 const admin=readFileSync(new URL('../src/supabase-admin-dashboard.js',import.meta.url),'utf8');
 assert.match(admin,/content\.addEventListener\('submit',changeAdminPassword\)/);
 assert.match(admin,/await client\.changeOwnAdminPassword\(current,next\)/);
 assert.match(admin,/await client\.signOut\(\);\s*onLogout\(\)/);
});
test('Admin must verify present password before update and cannot reuse it',async()=>{
 const m=mock();
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:m.fetchImpl});
 const account=await client.signIn('admin@example.org','Old-Private-Password-2026');
 assert.equal(account.ubuntuAdmin,true);
 await assert.rejects(()=>client.changeOwnAdminPassword('Old-Private-Password-2026','short'),/admin_password_invalid/);
 await assert.rejects(()=>client.changeOwnAdminPassword('Old-Private-Password-2026','Old-Private-Password-2026'),/admin_password_same/);
 await assert.rejects(()=>client.changeOwnAdminPassword('incorrect-old-password','My-New-Long-Password-2026'),/admin_current_password_invalid/);
 assert.equal(m.calls.filter(c=>c.method==='PUT'&&c.url.endsWith('/auth/v1/user')).length,0);
 assert.equal(await client.changeOwnAdminPassword('Old-Private-Password-2026','My-New-Long-Password-2026'),true);
 assert.equal(m.calls.filter(c=>c.method==='PUT'&&c.url.endsWith('/auth/v1/user')).length,1);
 assert.ok(m.calls.every(c=>JSON.stringify(c).indexOf('sb_secret_')===-1));
 await client.signOut();
});
test('Changing a password does not bypass PIN or admin role checks',async()=>{
 const nonAdmin=mock({admin:false});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:nonAdmin.fetchImpl});
 await client.signIn('admin@example.org','Old-Private-Password-2026');
 await assert.rejects(()=>client.changeOwnAdminPassword('Old-Private-Password-2026','My-New-Long-Password-2026'),/admin_required/);
 assert.equal(nonAdmin.calls.filter(c=>c.method==='PUT').length,0);
 const admin=mock();
 const owner=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:admin.fetchImpl});
 await owner.signIn('admin@example.org','Old-Private-Password-2026');
 owner.lockScreen();
 await assert.rejects(()=>owner.changeOwnAdminPassword('Old-Private-Password-2026','My-New-Long-Password-2026'),/pin_screen_locked/);
 assert.equal(admin.calls.filter(c=>c.method==='PUT').length,0);
});

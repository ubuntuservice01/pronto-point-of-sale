import test from 'node:test';
import assert from 'node:assert/strict';
import {createProntoIdentity,normalizeMozambiquePhone} from '../src/supabase-identity.js';
import {readFileSync} from 'node:fs';

const uid='11111111-1111-4111-8111-111111111111';
const domain='https://xgtpvszwzvkwysrswkek.supabase.co';
const storage={getItem:()=>null,setItem(){},removeItem(){}};
const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});

test('Mozambique numbers normalize consistently and reject invalid formats',()=>{
 assert.equal(normalizeMozambiquePhone('84 123 4567'),'+258841234567');
 assert.equal(normalizeMozambiquePhone('+258 84 123 4567'),'+258841234567');
 assert.equal(normalizeMozambiquePhone('0841234567'),'+258841234567');
 assert.equal(normalizeMozambiquePhone('email@example.com'),null);
 assert.equal(normalizeMozambiquePhone('123'),null);
});
test('Phone and password use only Edge function, which handles GoTrue validation',async()=>{
 const calls=[];
 const api=createProntoIdentity({url:domain,publishableKey:'sb_publishable_testkey',storage,fetchImpl:async (url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/functions/v1/pronto-phone-login'))
   return response({access_token:'test_auth_token',refresh_token:'test_refresh_token',expires_in:3600,user:{id:uid}});
  if(url.endsWith('/auth/v1/user'))return response({id:uid,email:'merchant@example.test',app_metadata:{}});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(false);
  if(url.includes('/rest/v1/pronto_memberships'))return response([]);
  throw Error('unexpected request: '+url);
 }});
 const account=await api.signIn('84 123 4567','correct-password');
 assert.equal(account.email,'merchant@example.test');
 assert.ok(calls[0].url.endsWith('/functions/v1/pronto-phone-login'));
 assert.deepEqual(JSON.parse(calls[0].options.body),{phone:'+258841234567',password:'correct-password'});
 assert.ok(!calls.some(c=>c.url.includes('/auth/v1/token?grant_type=password')));
});
test('Unknown phone credentials return the same error without account lookup',async()=>{
 const api=createProntoIdentity({url:domain,publishableKey:'sb_publishable_testkey',storage,fetchImpl:async()=>response({error:'invalid_credentials'},401)});
 await assert.rejects(api.signIn('841234567','wrong-password'),{message:'supabase_invalid_credentials'});
});
test('Email login preserves the existing auth password flow',async()=>{
 let request='';
 const api=createProntoIdentity({url:domain,publishableKey:'sb_publishable_testkey',storage,fetchImpl:async (url,options)=>{
  if(url.includes('/auth/v1/token?grant_type=password')){request=url;return response({access_token:'test_auth_token',refresh_token:'test_refresh_token',expires_in:3600,user:{id:uid}});}
  if(url.endsWith('/auth/v1/user'))return response({id:uid,email:'ana@example.test',app_metadata:{}});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(false);
  if(url.includes('/rest/v1/pronto_memberships'))return response([]);
  throw Error('unexpected request '+url);
 }});
 await api.signIn('ana@example.test','some-password');
 assert.match(request,/auth\/v1\/token/);
});
test('Login screen supports email and mobile and registration validates its owner phone',()=>{
 const ui=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 assert.match(ui,/E-mail ou número de telemóvel/);
 assert.match(ui,/pronto-login-email" type="text"/);
 assert.match(ui,/normalizeMozambiquePhone\(profile.phone\)/);
});

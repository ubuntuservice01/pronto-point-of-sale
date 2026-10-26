import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';

const authUI=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
test('public register click always starts a new signup, not logged-in resume',()=>{
 assert.match(authUI,/pronto-show-register'\)\.onclick=\(\)=>registration\(false\)/);
 assert.match(authUI,/const resuming=alreadySignedIn===true/);
 assert.doesNotMatch(authUI,/pronto-show-register'\)\.onclick=registration;/);
 assert.match(authUI,/if\(!resuming\)\{/);
 assert.match(authUI,/await client\.selfServiceSignUp\(email,password,profile\.owner_name\)/);
 assert.doesNotMatch(authUI,/await client\.signIn\(email,password\);/);
});

test('signup adopts a valid GoTrue session without another password login',async()=>{
 const saved=new Map(), calls=[];
 const id='11111111-1111-4111-8111-111111111111';
 const fetchImpl=async (url,opts)=>{
  calls.push({url,opts});
  return {ok:true,status:200,json:async()=>({user:{id},
    access_token:'mock_token',refresh_token:'mock_refresh',expires_in:3600})};
 };
 const client=createProntoIdentity({
  url:'https://xgtpvszwzvkwysrswkek.supabase.co',
  publishableKey:'sb_publishable_unit_test',
  fetchImpl,
  storage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)}
 });
 const result=await client.selfServiceSignUp('example@domain.test','correct-password-123','Ana Silva');
 assert.equal(result.needsEmailConfirmation,false);
 assert.equal(calls.length,1);
 assert.ok(calls[0].url.endsWith('/auth/v1/signup'));
 assert.match(JSON.stringify([...saved.values()]),/mock_refresh/);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('Public signup explicitly explains failures instead of claiming an account exists',()=>{
 const id=readFileSync(new URL('../src/supabase-identity.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 assert.match(id,/signup_disabled:'registration_disabled'/);
 assert.match(id,/weak_password:'registration_weak_password'/);
 assert.match(ui,/registo de novos utilizadores está desactivado/);
 assert.match(ui,/Nenhuma loja foi criada/);
 assert.doesNotMatch(ui,/A conta poderá ter sido criada/);
});
test('Supabase Auth gateway header reveals an existing account even with an incomplete JSON error',async()=>{
 const {createProntoIdentity}=await import('../src/supabase-identity.js');
 const {prontoSupabaseConfig}=await import('../src/pronto-supabase-config.js');
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async(url)=>{
  assert.ok(url.endsWith('/auth/v1/signup'));
  return new Response(JSON.stringify({message:'Signup failed'}),{status:422,headers:{'x-sb-error-code':'user_already_exists'}});
 }});
 await assert.rejects(client.selfServiceSignUp('new@example.com','very-secure-password-123','Owner Name'),{message:'registration_email_exists'});
});
test('Supabase Auth recognizes the existing-account message if its error code is absent',async()=>{
 const {createProntoIdentity}=await import('../src/supabase-identity.js');
 const {prontoSupabaseConfig}=await import('../src/pronto-supabase-config.js');
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async()=>new Response(
  JSON.stringify({msg:'User already registered'}),{status:422,headers:{'content-type':'application/json'}}
 )});
 await assert.rejects(client.selfServiceSignUp('new@example.com','very-secure-password-123','Owner Name'),{message:'registration_email_exists'});
});
test('Signup keeps distinct messages for genuinely disabled registrations and unknown errors',async()=>{
 const {createProntoIdentity}=await import('../src/supabase-identity.js');
 const {prontoSupabaseConfig}=await import('../src/pronto-supabase-config.js');
 const makeClient=(code,status)=>createProntoIdentity({...prontoSupabaseConfig,
  fetchImpl:async()=>new Response(JSON.stringify({code}),{status,headers:{'content-type':'application/json'}})
 });
 const args=['new@example.com','very-secure-password-123','Owner Name'];
 await assert.rejects(makeClient('signup_disabled',403).selfServiceSignUp(...args),{message:'registration_disabled'});
 await assert.rejects(makeClient('unexpected_error',500).selfServiceSignUp(...args),{message:'registration_failed'});
 const ui=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 assert.match(ui,/Já tenho conta · Entrar/);
 assert.doesNotMatch(ui,/Verifique se o registo de utilizadores está activo/);
});

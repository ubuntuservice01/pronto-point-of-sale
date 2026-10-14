import test from 'node:test';
import assert from 'node:assert/strict';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function mock({suspended=false,member=true,failLogin=false,admin=false}={}){
 const calls=[];
 const fetchImpl=async (url,options)=>{
  calls.push({url,method:options.method,authorization:options.headers.Authorization,cache:options.cache});
  if(url.endsWith('/auth/v1/token?grant_type=password')){
   const data=JSON.parse(options.body);
   assert.equal(data.email,'cashier@example.com');
   assert.equal(data.password,'correct-password');
   assert.equal(options.headers.Authorization,undefined);
   return failLogin?json(400,{message:'Invalid login credentials'}):json(200,{access_token:'test-access-token',user:{id:A}});
  }
  assert.equal(options.headers.Authorization,'Bearer test-access-token');
  if(url.endsWith('/auth/v1/user'))return json(200,{id:A,email:'cashier@example.com'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status')){
   assert.equal(options.method,'POST');
   assert.deepEqual(JSON.parse(options.body),{});
   return json(200,admin);
  }
  if(url.includes('/pronto_memberships?'))return json(200,member?[
   {business_id:B,role:'cashier',active:true},
   {business_id:C,role:'manager',active:true}
  ]:[]);
  if(url.includes('/pronto_businesses?'))return json(200,[
   {id:B,name:'Mercearia da esquina',status:suspended?'suspended':'active'},
   {id:C,name:'Ferragem',status:'active'}
  ]);
  if(url.endsWith('/auth/v1/logout'))return json(200,{});
  return json(404,{message:'Not found'});
 };
 return {calls,fetchImpl};
}
test('The supplied publishable key is public, belongs to the expected project, and cannot be replaced by secrets',()=>{
 assert.equal(prontoSupabaseConfig.url,'https://xgtpvszwzvkwysrswkek.supabase.co');
 assert.match(prontoSupabaseConfig.publishableKey,/^sb_publishable_/);
 assert.throws(()=>createProntoIdentity({...prontoSupabaseConfig,url:'https://malicious.example.com'}),/supabase_project/);
 assert.throws(()=>createProntoIdentity({...prontoSupabaseConfig,publishableKey:'sb_secret_dummy'}),/supabase_publishable_key/);
});
test('Login checks identity and returns only active business grants under RLS',async()=>{
 const api=mock();
 const identity=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:api.fetchImpl});
 const account=await identity.signIn('cashier@example.com','correct-password');
 assert.equal(account.email,'cashier@example.com');
 assert.equal(account.ubuntuAdmin,false);
 assert.deepEqual(account.grants.map(g=>g.role),['cashier','manager']);
 assert.equal(account.grants[0].name,'Mercearia da esquina');
 assert.equal(api.calls.length,5);
 assert.ok(api.calls.every(c=>c.cache==='no-store'));
 assert.ok(api.calls[0].url.startsWith(prontoSupabaseConfig.url));
 await identity.signOut();
 assert.equal(api.calls.at(-1).method,'POST');
 await assert.rejects(()=>identity.account(),/supabase_unauthorized/);
});
test('Suspended businesses and unlinked accounts are denied a merchant context',async()=>{
 let api=mock({suspended:true});
 let identity=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:api.fetchImpl});
 let account=await identity.signIn('cashier@example.com','correct-password');
 assert.deepEqual(account.grants.map(g=>g.name),['Ferragem']);
 api=mock({member:false});
 identity=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:api.fetchImpl});
 account=await identity.signIn('cashier@example.com','correct-password');
 assert.deepEqual(account.grants,[]);
});
test('Failed login does not leave a session and never exposes upstream error payload',async()=>{
 const api=mock({failLogin:true});
 const identity=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:api.fetchImpl});
 await assert.rejects(()=>identity.signIn('cashier@example.com','correct-password'),/supabase_request_failed/);
 await assert.rejects(()=>identity.account(),/supabase_unauthorized/);
 await assert.rejects(()=>identity.signIn('bad-email','pw'),/supabase_invalid_credentials/);
 assert.equal(api.calls.length,1);
});

test('Ubuntu Super Administrator is proven only by the protected RPC, even without merchant memberships',async()=>{
 const api=mock({admin:true,member:false});
 const identity=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:api.fetchImpl});
 const account=await identity.signIn('cashier@example.com','correct-password');
 assert.equal(account.ubuntuAdmin,true);
 assert.deepEqual(account.grants,[]);
 assert.ok(api.calls.some(call=>call.url.endsWith('/rest/v1/rpc/pronto_admin_status') && call.authorization==='Bearer test-access-token'));
 await identity.signOut();
 await assert.rejects(()=>identity.account(),/supabase_unauthorized/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {pinScreen} from '../src/supabase-pin-lock.js';

const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function mock(){
 let oldPin='72819',currentPin=oldPin,invocations=[];
 let password='my-correct-account-password';
 const fetchImpl=async(url,opts)=>{
  const data=opts.body?JSON.parse(opts.body):{};
  invocations.push({url,headers:opts.headers,payload:data});
  if(url.includes('grant_type=password'))return reply(200,{access_token:'auth-token',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply(200,{id:U,email:'staff@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(200,false);
  if(url.includes('pronto_memberships?'))return reply(200,[{business_id:B,role:'cashier',active:true}]);
  if(url.includes('pronto_businesses?'))return reply(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/functions/v1/pronto-pin-recovery')){
   if(data.password!==password)return reply(403,{error:'incorrect_password'});
   if(data.new_pin===currentPin)return reply(400,{error:'same_pin'});
   currentPin=data.new_pin;return reply(200,{ok:true,configured:true});
  }
  if(url.endsWith('/rpc/pronto_session_pin')){
   const a=data.p_action;
   if(a==='status')return reply(200,{configured:true});
   if(a==='verify')return reply(200,{ok:data.p_pin===currentPin});
  }
  return reply(404,{});
 };
 return {fetchImpl,invocations,readPin:()=>currentPin};
}
test('PIN recovery screen requires account password and 5-digit confirmation',()=>{
 const html=pinScreen({mode:'recover',email:'staff@example.org'});
 assert.match(html,/Recuperar PIN/);
 assert.match(html,/name="password"/);
 assert.match(html,/autocomplete="current-password"/);
 assert.match(html,/name="new"/);
 assert.match(html,/name="confirm"/);
 assert.ok(!html.includes('name="current"'));
 assert.match(pinScreen({mode:'unlock'}),/Esqueci o PIN/);
 assert.match(pinScreen({mode:'change'}),/Esqueci o PIN/);
 assert.ok(!pinScreen({mode:'create'}).includes('Esqueci o PIN'));
 assert.ok(!pinScreen({mode:'recover',email:'<img src=x>'}).includes('<img src=x>'));
});
test('Incorrect account password does not reset the PIN or unlock existing screen',async()=>{
 const mocker=mock(),client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:mocker.fetchImpl});
 await client.signIn('staff@example.org','valid');
 client.lockScreen();
 await assert.rejects(()=>client.recoverPinWithPassword({password:'wrong',pin:'48926'}),/pin_recovery_password_incorrect/);
 assert.equal(client.isScreenLocked(),true);
 assert.equal(mocker.readPin(),'72819');
 await assert.rejects(()=>client.merchantAction('product_create',{}),/pin_screen_locked/);
 await assert.rejects(()=>client.recoverPinWithPassword({password:'correct',pin:'1234'}),/pin_recovery_invalid/);
});
test('Verified reauthentication changes the PIN without unlocking before PIN verification',async()=>{
 const mocker=mock(),client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:mocker.fetchImpl});
 await client.signIn('staff@example.org','valid');
 client.lockScreen();
 await assert.rejects(()=>client.recoverPinWithPassword({password:'my-correct-account-password',pin:'72819'}),/pin_recovery_same_pin/);
 assert.deepEqual(await client.recoverPinWithPassword({password:'my-correct-account-password',pin:'48926'}),{ok:true});
 assert.equal(client.isScreenLocked(),true);
 assert.equal((await client.sessionPin('verify','72819')).ok,false);
 assert.equal(client.isScreenLocked(),true);
 assert.equal((await client.sessionPin('verify','48926')).ok,true);
 assert.equal(client.isScreenLocked(),false);
 const posted=mocker.invocations.find(x=>x.url.endsWith('/functions/v1/pronto-pin-recovery')&&x.payload.new_pin==='48926');
 assert.equal(posted.headers.Authorization,'Bearer auth-token');
 assert.equal(posted.payload.password,'my-correct-account-password');
 assert.ok(!JSON.stringify(posted.headers).includes('service_role'));
});
test('SQL protects reset from anon and authenticated; edge checks two identities and password',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261016111000_pronto_pin_password_recovery.sql',import.meta.url),'utf8');
 const edge=readFileSync(new URL('../supabase/functions/pronto-pin-recovery/index.ts',import.meta.url),'utf8');
 for(const pattern of [/revoke all on function public\.pronto_pin_recovery_service/,/grant execute on function public\.pronto_pin_recovery_service.*?service_role/s,
  /pg_advisory_xact_lock/,/failed_attempts=0/,/blocked_until=null/,/session_pin_recovery_events/,
  /pin_must_be_different/,/pin_recovery_rate_limited/])assert.match(sql,pattern);
 for(const pattern of [/grant_type=password/,/verified\.user\.id!==user\.id/,/pronto_pin_recovery_service/,
  /SUPABASE_SERVICE_ROLE_KEY/,/auth\/v1\/logout/,/Cache-Control/,/AbortSignal\.timeout/])assert.match(edge,pattern);
 assert.ok(!edge.includes('console.log('));
 assert.ok(!edge.includes('return json({password'));
});

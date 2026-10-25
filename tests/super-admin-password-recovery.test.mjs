import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderAdmin360Members} from '../src/supabase-admin-360.js';
import {credentialsText} from '../src/pronto-credentials-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';

const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const T='33333333-3333-4333-8333-333333333333';
const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('Super Admin can request verified access recovery for a selected business member',()=>{
 const html=renderAdmin360Members({businesses:[{id:B,name:'Mercearia',members:[{userId:T,name:'Operadora Ana',email:'ana@example.org',role:'cashier',active:true}]}]});
 assert.match(html,/data-admin-password-reset/);
 assert.match(html,/name="identity_verified"/);
 assert.match(html,/name="reason"/);
 assert.match(html,/name="business_id"/);
 assert.match(html,/name="user_id"/);
 assert.match(html,/Recuperar acesso/);
 const dash=readFileSync(new URL('../src/supabase-admin-dashboard.js',import.meta.url),'utf8');
 assert.match(dash,/await client\.resetMemberPassword/);
 assert.match(dash,/showProntoCredentials\(credentials\)/);
 assert.match(dash,/content\.addEventListener\('submit',recoverAccount\)/);
});
test('Recovered credentials never show an old password and explain new password plus existing PIN',()=>{
 const text=credentialsText({ok:true,recovery:true,email:'ana@example.org',
  temporary_password:'Generated-Secret-24-ABC',account_code:'POS-33333333'},'https://exemplo.co.mz');
 assert.match(text,/Palavra-passe provisória recuperada/);
 assert.match(text,/Altere a senha provisória/);
 assert.match(text,/O PIN pessoal continua válido/);
 assert.doesNotMatch(text,/Palavra-passe inicial/);
});
test('Only current Super Admin bearer may request a recovery; no direct service role key',async()=>{
 const requests=[];
 const mock=async(url,init)=>{
  const payload=init.body?JSON.parse(init.body):null;
  requests.push({url,method:init.method,auth:init.headers.Authorization||null,payload});
  if(url.endsWith('/auth/v1/token?grant_type=password'))return respond(200,{access_token:'valid-jwt',refresh_token:'token-r',expires_in:3600,user:{id:U}});
  if(url.endsWith('/auth/v1/user'))return respond(200,{id:U,email:'admin@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return respond(200,true);
  if(url.includes('/rest/v1/pronto_memberships?'))return respond(200,[]);
  if(url.endsWith('/functions/v1/pronto-password-reset'))return respond(200,{
   ok:true,recovery:true,email:'ana@example.org',temporary_password:'Strong-Temporary-Password-8855',
   account_code:'POS-33333333',user_id:T
  });
  return respond(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:mock});
 await client.signIn('admin@example.org','example-password');
 await assert.rejects(()=>client.resetMemberPassword({businessId:B,userId:T,reason:'short',identityVerified:true}),/recovery_invalid/);
 await assert.rejects(()=>client.resetMemberPassword({businessId:B,userId:T,reason:'Confirmed by business owner',identityVerified:false}),/recovery_invalid/);
 const data=await client.resetMemberPassword({businessId:B,userId:T,reason:'Confirmed by business owner',identityVerified:true});
 assert.equal(data.recovery,true);
 const action=requests.find(x=>x.url.endsWith('/functions/v1/pronto-password-reset'));
 assert.equal(action.auth,'Bearer valid-jwt');
 assert.equal(action.payload.user_id,T);
 assert.equal(action.payload.identity_verified,true);
 assert.ok(requests.every(x=>!JSON.stringify(x).includes('sb_secret_')));
 client.lockScreen();
 await assert.rejects(()=>client.resetMemberPassword({businessId:B,userId:T,reason:'Confirmed by business owner',identityVerified:true}),/pin_screen_locked/);
});
test('Recovery RPC verifies role, membership, rate limiting and audits without secrets',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261026130000_admin_password_recovery.sql',import.meta.url),'utf8');
 const edge=readFileSync(new URL('../supabase/functions/pronto-password-reset/index.ts',import.meta.url),'utf8');
 for(const p of [/is_ubuntu_super_admin\(\)/,/pronto_memberships/,/ubuntu_super_admins/,/password_reset_requested/,
  /password_reset_completed|password_reset_'\|\|p_stage/,/admin_control_log/,/10 minutes/,/grant execute.*authenticated/])
   assert.match(migration,p);
 assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(edge,/pronto_admin_password_recovery/);
 assert.match(edge,/pronto_password_change_required:true/);
 assert.match(edge,/app_metadata:\{\.\.\.metadata/);
 assert.match(edge,/method:"PUT"/);
 assert.match(edge,/secretPassword\(\)/);
 assert.match(edge,/verified=body\.identity_verified===true/);
 assert.doesNotMatch(edge,/console\.log\(password\)/);
});

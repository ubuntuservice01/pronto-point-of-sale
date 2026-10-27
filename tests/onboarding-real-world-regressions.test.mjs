import test from 'node:test';
import assert from 'node:assert/strict';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {confirmSelfServiceActivation} from '../src/self-service-activation.js';

const OLD='11111111-1111-4111-8111-111111111111';
const NEW='22222222-2222-4222-8222-222222222222';
const SHOP='33333333-3333-4333-8333-333333333333';
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const credentials=['new-owner@example.com','a-long-secure-password-2026','Store Owner'];

test('signing up another user clears an old PIN lock before the activation RPC',async()=>{
 const calls=[];
 const storage={
  getItem(){return JSON.stringify({version:1,user_id:OLD,refresh_token:'old-refresh-credential'});},
  setItem(){},removeItem(){}
 };
 const fetchImpl=async(url,options)=>{
  calls.push({url,auth:options.headers.Authorization});
  if(url.endsWith('/auth/v1/token?grant_type=refresh_token'))return json(200,{access_token:'jwt-old',refresh_token:'old-refresh-token',expires_in:3600,user:{id:OLD}});
  if(url.endsWith('/auth/v1/user'))return json(200,{id:options.headers.Authorization==='Bearer jwt-old'?OLD:NEW,email:'owner@example.com'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return json(200,false);
  if(url.includes('/rest/v1/pronto_memberships?'))return json(200,[]);
  if(url.endsWith('/auth/v1/signup'))return json(200,{access_token:'jwt-new',refresh_token:'new-refresh-token',expires_in:3600,user:{id:NEW}});
  if(url.endsWith('/rest/v1/rpc/pronto_self_service_register'))return json(200,{business_id:SHOP,trial_days:10});
  return json(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,storage,fetchImpl});
 await client.restoreSession(); // The previous user's PIN locks the persisted session.
 await client.selfServiceSignUp(...credentials);
 const result=await client.registerSelfServiceBusiness({business_name:'Nova Loja'});
 assert.equal(result.business_id,SHOP);
 const rpc=calls.find(x=>x.url.endsWith('/rest/v1/rpc/pronto_self_service_register'));
 assert.equal(rpc.auth,'Bearer jwt-new');
 assert.equal(calls.filter(x=>x.url.endsWith('/auth/v1/signup')).length,1);
});

test('a disconnected activation request keeps identity and can be retried without new signup',async()=>{
 let offline=true;const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/signup'))return json(200,{access_token:'jwt-new',refresh_token:'new-refresh-token',expires_in:3600,user:{id:NEW}});
  if(url.endsWith('/rest/v1/rpc/pronto_self_service_register')){
   if(offline)throw new TypeError('Failed to fetch');
   return json(200,{business_id:SHOP,trial_days:10});
  }
  return json(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.selfServiceSignUp(...credentials);
 await assert.rejects(client.registerSelfServiceBusiness({business_name:'Loja'}),{message:'supabase_unavailable'});
 offline=false;
 const activated=await client.registerSelfServiceBusiness({business_name:'Loja'});
 assert.equal(activated.business_id,SHOP);
 assert.equal(calls.filter(url=>url.endsWith('/auth/v1/signup')).length,1);
});

test('trial activation verifies actual Postgres timestamp formatting and owner identity',async()=>{
 const start='2026-10-27T11:00:00.123456+00:00';
 const end='2026-11-06T11:00:00.123456+00:00';
 const client={
  account:async()=>({grants:[{id:SHOP,role:'owner',name:'Loja Teste'}]}),
  myTrialStatus:async()=>({started_at:start,trial_expires_at:end,expires_at:end,is_trial:true,expired:false})
 };
 const result=await confirmSelfServiceActivation(client,{expectedBusinessId:SHOP,now:Date.parse('2026-10-27T11:10:00Z')});
 assert.equal(result.businessId,SHOP);assert.equal(result.trialDays,10);
 assert.equal(result.businessName,'Loja Teste');
});

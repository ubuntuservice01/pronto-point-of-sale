import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {normalizeAdminOverview,ADMIN_TABS} from '../src/supabase-admin-model.js';
import {renderProvisioningForms} from '../src/supabase-admin-forms.js';
import {prepareAdminProvisioning} from '../src/supabase-admin-dashboard.js';

const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const P='33333333-3333-4333-8333-333333333333';
const json=(status,x)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
function mock({admin=true}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method,headers:options.headers,data:options.body});
  if(url.endsWith('/auth/v1/token?grant_type=password'))return json(200,{access_token:'jwt-token',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return json(200,{id:U,email:'owner@example.com'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return json(200,admin);
  if(url.includes('/rest/v1/pronto_memberships?'))return json(200,[]);
  if(url.endsWith('/rest/v1/rpc/pronto_admin_mutation')){
   return admin?json(200,{id:B,status:'suspended'}):json(403,{error:'admin_required'});
  }
  if(url.endsWith('/functions/v1/pronto-credentials')){
   return admin?json(201,{ok:true,email:'staff@example.org',temporary_password:'Strong-Credential-Not-Shared-232',account_code:'POS-11111111',user_id:U}):json(403,{error:'not_authorized'});
  }
  return json(404,{});
 };
 return {calls,fetchImpl};
}
const example=normalizeAdminOverview({businesses:[{
 id:B,name:'Loja <Alpha>',status:'suspended',phone:'',address:'',
 branches:1,operators:0,members:[{user_id:U,role:'owner',active:true,
 name:'Dona <Sofia>',email:'sofia@example.org'}]
}],plans:[{id:P,name:'Mensal',price_cents:100000,duration_days:30,active:true}]});
test('Six Ubuntu administrative tabs include a specific user-management screen',()=>{
 assert.deepEqual(ADMIN_TABS,['overview','businesses','members','licenses','plans','finance','audit','security']);
 for(const key of ['businesses','members','licenses','plans']){
  assert.ok(renderProvisioningForms(key,example).includes('<form'),key);
 }
 const html=renderProvisioningForms('members',example);
 assert.ok(html.includes('member_create')&&html.includes('member_assign'));
 assert.ok(html.includes('Sofia')&&!html.includes('<Sofia>'));
 assert.ok(html.includes('&lt;Sofia&gt;'));
 assert.ok(html.includes('sofia@example.org'));
 assert.ok(html.includes('Loja &lt;Alpha&gt;'));
 assert.ok(!html.includes('name="password"'));
});
test('UI produces correct integer prices and refuses invalid payment input',()=>{
 const FormMock=class {constructor(el){this.values=el.values;}get(k){return this.values[k]??'';}};
 // production accepts browser FormData; inject a FormData-compatible test constructor
 const price=prepareAdminProvisioning({dataset:{provisionAction:'plan_create'},values:{
  name:'Mensal',price_mzn:'1.250,50',duration_days:'30'
 }},FormMock);
 assert.deepEqual(price,{action:'plan_create',data:{name:'Mensal',price_cents:125050,duration_days:30}});
 assert.throws(()=>prepareAdminProvisioning({dataset:{provisionAction:'plan_create'},values:{
  name:'Invalido',price_mzn:'12.1234',duration_days:'30'
 }},FormMock),/invalid_price/);
 const shop=prepareAdminProvisioning({dataset:{provisionAction:'business_create'},values:{
  name:'Mercearia',phone:'84 000 0000',address:'Lichinga'
 }},FormMock);
 assert.equal(shop.data.name,'Mercearia');
 assert.equal(shop.data.branch_name,'');
});
test('Supabase privileged operations require authenticated bearer and never ship admin keys',async()=>{
 const m=mock();
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:m.fetchImpl});
 await assert.rejects(()=>client.adminMutate('business_create',{}),/supabase_forbidden/);
 assert.equal((await client.account()).ubuntuAdmin,false);
 await assert.rejects(()=>client.provisionMember({}),/supabase_unauthorized/);
 const account=await client.signIn('owner@example.com','demo-password');
 assert.equal(account.ubuntuAdmin,true);
 assert.deepEqual(await client.adminMutate('business_create',{name:'Loja Real'}),{id:B,status:'suspended'});
 assert.deepEqual(await client.provisionMember({email:'staff@example.org',business_id:B,role:'owner',display_name:'Sofia'}),{ok:true,email:'staff@example.org',temporary_password:'Strong-Credential-Not-Shared-232',account_code:'POS-11111111',user_id:U});
 const mutation=m.calls.find(c=>c.url.endsWith('/rpc/pronto_admin_mutation'));
 assert.equal(mutation.headers.Authorization,'Bearer jwt-token');
 assert.deepEqual(JSON.parse(mutation.data),{p_action:'business_create',p_data:{name:'Loja Real'}});
 const invite=m.calls.find(c=>c.url.endsWith('/functions/v1/pronto-credentials'));
 assert.equal(invite.headers.Authorization,'Bearer jwt-token');
 assert.equal(invite.headers.apikey,prontoSupabaseConfig.publishableKey);
 assert.ok(!m.calls.some(c=>JSON.stringify(c).includes('sb_secret_')));
 await assert.rejects(()=>client.adminMutate('change_auth_user_password',{id:U}),/admin_invalid_action/);
});
test('A non-admin cannot perform mutations even with a valid JWT',async()=>{
 const m=mock({admin:false});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:m.fetchImpl});
 const account=await client.signIn('owner@example.com','demo-password');
 assert.equal(account.ubuntuAdmin,false);
 await assert.rejects(()=>client.adminMutate('business_create',{}),/supabase_unauthorized/);
});
test('SQL provisioning checks auth.uid, logs each operation and never writes checkout sales',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015142000_pronto_admin_provisioning.sql',import.meta.url),'utf8');
 assert.match(sql,/not pronto_private\.is_ubuntu_super_admin\(\)/i);
 assert.match(sql,/p_action='business_create'/);
 assert.match(sql,/p_action='plan_create'/);
 assert.match(sql,/p_action='member_assign'/);
 assert.match(sql,/p_action='license_assign'/);
 assert.match(sql,/pronto_private\.admin_actions/);
 assert.match(sql,/status='suspended'/);
 assert.match(sql,/grant execute on function public\.pronto_admin_mutation\(text,jsonb\) to authenticated/);
 assert.doesNotMatch(sql,/insert into public\.pronto_sales|update public\.pronto_products/i);
});
test('Legacy Edge invitation is disabled and will never send automatic emails',()=>{
 for(const name of ['pronto-admin-invite','pronto-owner-invite']){
  const code=readFileSync(new URL('../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8');
  assert.match(code,/legacy_invitation_disabled/);
  assert.match(code,/status:410/);
  assert.equal(code.includes('/auth/v1/invite'),false); assert.equal(code.includes('sendEmail('),false);
 }
});

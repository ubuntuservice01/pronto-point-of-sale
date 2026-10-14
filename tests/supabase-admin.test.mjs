import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {ADMIN_TABS,normalizeAdminOverview,licenseState,adminSummary,matchAdminBusiness} from '../src/supabase-admin-model.js';
import {renderUbuntuAdminShell,renderUbuntuAdminTab} from '../src/supabase-admin-ui.js';

const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const P='33333333-3333-4333-8333-333333333333';
const O='44444444-4444-4444-8444-444444444444';
const response=(code,obj)=>new Response(JSON.stringify(obj),{status:code,headers:{'content-type':'application/json'}});
const businesses=[
 {id:B,name:'Mercearia São João',status:'active',phone:'840000000',address:'Lichinga',created_at:'2026-10-12T08:00:00Z',branches:2,operators:4,plan_name:'Mensal',plan_id:P,expires_at:'2026-11-12T00:00:00Z',license_cancelled:false},
 {id:O,name:'Ferragem da Vila',status:'suspended',phone:'',address:'Majune',created_at:'2026-10-10T09:00:00Z',branches:1,operators:1,plan_name:null,plan_id:null,expires_at:null,license_cancelled:false}
];
const serverData={businesses,plans:[{id:P,name:'Mensal',price_cents:350000,duration_days:30,active:true}],generated_at:'2026-10-14T19:00:00Z'};
function mock({admin=true,failOverview=false,refresh=false}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method,auth:options.headers.Authorization||null,body:options.body||null,cache:options.cache});
  if(url.endsWith('/auth/v1/token?grant_type=password'))return response(200,{user:{id:U},access_token:'before',refresh_token:'refresh-1',expires_in:refresh?1:3600});
  if(url.endsWith('/auth/v1/token?grant_type=refresh_token'))return response(200,{user:{id:U},access_token:'after',refresh_token:'refresh-2',expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return response(200,{id:U,email:'test@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(200,admin);
  if(url.includes('/rest/v1/pronto_memberships?'))return response(200,[]);
  if(url.endsWith('/rest/v1/rpc/pronto_admin_overview'))return response(!admin||failOverview?403:200,!admin||failOverview?{message:'permission denied'}:serverData);
  if(url.endsWith('/auth/v1/logout'))return response(200,{});
  return response(404,{});
 };
 return {fetchImpl,calls};
}

test('Administrative RPC is server-protected, returns only permitted read-only data',async()=>{
 const m=mock();
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:m.fetchImpl});
 const a=await client.signIn('test@example.org','password');
 assert.equal(a.ubuntuAdmin,true);
 assert.deepEqual(a.grants,[]);
 const data=await client.adminOverview();
 assert.equal(data.businesses.length,2);
 assert.equal(data.plans.length,1);
 assert.equal(data.businesses[0].name,'Mercearia São João');
 const rpc=m.calls.find(x=>x.url.endsWith('pronto_admin_overview'));
 assert.equal(rpc.method,'POST');
 assert.equal(rpc.auth,'Bearer before');
 assert.deepEqual(JSON.parse(rpc.body),{});
 assert.ok(m.calls.every(x=>x.cache==='no-store'));
 assert.ok(m.calls.every(x=>!x.url.includes('service_role')));
 await client.signOut();
 await assert.rejects(client.adminOverview(),/supabase_unauthorized/);
});

test('Revoked or ordinary user cannot receive the global administration snapshot',async()=>{
 const m=mock({admin:false});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:m.fetchImpl});
 const user=await client.signIn('test@example.org','password');
 assert.equal(user.ubuntuAdmin,false);
 await assert.rejects(client.adminOverview(),/supabase_unauthorized/);
 await assert.rejects(client.account(),/supabase_unauthorized/);
});

test('A short-lived token is automatically refreshed in memory, preserving the user identity',async()=>{
 const m=mock({refresh:true});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:m.fetchImpl});
 const user=await client.signIn('test@example.org','password');
 assert.equal(user.ubuntuAdmin,true);
 const refreshed=m.calls.find(x=>x.url.endsWith('grant_type=refresh_token'));
 assert.ok(refreshed);
 assert.equal(JSON.parse(refreshed.body).refresh_token,'refresh-1');
 const data=await client.adminOverview();
 assert.equal(data.businesses.length,2);
 assert.equal(m.calls.find(x=>x.url.endsWith('/rpc/pronto_admin_overview')).auth,'Bearer after');
});
test('Licence states and dashboard totals reflect current real records, not demo placeholders',()=>{
 const data=normalizeAdminOverview(serverData);
 const day=new Date('2026-10-14T19:00:00Z');
 const summary=adminSummary(data,day);
 assert.deepEqual(summary,{total:2,activeBusinesses:1,suspendedBusinesses:1,activeLicenses:1,expiredLicenses:0,unassignedLicenses:1,cancelledLicenses:0,branches:3,operators:5,plans:1});
 assert.equal(licenseState(data.businesses[0],new Date('2026-12-01T00:00:00Z')),'expired');
 assert.equal(licenseState({...data.businesses[0],licenseCancelled:true},day),'cancelled');
 assert.equal(licenseState(data.businesses[1],day),'unassigned');
 assert.equal(matchAdminBusiness(data.businesses[0],'sao joao'),true);
 assert.equal(matchAdminBusiness(data.businesses[0],'inexistente'),false);
});
test('The five navigation pages exist; no editable financial or licensing controls are rendered',()=>{
 const data=normalizeAdminOverview(serverData);
 const shell=renderUbuntuAdminShell({email:'test@example.org'});
 for(const tab of ADMIN_TABS) {
  assert.ok(shell.includes('data-admin-tab="'+tab+'"'));
  const html=renderUbuntuAdminTab(tab,data,{now:new Date('2026-10-14T19:00:00Z')});
  assert.ok(html.length>100);
  assert.ok(!html.includes('<form'));
  assert.ok(!html.includes('data-admin-delete'));
  assert.ok(!html.includes('data-admin-create'));
 }
 assert.match(shell,/id="pronto-admin-refresh"/);
 assert.match(shell,/id="pronto-admin-logout"/);
 assert.match(shell,/id="pronto-admin-search"/);
 assert.match(renderUbuntuAdminTab('businesses',data),/Mercearia São João/);
 assert.match(renderUbuntuAdminTab('licenses',data),/Activo|Sem licença/);
 assert.match(renderUbuntuAdminTab('plans',data),/3[ .\u00a0\u202f]500,00 MT/);
 assert.match(renderUbuntuAdminTab('businesses',data,{query:'inexistente'}),/Nenhum comerciante encontrado/);
});
test('All untrusted business details and emails are escaped in the dashboard',()=>{
 const danger='<img src=x onerror=alert(1)>';
 const row={...serverData.businesses[0],name:danger,phone:'<script>evil()</script>'};
 const data=normalizeAdminOverview({...serverData,businesses:[row]});
 const html=renderUbuntuAdminTab('businesses',data);
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 const shell=renderUbuntuAdminShell({email:danger});
 assert.ok(shell.includes('&lt;img'));
 assert.ok(!shell.includes('<img src=x'));
});
test('Migration enforces admin UID in private definer, exposed invoker, and read-only access',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261014200000_pronto_admin_overview.sql',import.meta.url),'utf8');
 assert.match(sql,/if not pronto_private\.is_ubuntu_super_admin\(\)/i);
 assert.match(sql,/security definer/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/grant execute on function public\.pronto_admin_overview\(\) to authenticated/i);
 assert.match(sql,/revoke all on function public\.pronto_admin_overview\(\) from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/insert into|update public\.pronto_|delete from/i);
});

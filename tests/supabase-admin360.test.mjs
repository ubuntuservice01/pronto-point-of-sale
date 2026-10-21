import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeAdminOverview} from '../src/supabase-admin-model.js';
import {renderUbuntuAdminTab} from '../src/supabase-admin-ui.js';
import {admin360Metrics,renderAdmin360Overview,renderAdmin360Businesses,renderAdmin360Finance,renderAdmin360Audit,admin360AuditCSV} from '../src/supabase-admin-360.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const P='33333333-3333-4333-8333-333333333333';
const fixtures=normalizeAdminOverview({businesses:[{id:B,name:'Mercearia Niassa',phone:'840000000',address:'Lichinga',status:'active',created_at:'2026-10-01T12:00:00Z',plan_id:P,plan_name:'Mensal',expires_at:'2026-11-15T12:00:00Z',branches:1,operators:1,members:[{user_id:U,name:'Ana',email:'ana@example.org',role:'owner',active:true}]}],plans:[{id:P,name:'Mensal',price_cents:350000,duration_days:30,active:true}]});
const insights={businesses:[],branches:[{id:B,business_id:B,name:'Principal',active:true}],events:[{id:B,business_id:B,actor_id:U,action:'business_edit',reason:'Dados actualizados',created_at:'2026-10-20T16:00:00Z'}],payments:[{id:U,business_id:B,amount_cents:350000,method:'mpesa',reference:'REF1234',paid_at:'2026-10-20T12:00:00Z'}],payments_total_cents:350000};
test('Real charts derive metrics from actual records, without fabricated revenue',()=>{
 const m=admin360Metrics(fixtures,insights,new Date('2026-10-21T10:00:00Z'));
 assert.equal(m.total,1);assert.equal(m.active,1);assert.equal(m.operators,1);
 assert.equal(m.licenses,1);assert.equal(m.collected,350000);
 assert.equal(m.byPlan[0].count,1);assert.equal(m.byMonth.at(-1).count,1);
 const html=renderAdmin360Overview(fixtures,insights);
 assert.match(html,/Evolução dos comerciantes/);
 assert.match(html,/Distribuição por planos/);
 assert.match(html,/Dados reais/);
});
test('Merchant management and user controls are operational HTML forms',()=>{
 const html=renderAdmin360Businesses(fixtures,insights);
 for(const action of ['business_suspend','business_archive','business_remove','business_edit','branch_edit'])
  assert.match(html,new RegExp(action));
 assert.match(renderUbuntuAdminTab('members',fixtures,{insights}),/member_edit/);
 assert.match(renderUbuntuAdminTab('members',fixtures,{insights}),/member_deactivate/);
 assert.match(renderUbuntuAdminTab('plans',fixtures,{insights}),/plan_toggle/);
 assert.match(renderUbuntuAdminTab('licenses',fixtures,{insights}),/license_cancel/);
});
test('Financial results reflect only recorded payments, no guessed M-Pesa success',()=>{
 const html=renderAdmin360Finance(fixtures,insights);
 assert.match(html,/payment_record/);
 assert.match(html,/3500|3.500|3 500/);
 assert.match(html,/efectivamente recebidos/);
 const empty=renderAdmin360Finance(fixtures,{...insights,payments:[],payments_total_cents:0});
 assert.match(empty,/Ainda não existem cobranças/);
});
test('Admin charts and audit always escape malicious metadata and spreadsheet cells',()=>{
 const evil='<svg onload=alert(7)>';
 const risky=normalizeAdminOverview({...fixtures,businesses:fixtures.businesses.map(x=>({id:x.id,name:evil,status:'active',branches:1,operators:1}))});
 const html=renderAdmin360Businesses(risky,insights)+renderAdmin360Audit(risky,{...insights,events:[{...insights.events[0],reason:evil}]});
 assert.doesNotMatch(html,/<svg/);
 assert.match(html,/&lt;svg/);
 const csv=admin360AuditCSV({...insights,events:[{...insights.events[0],reason:'=CMD()'}]});
 assert.match(csv,/'=CMD/);
});
test('New SQL requires global admin, explicit audit, reversible removal and no financial cascade',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261021130000_ubuntu_super_admin_360.sql',import.meta.url),'utf8');
 assert.match(migration,/not pronto_private\.is_ubuntu_super_admin\(\)/);
 assert.match(migration,/business_edit/);assert.match(migration,/business_archive/);
 assert.match(migration,/business_remove/);assert.match(migration,/business_restore/);
 assert.match(migration,/member_edit/);assert.match(migration,/payment_record/);
 assert.match(migration,/pronto_private\.admin_control_log/);
 assert.doesNotMatch(migration,/delete\s+from\s+public\.pronto_sales/i);
});
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('Authorized client calls protected admin APIs, not anonymous direct table writes',async()=>{
 const calls=[];
 const fetchImpl=async(url,args)=>{
  calls.push({url,headers:args.headers,body:args.body});
  if(url.includes('/auth/v1/token'))return json(200,{user:{id:U},access_token:'valid-session',expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return json(200,{id:U,email:'admin@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return json(200,true);
  if(url.includes('/rest/v1/pronto_memberships?'))return json(200,[]);
  if(url.endsWith('/rest/v1/rpc/pronto_ubuntu_admin_insights'))return json(200,insights);
  if(url.endsWith('/rest/v1/rpc/pronto_ubuntu_admin_control'))return json(200,{business_id:B,state:'suspended'});
  if(url.endsWith('/rest/v1/rpc/pronto_ubuntu_admin_critical'))return json(200,{business_id:B,status:'suspended'});
  return json(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.signIn('admin@example.org','testpassword');
 assert.deepEqual(await client.adminInsights(),insights);
 assert.deepEqual(await client.adminControl('business_archive',{business_id:B,reason:'Admin test event'}),{business_id:B,state:'suspended'});
 assert.ok(calls.some(x=>x.url.endsWith('/rpc/pronto_ubuntu_admin_control')&&x.headers.Authorization==='Bearer valid-session'));
 assert.deepEqual(await client.adminCritical('business_suspend',{business_id:B,reason:'Suspeita de acesso indevido'}),{business_id:B,status:'suspended'});
 await assert.rejects(()=>client.adminCritical('business_suspend',{business_id:B,reason:''}),/admin_invalid_action/);
 assert.ok(calls.some(x=>x.url.endsWith('/rpc/pronto_ubuntu_admin_critical')));
});

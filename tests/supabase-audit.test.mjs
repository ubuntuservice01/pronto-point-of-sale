import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeAuditSnapshot,renderAuditView,filterAuditEvents,auditCSV} from '../src/supabase-audit-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const raw={
 page:0,limit:50,has_more:true,
 events:[
  {id:'33333333-3333-4333-8333-333333333333',event:'team.suspend',
   actor_name:'Senhora <script>alert(1)</script>',target_id:U,created_at:'2026-10-16T10:30:00Z'},
  {id:'44444444-4444-4444-8444-444444444444',event:'finance.expense_add',
   actor_name:'=SUM(1,2)',target_id:null,created_at:'2026-10-15T10:30:00Z'}
 ]
};
test('Owner audit UI escapes names and supports pagination and local search',()=>{
 const data=normalizeAuditSnapshot(raw),ui=renderAuditView({audit:data});
 assert.equal(data.events.length,2);
 assert.match(ui,/Colaborador suspenso|Acesso de colaborador suspenso/);
 assert.ok(!ui.includes('<script>'));
 assert.ok(ui.includes('&lt;script&gt;'));
 assert.match(ui,/data-audit-next/);
 assert.match(ui,/data-audit-export/);
 assert.equal(filterAuditEvents(data,'financeiro').length,0);
 assert.equal(filterAuditEvents(data,'suspend').length,1);
 assert.throws(()=>normalizeAuditSnapshot({events:{}}),/audit_snapshot_invalid/);
});
test('CSV output prevents spreadsheet formula injection and excludes raw payload',()=>{
 const csv=auditCSV(normalizeAuditSnapshot(raw));
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/'=SUM\(1,2\)/);
 assert.ok(!csv.includes('auth-token'));
 assert.ok(!csv.includes('customer_phone'));
});
test('Audit RPC requires authenticated session, UUID tenant and sane page',async()=>{
 const calls=[];
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return reply(200,{access_token:'jwt',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply(200,{id:U,email:'owner@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(200,false);
  if(url.includes('pronto_memberships?'))return reply(200,[{business_id:B,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return reply(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_owner_audit_snapshot'))return reply(200,raw);
  return reply(404,{});
 }});
 await assert.rejects(()=>client.ownerAuditSnapshot(B),/supabase_unauthorized/);
 await client.signIn('owner@example.org','password');
 const value=await client.ownerAuditSnapshot(B,0);
 assert.equal(value.events[0].event,'team.suspend');
 const c=calls.find(x=>x.url.endsWith('/rpc/pronto_owner_audit_snapshot'));
 assert.equal(c.opts.headers.Authorization,'Bearer jwt');
 assert.deepEqual(JSON.parse(c.opts.body),{p_business:B,p_page:0,p_limit:50});
 await assert.rejects(()=>client.ownerAuditSnapshot('bad'),/audit_scope/);
 await assert.rejects(()=>client.ownerAuditSnapshot(B,101),/audit_scope/);
});
test('SQL does not expose arbitrary audit payload or allow non-owner reads',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261016114500_pronto_owner_audit_history.sql',import.meta.url),'utf8');
 assert.match(sql,/member_role\(p_business\).*?'owner'/s);
 assert.match(sql,/limit v_limit offset v_offset/);
 assert.match(sql,/has_more/);
 assert.match(sql,/revoke all on function public\.pronto_owner_audit_snapshot/);
 assert.match(sql,/where business_id=p_business/);
 assert.doesNotMatch(sql,/'payload',e\.payload/);
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 assert.match(ui,/renderAuditView/);
 assert.match(ui,/audit:\['owner'\]/);
});

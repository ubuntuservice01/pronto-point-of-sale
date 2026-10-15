import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeStaffSnapshot,renderStaffManagement} from '../src/supabase-team-management-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111';
const U='22222222-2222-4222-8222-222222222222';
const E='33333333-3333-4333-8333-333333333333';
const raw={staff:[{user_id:E,name:'Caixa <Ana>',email:'a@example.org',role:'cashier',active:true}]};
test('Staff list escapes untrusted names and never exposes PIN or password',()=>{
 const snapshot=normalizeStaffSnapshot(raw);
 assert.equal(snapshot.staff[0].role,'cashier');
 const html=renderStaffManagement(snapshot);
 assert.match(html,/data-shop-form="staff_role_change"/);
 assert.match(html,/data-staff-suspend/);
 assert.ok(html.includes('Caixa &lt;Ana&gt;')&&!html.includes('<Ana>'));
 assert.ok(!html.includes('PIN actual')&&!html.includes('password'));
 assert.ok(!html.includes('value="owner"'));
 assert.match(renderStaffManagement(normalizeStaffSnapshot({staff:[{...raw.staff[0],active:false}]})),/data-staff-reactivate/);
 assert.deepEqual(normalizeStaffSnapshot({staff:[]}).staff,[]);
 assert.throws(()=>normalizeStaffSnapshot({staff:{}}),/staff_snapshot_invalid/);
});
test('Owner-only team RPCs require Supabase authentication',async()=>{
 const logs=[];
 const response=(v,st=200)=>new Response(JSON.stringify(v),{status:st,headers:{'Content-Type':'application/json'}});
 const fetchImpl=async(url,opts)=>{
  logs.push({url,opts});
  if(url.includes('grant_type=password'))return response({access_token:'jwt',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return response({id:U,email:'owner@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return response(false);
  if(url.includes('pronto_memberships?'))return response([{business_id:B,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return response([{id:B,name:'Shop',status:'active'}]);
  if(url.endsWith('/rpc/pronto_owner_staff_snapshot'))return response(raw);
  if(url.endsWith('/rpc/pronto_owner_staff_action'))return response({user_id:E,role:'cashier',active:false,changed:true});
  return response({},404);
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await assert.rejects(()=>client.ownerStaffSnapshot(B),/supabase_unauthorized/);
 await client.signIn('owner@example.org','password');
 assert.equal((await client.ownerStaffSnapshot(B)).staff[0].name,'Caixa <Ana>');
 assert.equal((await client.ownerStaffAction('suspend',{business_id:B,user_id:E})).active,false);
 await assert.rejects(()=>client.ownerStaffAction('make_admin',{}),/staff_action_invalid/);
 const request=logs.find(x=>x.url.endsWith('/rpc/pronto_owner_staff_action'));
 assert.equal(request.opts.headers.Authorization,'Bearer jwt');
 assert.deepEqual(JSON.parse(request.opts.body),{p_action:'suspend',p_data:{business_id:B,user_id:E}});
});
test('Staff permissions are enforced in the SQL and never grant owner access',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015233000_pronto_owner_manage_staff.sql',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 const dash=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 for(const item of [/security definer/,/member_role\(v_business\)/,/cannot_modify_owner/,
  /cannot_modify_global_admin/,/role_change/,/pronto_audit_events/,
  /'manager','cashier','stock','finance'/])assert.match(sql,item);
 assert.match(ui,/renderStaffManagement/);
 assert.match(dash,/ownerStaffAction\('role_change'/);
 assert.match(dash,/data-staff-suspend/);
});

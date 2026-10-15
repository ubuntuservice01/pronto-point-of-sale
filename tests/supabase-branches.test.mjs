import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const U='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
test('branch action requires secure login and exact action allowlist',async()=>{
 const calls=[],reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return reply({access_token:'jwt',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply({id:U,email:'owner@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(false);
  if(url.includes('pronto_memberships?'))return reply([{business_id:B,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return reply([{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_manage_branch'))return reply({branches:[]});
  return reply([]);
 }});
 await assert.rejects(()=>client.manageBranch('list',{business_id:B}),/supabase_unauthorized/);
 await client.signIn('owner@example.org','pw');
 await assert.rejects(()=>client.manageBranch('delete_all',{}),/branch_action_invalid/);
 assert.deepEqual(await client.manageBranch('list',{business_id:B}),{branches:[]});
 const call=calls.find(x=>x.url.endsWith('/rpc/pronto_manage_branch'));
 assert.equal(call.opts.headers.Authorization,'Bearer jwt');
});
test('branch owner UI and SQL refuse last branch, open cash, stock and held sales',()=>{
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 const dashboard=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../supabase/migrations/20261015225000_pronto_branch_management.sql',import.meta.url),'utf8');
 assert.match(ui,/data-shop-form="branch_create"/);
 assert.match(ui,/data-shop-form="branch_rename"/);
 assert.match(dashboard,/data-branch-toggle/);
 for(const x of [/owner_required/,/last_branch_required/,/branch_has_open_cash/,/branch_has_stock/,/branch_has_held_sales/,/security definer/,/pronto_audit_events/])assert.match(sql,x);
});
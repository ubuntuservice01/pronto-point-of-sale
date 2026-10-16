import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSuspendedCash,renderSuspendedCash} from '../src/supabase-staff-cash-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const S='33333333-3333-4333-8333-333333333333';
const source={sessions:[{id:S,branch_id:B,branch_name:'Filial <Norte>',
 operator_id:U,operator_name:'Operador <script>abc</script>',
 opened_at:'2026-10-16T09:00:00Z',opening_cash_cents:10000,expected_cash_cents:7250}]};
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('Suspended cashier reconciliation requires amount, detailed reason and explicit owner confirmation',()=>{
 const snapshot=normalizeSuspendedCash(source);
 const html=renderSuspendedCash(snapshot);
 assert.equal(snapshot.sessions[0].expected,7250);
 assert.match(html,/data-shop-form="suspended_cash_close"/);
 assert.match(html,/name="counted_cash"/);
 assert.match(html,/name="confirmed"/);
 assert.match(html,/minlength="12"/);
 assert.match(html,/72,50 MT/);
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.throws(()=>normalizeSuspendedCash({sessions:{}}),/suspended_cash_snapshot_invalid/);
 for(const invalid of [null,'0',NaN,Infinity,1.2,-1,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>normalizeSuspendedCash({sessions:[{...source.sessions[0],opening_cash_cents:invalid}]}),/suspended_cash_snapshot_invalid/);
 }
 for(const invalid of [null,'0',NaN,Infinity,1.2,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>normalizeSuspendedCash({sessions:[{...source.sessions[0],expected_cash_cents:invalid}]}),/suspended_cash_snapshot_invalid/);
 }
 assert.throws(()=>normalizeSuspendedCash({sessions:[{...source.sessions[0],id:'invalid'}]}),/suspended_cash_snapshot_invalid/);
 assert.equal(normalizeSuspendedCash({sessions:[{...source.sessions[0],expected_cash_cents:-100}]}).sessions[0].expected,-100);
});
test('Suspended cash RPCs are session-gated, scoped and cannot be used as admin mutations',async()=>{
 const calls=[];
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('grant_type=password'))return response(200,{access_token:'bearer-token',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return response(200,{id:U,email:'owner@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return response(200,false);
  if(url.includes('pronto_memberships?'))return response(200,[{business_id:B,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return response(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_owner_suspended_cash_snapshot'))return response(200,source);
  if(url.endsWith('/rpc/pronto_owner_suspended_cash_close'))return response(200,{
   session_id:S,expected_cents:7250,counted_cents:7100,difference_cents:-150,duplicate:false
  });
  return response(404,{});
 }});
 await assert.rejects(()=>client.ownerSuspendedCash(B),/supabase_unauthorized/);
 await client.signIn('owner@example.org','password');
 const current=await client.ownerSuspendedCash(B);
 assert.equal(current.sessions[0].operatorId,U);
 await assert.rejects(()=>client.ownerCloseSuspendedCash({business_id:B,session_id:'bad'}),/cash_scope/);
 assert.equal((await client.ownerCloseSuspendedCash({business_id:B,session_id:S,
  counted_cash_cents:7100,reason:'Caixa após suspensão'})).difference_cents,-150);
 const call=calls.find(x=>x.url.endsWith('/rpc/pronto_owner_suspended_cash_close'));
 assert.equal(call.options.headers.Authorization,'Bearer bearer-token');
 assert.ok(!JSON.stringify(call).includes('service_role'));
});
test('SQL only recovers suspended worker cash; owner cannot change sale ledgers or erase data',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261016121000_pronto_suspended_cash_reconciliation.sql',import.meta.url),'utf8');
 for(const pattern of [/member_role\(v_business\).*?'owner'/s,/membership\.active=false/,
  /operator_not_suspended/,/for update/,/pronto_payment_allocations/,
  /pronto_debt_payments/,/pronto_cash_movements/,/staff_cash_emergency_closed/,
  /revoke all on function public\.pronto_owner_suspended_cash_close/,
  /emergency_closed_by/,/cash_session_unavailable/])assert.match(sql,pattern);
 assert.doesNotMatch(sql,/delete from public\.pronto_sales/);
 assert.doesNotMatch(sql,/truncate/);
 const merchant=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 assert.match(merchant,/suspended_cash_close/);
 assert.match(merchant,/ownerCloseSuspendedCash/);
});

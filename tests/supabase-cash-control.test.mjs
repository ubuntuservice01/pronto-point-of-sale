import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCashControl,renderCashManagement,ownOpenSession,cashSessionsCSV} from '../src/supabase-cash-ui.js';
import {makeSaleRequest} from '../src/supabase-shop-core.js';
const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const S='33333333-3333-4333-8333-333333333333';
const session={id:S,operator_id:U,branch_id:B,operator_name:'Caixa Ana',terminal:'CAIXA-01',
 opened_at:'2026-10-21T07:00:00Z',status:'pending',opening_cash_cents:200000,
 expected_cash_cents:null,counted_cash_cents:null,difference_cents:null,payments_by_method:null};
test('Blind counting: cashier cannot preview the expected drawer, yet owner can view it',()=>{
 const shop=normalizeCashControl({policy:{opening_required:true,blind_close:true},sessions:[session]});
 const html=renderCashManagement({cash:shop,role:'cashier',account:{userId:U}});
 assert.match(html,/Fecho cego/);assert.match(html,/Solicitar fecho|Confirmar contagem/);
 assert.doesNotMatch(html,/7\.000,00/);
 assert.equal(ownOpenSession(shop,U),null);
 const owner=normalizeCashControl({policy:{opening_required:true,blind_close:true},
  sessions:[{...session,expected_cash_cents:700000}]});
 const ownerHtml=renderCashManagement({cash:owner,role:'owner',account:{userId:'44444444-4444-4444-8444-444444444444'}});
 assert.match(ownerHtml,/Dinheiro esperado/);
 assert.match(ownerHtml,/data-shop-form="cash_remote"/);
});
test('Negative, positive, zero and unchecked closures have distinct financial labels',()=>{
 const base={...session,status:'closed',close_type:'blind',expected_cash_cents:700000,
 counted_cash_cents:685000,difference_cents:-15000};
 const variants=[base,{...base,id:'44444444-4444-4444-8444-444444444444',difference_cents:15000,counted_cash_cents:715000},
  {...base,id:'55555555-5555-4555-8555-555555555555',difference_cents:0,counted_cash_cents:700000},
  {...base,id:'66666666-6666-4666-8666-666666666666',difference_cents:null,
    counted_cash_cents:null,close_type:'administrative_unchecked'}];
 const snapshot=normalizeCashControl({policy:{opening_required:true,blind_close:true},sessions:variants});
 const html=renderCashManagement({cash:snapshot,role:'cashier',account:{userId:U}});
 for(const label of ['FALTA de','SOBRA de','Caixa certo','Fecho administrativo sem conferência física'])assert.match(html,new RegExp(label));
 const csv=cashSessionsCSV(snapshot);
 assert.match(csv,/Fecho administrativo/);
 assert.match(csv,/150/);
});
test('An optional branch can record a sale without attributing it to a nonexistent drawer',()=>{
 const product={id:'77777777-7777-4777-8777-777777777777',name:'Arroz',priceCents:7000,stock:5,unit:'un'};
 const request=makeSaleRequest({businessId:B,branchId:B,sessionId:null,
  cart:[{productId:product.id,quantity:1}],products:[product],
  allocations:[{method:'cash',amount:'70'}],cashReceived:'70',idempotencyKey:S});
 assert.equal(request.session_id,null);
 assert.equal(request.allocations[0].amount_cents,7000);
});
test('SQL transactions protect tenant scope, optional sales, blind close, blocked sessions and audit',()=>{
 const policy=readFileSync(new URL('../supabase/migrations/20261021111500_cash_control_v2.sql',import.meta.url),'utf8');
 const legacy=readFileSync(new URL('../supabase/migrations/20261021113000_cash_legacy_integration.sql',import.meta.url),'utf8');
 for(const key of [/pronto_cash_policies/,/opening_required/,/blind_close/,/close_requested_at/,
  /blocked_at/,/for update/,/cash_totals/,/administrative_unchecked/,/expected_at_close_cents/,
  /cash\\.'\\|\\|p_action/,/pronto_cash_control/,/pronto_cash_difference_notes/]){
  if(!key.test(policy))throw Error('Missing cash protection '+String(key));
 }
 assert.match(legacy,/cash_open_required/);
 assert.match(legacy,/close_requested_at is null/);
 assert.match(legacy,/cash_session_unavailable/);
});

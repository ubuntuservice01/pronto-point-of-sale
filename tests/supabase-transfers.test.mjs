import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeTransferSnapshot,renderTransfersView,transferFormRows} from '../src/supabase-transfers-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';

const B='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const P='44444444-4444-4444-8444-444444444444';
const U='55555555-5555-4555-8555-555555555555';
const T='66666666-6666-4666-8666-666666666666';
const branches=[{id:A,name:'Filial Centro',active:true},{id:C,name:'Filial Bairro',active:true}];
const raw={transfers:[{
 id:T,source_branch_id:A,target_branch_id:C,status:'in_transit',
 reason:'Transferir <script>alert(1)</script>',created_at:'2026-10-15T18:00:00Z',
 lines:[{product_id:P,product_name:'Arroz <premium>',product_code:'ARZ-01',quantity:4,lot_number:'L-1'}]
}]};
const product={id:P,name:'Arroz <premium>',code:'ARZ-01',unit:'kg',stock:15};

test('Transfer model validates server data and maps a reserved in-transit movement',()=>{
 const value=normalizeTransferSnapshot(raw);
 assert.equal(value.transfers.length,1);
 assert.equal(value.transfers[0].lines[0].quantity,4);
 assert.equal(value.transfers[0].status,'in_transit');
 assert.throws(()=>normalizeTransferSnapshot({transfers:{}}),/transfer_snapshot_invalid/);
});
test('Owner dispatch screen supports multi-line quantity and escaped text',()=>{
 const snapshot=normalizeTransferSnapshot(raw);
 const html=renderTransfersView({snapshot,branches,branchId:A,products:[product],role:'owner',lineCount:3});
 assert.equal((html.match(/class="finance-purchase-line"/g)||[]).length,3);
 assert.match(html,/data-shop-form="transfer_send"/);
 assert.match(html,/data-transfer-cancel/);
 assert.ok(!html.includes('data-transfer-receive'));
 assert.match(html,/Arroz &lt;premium&gt;/);
 assert.ok(!html.includes('<script>'));
 assert.match(html,/Artigos em trânsito não estão disponíveis para venda/i);
 assert.match(transferFormRows([product],50),/Artigo 10/);
 assert.ok(!transferFormRows([product],50).includes('Artigo 11'));
});
test('Receiving branch sees receipt and financial operator can only read',()=>{
 const snapshot=normalizeTransferSnapshot(raw);
 const receiving=renderTransfersView({snapshot,branches,branchId:C,products:[product],role:'stock'});
 assert.match(receiving,/data-transfer-receive/);
 assert.ok(!receiving.includes('data-transfer-cancel'));
 const finance=renderTransfersView({snapshot,branches,branchId:C,products:[product],role:'finance'});
 assert.ok(!finance.includes('data-shop-form="transfer_send"'));
 assert.ok(!finance.includes('data-transfer-receive'));
});
test('Authenticated transfer RPC requires session and rejects unsupported actions',async()=>{
 const requests=[];
 const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async(url,options)=>{
  requests.push({url,options});
  if(url.includes('grant_type=password'))return response(200,{access_token:'jwt-test',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return response(200,{id:U,email:'stock@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(200,false);
  if(url.includes('pronto_memberships?'))return response(200,[{business_id:B,role:'stock',active:true}]);
  if(url.includes('pronto_businesses?'))return response(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_transfer_snapshot'))return response(200,raw);
  if(url.endsWith('/rpc/pronto_transfer_action'))return response(200,{transfer_id:T,status:'in_transit'});
  return response(404,{});
 }});
 await assert.rejects(()=>client.transferSnapshot(B),/supabase_unauthorized/);
 await client.signIn('stock@example.org','password');
 assert.equal((await client.transferSnapshot(B)).transfers.length,1);
 const a=await client.transferAction('send',{business_id:B,source_branch_id:A,target_branch_id:C,
  idempotency_key:T,items:[{product_id:P,quantity:2}],reason:'Stock para filial'});
 assert.equal(a.status,'in_transit');
 const request=requests.find(r=>r.url.endsWith('/rpc/pronto_transfer_action'));
 assert.equal(request.options.headers.Authorization,'Bearer jwt-test');
 assert.equal(JSON.parse(request.options.body).p_action,'send');
 await assert.rejects(()=>client.transferAction('delete_all',{business_id:B}),/transfer_action_invalid/);
 await assert.rejects(()=>client.transferSnapshot('invalid'),/shop_scope/);
});
test('SQL prevents cross-company access, partial dispatches, duplicate stock movements and unsafe branch closure',()=>{
 const transfer=readFileSync(new URL('../supabase/migrations/20261015230000_pronto_stock_transfers.sql',import.meta.url),'utf8');
 const guard=readFileSync(new URL('../supabase/migrations/20261015230500_pronto_branch_pending_transfer_guard.sql',import.meta.url),'utf8');
 const dashboard=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 for(const pattern of [/security definer/,/member_role/,/pg_advisory_xact_lock/,/idempotency_conflict/,
  /for update/,/pronto_stock_transfer_lines/,/stock=stock-v_quantity/,/stock=stock\+v_line.quantity/,
  /pronto_stock_movements/,/returning id into v_new_batch/,/transfer_insufficient_valid_stock/,
  /source_branch_id<>target_branch_id/,/transfer_already_finalised/])assert.match(transfer,pattern);
 assert.match(guard,/branch_has_pending_transfers/);
 assert.match(dashboard,/data-transfer-receive/);
 assert.match(dashboard,/pendingTransfer/);
 assert.match(ui,/Transferências/);
});

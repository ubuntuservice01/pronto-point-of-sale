import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderReturnView} from '../src/supabase-returns-ui.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const SALE='11111111-1111-4111-8111-111111111111';
const PROD='22222222-2222-4222-8222-222222222222';
const returns={sales:[{id:SALE,status:'completed',total:12000,method:'mpesa',date:'2026-10-27T09:00:00Z',
 items:[{productId:PROD,name:'Medicamento <RX>',unit:'un',qty:3,returned:0,price:4000}]}],returns:[]};

test('Pharmacy returns cannot be marked resellable from the UI',()=>{
 const html=renderReturnView({returns,selectedSaleId:SALE,businessType:'pharmacy'});
 assert.match(html,/Medicamento devolvido/);
 assert.doesNotMatch(html,/name="resellable_0"/);
 assert.doesNotMatch(html,/name="expiry_0"/);
 assert.match(html,/Medicamento &lt;RX&gt;/);
 const shop=renderReturnView({returns,selectedSaleId:SALE,businessType:'grocery'});
 assert.match(shop,/name="resellable_0"/);
 assert.match(shop,/name="expiry_0"/);
});
test('Return safety instructions apply only to pharmacy businesses',()=>{
 const business='33333333-3333-4333-8333-333333333333';
 const args={account:{userId:SALE,email:'operator@example.test'},grants:[],branches:[{id:PROD,name:'Filial'}],
  branchId:PROD,data:{products:[],sales:[],sessions:[]},cart:[],method:'cash',
  discount:'0',query:'',view:'returns',selectedReturnSaleId:SALE,returns};
 const grant={id:business,name:'Farmácia',role:'owner',businessType:'pharmacy'};
 const html=renderShopScreen({...args,grant,grants:[grant]});
 assert.doesNotMatch(html,/name="resellable_0"/);
 assert.match(html,/não retorna automaticamente ao stock/);
 const other=renderShopScreen({...args,grant:{...grant,businessType:'grocery'}});
 assert.match(other,/name="resellable_0"/);
});
test('Server guards catch returns and transfers recalled during transit',()=>{
 const sql=read('supabase/migrations/20261027103000_pharmacy_pilot_return_transfer_hardening.sql');
 for(const marker of ['pharmacy_return_restock_requires_quarantine',
  'pharmacy_transfer_quarantined_during_transit','pharmacy_batch_on_hold',
  'pharmacy_lot_recalled_receipt_blocked',
  'held_p.code=source_p.code','held_p.code=next_p.code',
  'held_p.code=sale_p.code','h.active','pronto_private.return_action',
  'pronto_private.transfer_action','pronto_private.guard_pharmacy_stock_movement'])
  assert.ok(sql.includes(marker),marker);
 assert.match(sql,/business_type='pharmacy'/);
 assert.match(read('public/sw.js'),/pronto-pos-v90/);
});
test('Pilot SQL suite guarantees transaction rollback and rejection cases',()=>{
 const qa=read('tests/sql/pharmacy-pilot-transaction.sql');
 assert.match(qa,/^begin;/m);
 assert.match(qa,/^rollback;/m);
 assert.match(qa,/unexpected_pilot_/);
 assert.match(qa,/pharmacy_return_restock_requires_quarantine/);
 assert.match(qa,/pharmacy_transfer_quarantined_during_transit/);
});

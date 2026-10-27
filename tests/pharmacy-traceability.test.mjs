import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderPharmacyTrace,pharmacyTraceCSV} from '../src/pharmacy-trace-ui.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const BUS='11111111-1111-4111-8111-111111111111';
const BR='22222222-2222-4222-8222-222222222222';
const BATCH='33333333-3333-4333-8333-333333333333';
const snapshot={today:'2026-10-27',from:'2026-10-01',to:'2026-10-27',
 totals:{sale_movements:2,sale_quantity:3,rx_dispensed:1,held_batches:1,expired_batches:0},
 lots:[
 {batch_id:BATCH,product_name:'Med <script>',product_code:'RX-01',lot_number:'A-99',
  expires_on:'2027-01-30',qty:5,held:true,hold_reason:'Suspeita de qualidade'},
 {batch_id:BR,product_name:'Med 2',product_code:'RX-02',lot_number:'B-12',
  expires_on:'2026-11-25',qty:8,held:false},
 {batch_id:BUS,product_name:'Sem validade',product_code:'X-02',lot_number:'X',
  expires_on:null,qty:1,held:false}
 ],
 dispensations:[{date:'2026-10-27T08:30:00Z',sale_id:BUS,product_name:'<script>',
 lot_number:'A-99',expires_on:'2027-01-30',quantity:2,requires_prescription:true,
 approved_by:BR}]
};
test('Pharmacy trace screen shows server totals and masked operational data only',()=>{
 const html=renderPharmacyTrace(snapshot,{from:'2026-10-01',to:'2026-10-27',role:'owner'});
 assert.match(html,/Rastreabilidade farmacêutica/);
 assert.match(html,/Med &lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/Suspeita de qualidade/);
 assert.match(html,/data-shop-form="pharmacy_lot_action"/);
 assert.match(html,/value="release"/);
 assert.match(html,/value="hold"/);
 assert.match(html,/data-pharmacy-trace-csv/);
 assert.match(html,/Rec[eê]ita validada/);
 assert.doesNotMatch(html,/prescription_reference/);
});
test('Stock and finance users may view history but cannot lift a held lot',()=>{
 for(const role of ['finance','stock']){
  const html=renderPharmacyTrace(snapshot,{role});
  assert.doesNotMatch(html,/data-shop-form="pharmacy_lot_action"/);
  assert.match(html,/data-pharmacy-trace-csv/);
 }
 const empty=renderPharmacyTrace({...snapshot,lots:[],dispensations:[]},{role:'owner'});
 assert.match(empty,/Sem lotes com stock/);
});
test('CSV is semicolon-safe, escaped and does not contain prescription documents',()=>{
 const csv=pharmacyTraceCSV({...snapshot,dispensations:[
  {...snapshot.dispensations[0],product_name:'=2+2',lot_number:'"LOT";X'}
 ]});
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/'=2\+2/);
 assert.match(csv, /""LOT"";X/);
 assert.match(csv,/Receita validada/);
 assert.doesNotMatch(csv,/prescription_reference/);
 assert.throws(()=>pharmacyTraceCSV(null));
});
test('Traceability route is only visible for authorised pharmacy members',()=>{
 const base={account:{userId:BUS,email:'seller@test.example'},branches:[{id:BR,name:'Sede'}],branchId:BR,
 data:{products:[],sales:[],sessions:[]},cart:[],view:'trace',method:'cash',discount:'0',query:''};
 const grant={id:BUS,name:'Farmácia',role:'manager',businessType:'pharmacy'};
 const html=renderShopScreen({...base,grant,grants:[grant],pharmacyTrace:snapshot});
 assert.match(html,/data-shop-view="trace"/);
 assert.match(html,/Control[oê] de lotes/);
 const store=renderShopScreen({...base,grant:{...grant,businessType:'grocery'},grants:[{...grant,businessType:'grocery'}]});
 assert.doesNotMatch(store,/data-shop-view="trace"/);
 const cashier=renderShopScreen({...base,grant:{...grant,role:'cashier'},grants:[{...grant,role:'cashier'}]});
 assert.doesNotMatch(cashier,/data-shop-view="trace"/);
});
test('SQL enforces tenant and active hold checks before sale, receipt and transfer',()=>{
 const sql=read('supabase/migrations/20261027090000_pharmacy_traceability_lot_holds.sql');
 for(const token of ['enable row level security','revoke all on public.pronto_pharmacy_lot_holds',
  'pronto_pharmacy_held_transfer_guard','pharmacy_lot_on_hold_transfer',
  'pharmacy_lot_recalled_receipt_blocked','pharmacy_batch_on_hold',
  'not exists (select 1 from public.pronto_pharmacy_lot_holds h',
  'pronto_private.member_role(v_business)','pharmacy.lot_',
  'pronto_pharmacy_trace_snapshot','p_to-p_from>366','v_role not in',
  "p.branch_id=p_branch",'limit 150','limit 200']){
  assert.ok(sql.includes(token),token);
 }
 const dash=read('src/supabase-shop-dashboard.js');
 assert.match(dash,/await client.pharmacyLotAction/);
 assert.match(dash,/pharmacyTraceCSV\(pharmacyTrace\)/);
 assert.match(dash,/client.pharmacyTraceSnapshot/);
 assert.match(read('public/sw.js'),/\/src\/pharmacy-trace-ui\.js/);
});

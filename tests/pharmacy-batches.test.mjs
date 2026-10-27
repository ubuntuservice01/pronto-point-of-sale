import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {maputoToday,validatePharmacyReceipt,pharmacyExpiryBuckets} from '../src/pharmacy-batches.js';
import {renderInventoryView,inventoryNotificationSummary} from '../src/supabase-inventory-ui.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';
const now='2026-10-27';
const days=n=>new Date(Date.parse(now+'T00:00:00Z')+86400000*n).toISOString().slice(0,10);
const base={today:now,products:[{id,name:'Medicamento <Comprimidos>',code:'AA',stock:9,minStock:0,active:true,unit:'un',revision:0,priceCents:3000,category:'Medicamentos'}],
 batches:[{id:'a',productId:id,lot:'L-30',expiry:days(30),qty:1},
  {id:'b',productId:id,lot:'L-60',expiry:days(60),qty:1},
  {id:'c',productId:id,lot:'L-90',expiry:days(90),qty:1},
  {id:'d',productId:id,lot:'L-91',expiry:days(91),qty:1},
  {id:'e',productId:id,lot:'L-0',expiry:days(0),qty:1},
  {id:'f',productId:id,lot:'L-old',expiry:days(-1),qty:1},
  {id:'g',productId:id,lot:'',expiry:null,qty:1},
  {id:'h',productId:id,lot:'0',expiry:days(12),qty:0}],
 movements:[],suggestions:[]};
test('Maputo calendar moves to next day at 22:00 UTC, independently of browser location',()=>{
 assert.equal(maputoToday(new Date('2026-10-27T21:59:59Z')),'2026-10-27');
 assert.equal(maputoToday(new Date('2026-10-27T22:00:00Z')),'2026-10-28');
});
test('Pharmacy receipts require an authentic nonempty lot and valid future expiry',()=>{
 assert.deepEqual(validatePharmacyReceipt({lot:' AB-004 ',expiry:'2026-11-03',today:now}),{lot:'AB-004',expiry:'2026-11-03'});
 for(const x of [{lot:'',expiry:'2026-11-03'},{lot:'A',expiry:''},{lot:'A',expiry:now},
  {lot:'A',expiry:'2026-02-30'},{lot:'A',expiry:'2020-01-01'}, {lot:'A',expiry:'2030-13-01'}]){
  assert.throws(()=>validatePharmacyReceipt({...x,today:now}));
 }
});
test('Pharmacy alert bands count days 1-30, 31-60 and 61-90 once each; today is expired',()=>{
 const x=pharmacyExpiryBuckets(base);
 assert.deepEqual([x.expired.length,x.days30.length,x.days60.length,x.days90.length,x.undated.length],[2,1,1,1,1]);
 assert.deepEqual(x.days30.map(b=>b.lot),['L-30']);
 assert.deepEqual(x.days60.map(b=>b.lot),['L-60']);
 assert.deepEqual(x.days90.map(b=>b.lot),['L-90']);
 const notice=inventoryNotificationSummary(base,90,'pharmacy');
 assert.equal(notice.expired,2);assert.equal(notice.expiring,3);
 assert.equal(inventoryNotificationSummary(base,30).expiring,2); // legacy retail rules preserved
});
test('Pharmacy alerts show all risk bands, escaped names and do not allow stock-count increases',()=>{
 const opts={view:'alerts',inventory:base,role:'owner',businessType:'pharmacy'};
 const alert=renderInventoryView(opts);
 for(const phrase of ['próximos 30 dias','31 e 60 dias','61 e 90 dias','sem validade','L-30','L-60','L-90'])
  assert.ok(alert.toLowerCase().includes(phrase.toLowerCase()),phrase);
 assert.match(alert,/&lt;Comprimidos&gt;/);
 assert.doesNotMatch(alert,/<Comprimidos>/);
 const inventory=renderInventoryView({...opts,view:'inventory',selectedProductId:id});
 assert.doesNotMatch(inventory,/data-shop-form="inventory_count"/);
 assert.match(inventory,/data-shop-form="inventory_adjust"/);
 assert.match(inventory,/max="-0.001"/);
 const regular=renderInventoryView({...opts,businessType:'general',view:'inventory',selectedProductId:id});
 assert.match(regular,/data-shop-form="inventory_count"/);
});
test('Merchant pharmacy receipt has required lot/date but standard shop remains optional',()=>{
 const account={userId:id,email:'shop@example.test'};
 const branch='22222222-2222-4222-8222-222222222222';
 const grant={id:'33333333-3333-4333-8333-333333333333',name:'Farmácia',role:'owner',businessType:'pharmacy'};
 const settings={account,grants:[grant],grant,branches:[{id:branch,name:'Principal'}],branchId:branch,
  data:{products:[],sales:[],sessions:[]},cart:[],view:'products',method:'cash',discount:'0',query:'',pending:null};
 const html=renderShopScreen(settings);
 assert.match(html,/Número do lote \(obrigatório\)/);
 assert.match(html,/Data de validade \(obrigatória\)/);
 assert.doesNotMatch(html,/data-shop-form="csv_import"/);
 const generic=renderShopScreen({...settings,grant:{...grant,businessType:'general'}});
 assert.match(generic,/data-shop-form="csv_import"/);
 assert.match(generic,/Número do lote \(opcional\)/);
});
test('Database rejects missing lots, expired receipts, untracked dispensing and positive count adjustments',()=>{
 const sql=read('supabase/migrations/20261027073000_pharmacy_batch_expiry_guards.sql');
 for(const s of ['pronto_pharmacy_batch_guard','pharmacy_lot_expiry_required',
  'pharmacy_expired_receipt_forbidden','pharmacy_batch_expiry_conflict',
  'pharmacy_sale_requires_valid_batch','pharmacy_receive_stock_via_lot_only',
  'pharmacy_prescription_validation_pending','pronto_pharmacy_transfer_medicine',
  "at time zone 'Africa/Maputo'","business_type='pharmacy'"]){
  assert.ok(sql.includes(s),s);
 }
 assert.match(read('public/sw.js'),/\/src\/pharmacy-batches\.js/);
});

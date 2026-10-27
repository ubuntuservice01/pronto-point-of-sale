import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rxItems,renderPharmacyReviews} from '../src/pharmacy-review-ui.js';
import {renderProvisioningForms} from '../src/supabase-admin-forms.js';
import {prepareAdminProvisioning} from '../src/supabase-admin-dashboard.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
import {normalizeMerchantSnapshot} from '../src/supabase-shop-core.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ID='11111111-1111-4111-8111-111111111111';
const BUS='22222222-2222-4222-8222-222222222222';
test('Prescription items are identified in the commercial checkout without altering other products',()=>{
 const a={id:'a',requiresPrescription:true},b={id:'b',requiresPrescription:false};
 assert.deepEqual(rxItems([{productId:'a',quantity:2},{productId:'b',quantity:3}],[a,b]),[{productId:'a',quantity:2}]);
 const raw={business_id:BUS,branch_id:ID,role:'cashier',products:[{
  id:'a',name:'Medicamento',code:'A',unit:'un',price_cents:2000,stock:4,
  min_stock:0,requires_prescription:true
 }],branches:[],cash_sessions:[],recent_sales:[]};
 assert.equal(normalizeMerchantSnapshot(raw).products[0].requiresPrescription,true);
});
test('Professional approval queue escapes untrusted text and only verified accounts receive approval control',()=>{
 const pending={requests:[{sale_key:ID,product_id:BUS,name:'Med <script>',quantity:1,
  approved:false,expires_at:'2026-10-27T08:00:00Z'}],can_approve:false};
 const html=renderPharmacyReviews(pending);
 assert.match(html,/Med &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(html,/data-shop-form="pharmacy_approve"/);
 const approved=renderPharmacyReviews({...pending,can_approve:true});
 assert.match(approved,/data-shop-form="pharmacy_approve"/);
 assert.match(approved,/name="prescription_reference"/);
 assert.match(approved,/name="checked" required/);
});
test('Merchant pharmacy menu is scoped and pending sale keeps its validation reference',()=>{
 const grant={id:BUS,name:'Farmácia',role:'cashier',businessType:'pharmacy'};
 const settings={grant,grants:[grant],account:{userId:ID,email:'user@pharmacy.test'},branches:[{id:ID,name:'Principal'}],
  branchId:ID,data:{products:[],sales:[],sessions:[]},cart:[],view:'sell',method:'cash',discount:'0',
  query:'',pending:{idempotency_key:ID,items:[]}};
 const html=renderShopScreen(settings);
 assert.match(html,/data-shop-view="pharmacy"/);assert.match(html,/Referência da venda/);
 assert.match(html,new RegExp(ID));
 assert.doesNotMatch(renderShopScreen({...settings,grant:{...grant,businessType:'grocery'}}),/data-shop-view="pharmacy"/);
});
test('Super admin provides an explicit manual professional verification form',()=>{
 const html=renderProvisioningForms('members',{businesses:[{id:BUS,name:'Farmácia',members:[]}],plans:[]});
 assert.match(html,/data-provision-action="pharmacy_professional_set"/);
 assert.match(html,/verificar externamente/);
 const fields=new Map([['business_id',BUS],['user_id',ID],['license_reference','PRO-1234'],
  ['valid_until','2027-10-27'],['active','true']]);
 const out=prepareAdminProvisioning({dataset:{provisionAction:'pharmacy_professional_set'}},
  class{constructor(){return {get:key=>fields.get(key)}}});
 assert.deepEqual(out,{action:'pharmacy_professional_set',data:{business_id:BUS,user_id:ID,
  license_reference:'PRO-1234',valid_until:'2027-10-27',active:true}});
});
test('Server requires independently verified professional, exact sale key/quantity and records dispensing batches',()=>{
 const sql=read('supabase/migrations/20261027080000_pharmacy_professional_prescription_reviews.sql');
 for(const marker of ["not pronto_private.is_ubuntu_super_admin()", "pronto_private.pharmacy_verified",
  "v_review.quantity is distinct from v_qty", "v_review.requested_by<>v_sale.seller_id",
  "v_review.used_sale_id<>v_sale.id", "not pronto_private.pharmacy_verified(new.business_id,v_review.approved_by)",
  "pronto_pharmacy_record_dispensation","pharmacy_sale_requires_valid_batch",
  "pronto_pharmacy_dispensations","revoke all on public.pronto_pharmacy_sale_reviews from anon,authenticated",
  "revoke all on public.pronto_pharmacy_dispensations from anon,authenticated"])assert.ok(sql.includes(marker),marker);
 const dashboard=read('src/supabase-shop-dashboard.js');
 assert.match(dashboard,/await client.pharmacyAction\('request'/);
 assert.match(dashboard,/await client.pharmacyAction\('approve'/);
 assert.match(dashboard,/sale_key:pending.idempotency_key/);
 assert.match(dashboard,/if\(rx.length\)/);
 assert.match(dashboard,/pharmacy_credit_not_enabled/);
 const identity=read('src/supabase-identity.js');
 assert.match(identity,/rpc\/pronto_pharmacy_snapshot/);
 assert.match(identity,/rpc\/pronto_pharmacy_action/);
 assert.match(read('public/sw.js'),/\/src\/pharmacy-review-ui\.js/);
});

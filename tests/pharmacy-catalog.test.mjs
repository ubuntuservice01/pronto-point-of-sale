import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readMedicineFields,renderMedicineFields,businessTypeLabel} from '../src/pharmacy.js';
import {renderProvisioningForms} from '../src/supabase-admin-forms.js';
import {renderInventoryView} from '../src/supabase-inventory-ui.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Medicine form checks required information and escapes untrusted data',()=>{
 const html=renderMedicineFields({active_ingredient:'<script>',strength:'500 mg',requires_prescription:true});
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/name="requires_prescription" checked/);
 const fd=new FormData();
 for(const [k,v] of Object.entries({active_ingredient:'Paracetamol',strength:'500 mg',dosage_form:'Comprimido',presentation:'Caixa 20',manufacturer:'Laboratório'}))fd.set(k,v);
 fd.set('requires_prescription','on');
 assert.deepEqual(readMedicineFields(fd),{active_ingredient:'Paracetamol',strength:'500 mg',dosage_form:'Comprimido',presentation:'Caixa 20',manufacturer:'Laboratório',requires_prescription:true});
 fd.delete('active_ingredient');assert.throws(()=>readMedicineFields(fd),/active_ingredient/);
 assert.equal(businessTypeLabel('pharmacy'),'Farmácia');
});
test('Admin registration offers a real pharmacy type',()=>{
 assert.match(renderProvisioningForms('businesses',{businesses:[],plans:[]}),/value="pharmacy">Farmácia/);
 assert.match(read('src/supabase-admin-dashboard.js'),/business_type:value\('business_type'\)/);
 assert.match(read('src/supabase-identity.js'),/select=id,name,status,business_type/);
});
test('Medicine editor appears only for pharmacy owner or manager',()=>{
 const product={id:'a',name:'Comprimidos',code:'C1',category:'Medicamentos',unit:'un',priceCents:100,stock:0,minStock:0,revision:0,active:false};
 const inventory={products:[product],batches:[],movements:[],suggestions:[],today:'2026-10-27'};
 const options={view:'inventory',inventory,selectedProductId:'a',role:'owner'};
 assert.match(renderInventoryView({...options,businessType:'pharmacy'}),/data-shop-form="medicine_upsert"/);
 assert.doesNotMatch(renderInventoryView({...options,businessType:'general'}),/data-shop-form="medicine_upsert"/);
 assert.doesNotMatch(renderInventoryView({...options,businessType:'pharmacy',role:'stock'}),/data-shop-form="medicine_upsert"/);
});
test('Pharmacy details enforce isolation through tenant constraints and server validation',()=>{
 const sql=read('supabase/migrations/20261027065226_pharmacy_medicine_details.sql');
 for(const marker of ['foreign key (business_id,product_id)','enable row level security','for select to authenticated',
  'member_role(business_id)','business_type', "not in ('owner','manager')",
  'medicine_details_saved','pronto_medicine_upsert','revoke all on public.pronto_medicine_details from anon,authenticated'])
  assert.ok(sql.includes(marker),marker);
 const identity=read('src/supabase-identity.js');
 assert.match(identity,/medicine_details_pending/);
 assert.match(identity,/await medicineUpsert/);
 assert.match(identity,/await uploadProductPhoto/);
 assert.ok(identity.indexOf('await medicineUpsert')<identity.indexOf('await uploadProductPhoto'));
 assert.match(read('public/sw.js'),/\/src\/pharmacy\.js/);
});

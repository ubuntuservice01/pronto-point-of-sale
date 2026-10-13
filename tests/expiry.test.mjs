import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExpiryDate,expiryInfo,formatExpiryDate} from '../src/expiry.js';
import {addProduct,seed} from '../src/model.js';
import {editInventoryProduct} from '../src/inventory.js';
import {createStore} from '../server/store.mjs';
import {catalogPage} from '../src/management-ui.js';

const item=(expiryDate)=>({name:'Bolachas',category:'Alimentação',code:'bolachas-1',unit:'un',price:2500,stock:20,min:3,expiryDate});
test('Product creation stores optional expiry and accepts empty values for hardware',()=>{
 const withExpiry=addProduct(seed(),'t1',item('2027-12-31')).products.at(-1);
 const withoutExpiry=addProduct(seed(),'t2',{...item(),code:'hardware-1'}).products.at(-1);
 assert.equal(withExpiry.expiryDate,'2027-12-31');
 assert.equal(withoutExpiry.expiryDate,'');
});
test('Date validation rejects impossible dates and non-standard formats',()=>{
 for(const invalid of ['2026-02-30','2026-13-01','2026-2-5','2025-02-29','0000-01-01','31/12/2027','2027-01-01T00:00:00Z',44]){
  assert.throws(()=>normalizeExpiryDate(invalid),/expiry_date/);
  assert.throws(()=>addProduct(seed(),'t1',item(invalid)),/expiry_date/);
 }
 assert.equal(normalizeExpiryDate('2028-02-29'),'2028-02-29');
});
test('Expiry warnings respect Mozambique local date',()=>{
 const now=new Date('2026-10-13T22:30:00Z');
 assert.equal(expiryInfo('2026-10-13',now).status,'expired');
 assert.equal(expiryInfo('2026-10-14',now).status,'today');
 assert.equal(expiryInfo('2026-10-24',now).status,'soon');
 assert.equal(expiryInfo('2026-12-01',now).status,'valid');
 assert.equal(expiryInfo('',now).status,'none');
 assert.ok(formatExpiryDate('2026-10-14','pt').includes('2026'));
});
test('Editing expiry can correct or clear a date, retaining audit and tenant isolation',()=>{
 const s=addProduct(seed(),'t1',item('2026-10-14'));
 const p=s.products.at(-1);
 const fields={id:'update-expiry-1',productId:p.id,expectedRevision:0,name:p.name,category:p.category,code:p.code,price:p.price,min:p.min,reason:'Actualizar validade',expiryDate:'2026-11-05'};
 const updated=editInventoryProduct(s,'t1',fields,'operator');
 assert.equal(updated.products.at(-1).expiryDate,'2026-11-05');
 assert.equal(updated.inventoryEvents[0].after.expiryDate,'2026-11-05');
 assert.strictEqual(editInventoryProduct(updated,'t1',fields,'operator'),updated);
 const cleared=editInventoryProduct(updated,'t1',{...fields,id:'update-expiry-2',expectedRevision:1,expiryDate:''},'operator');
 assert.equal(cleared.products.at(-1).expiryDate,'');
 assert.throws(()=>editInventoryProduct(updated,'t2',{...fields,id:'cross-tenant'},'operator'),/product_not_found/);
 assert.throws(()=>editInventoryProduct(updated,'t1',{...fields,id:'invalid',expectedRevision:1,expiryDate:'2026-02-30'},'operator'),/expiry_date/);
});
test('Node/SQLite persists expiry dates on creation and editing',()=>{
 const store=createStore(':memory:',{bootstrapUser:'expiry-root',bootstrapPassword:'VeryStrongBootstrap2026!',secure:false});
 try{
  const root=store.session(store.login('expiry-root','VeryStrongBootstrap2026!','desktop').token);
  const start=store.createBusiness(root,{name:'Mercado',type:'Mercearia',owner:'Proprietário'});
  const login=store.login(start.onboarding.username,start.onboarding.temporaryPassword,'owner-phone');
  store.changePassword(store.session(login.token),start.onboarding.temporaryPassword,'NewStrongOwnerPassword2026!',login.token);
  const owner=store.session(login.token),tenantId=owner.business_id;
  const creation=store.product(owner,{tenantId,...item('2026-12-31')});
  const p=creation.products.at(-1);
  assert.equal(p.expiryDate,'2026-12-31');
  assert.equal(store.snapshot(owner).products.at(-1).expiryDate,'2026-12-31');
  const edited=store.productEdit(owner,{id:'date-edit-test',productId:p.id,expectedRevision:0,name:p.name,category:p.category,code:p.code,price:p.price,min:p.min,expiryDate:'2027-06-30',reason:'Nova validade'});
  assert.equal(edited.products.at(-1).expiryDate,'2027-06-30');
  assert.throws(()=>store.product(owner,{tenantId,...item('2026-02-30'),code:'invalid-expiry'}),e=>e.status===400);
 }finally{store.close();}
});
test('Catalogue shows expiry badges and an edit action',()=>{
 const state=addProduct(seed(),'t1',item('2025-01-01'));
 const html=catalogPage({items:state.products.filter(p=>p.tenantId==='t1'),state,tenantId:'t1',lang:'pt',money:x=>x+'MT',remote:false});
 assert.match(html,/Vencido/);
 assert.match(html,/2025/);
 assert.match(html,/data-product-edit/);
});

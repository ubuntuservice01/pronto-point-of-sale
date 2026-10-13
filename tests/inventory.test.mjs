import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale} from '../src/model.js';
import {editInventoryProduct,setInventoryStatus,recordInventoryMovement} from '../src/inventory.js';
import {inventoryHistoryHTML} from '../src/inventory-ui.js';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/http.mjs';

const product=()=>({id:'x',tenantId:'t1',name:'Arroz',category:'Alimentação',code:'10001',price:8500,unit:'kg',stock:10,min:2});
const state=()=>({...seed(),products:[product(),{...product(),id:'y',tenantId:'t2'}]});
const change=(id='edit-1')=>({id,productId:'x',expectedRevision:0,reason:'Actualizar preço',name:'Arroz premium',category:'Alimentação',code:'NEW',price:9500,min:3});

test('Product edition preserves stock and past sales, records operator and is idempotent',()=>{
 let s=state();s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'x',quantity:1}],id:'sale-1',method:'cash',received:8500});
 const original=s.sales[0].lines[0];
 s=editInventoryProduct(s,'t1',change(),'operator-id');
 assert.equal(s.products[0].price,9500);assert.equal(s.products[0].stock,9);
 assert.equal(s.products[0].revision,1);assert.equal(s.sales[0].lines[0].price,original.price);
 assert.equal(s.inventoryEvents[0].actorId,'operator-id');
 assert.equal(s.inventoryEvents[0].reason,'Actualizar preço');
 assert.strictEqual(editInventoryProduct(s,'t1',change(),'operator-id'),s);
 assert.throws(()=>editInventoryProduct(s,'t1',change('new-edit'),'operator-id'),/revision_conflict/);
});

test('Barcode uniqueness applies inside the business, never across unrelated stores',()=>{
 let s=state();s.products[1].code='B';
 assert.throws(()=>editInventoryProduct(s,'t1',{...change(),code:'10001'},'operator-id'),/no_change|barcode_in_use|invalid_product/); // same product is allowed only when data differs
 s.products.push({...product(),id:'z',code:'OTHER'});
 assert.throws(()=>editInventoryProduct(s,'t1',{...change(),code:'OTHER'},'operator-id'),/barcode_in_use/);
 s=editInventoryProduct(s,'t1',{...change(),code:'B'},'operator-id');
 assert.equal(s.products.find(p=>p.id==='x').code,'B');assert.equal(s.products.find(p=>p.id==='y').code,'B');
});

test('Deactivating a product blocks new sales while retaining its history',()=>{
 let s=state();s=createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'x',quantity:1}],id:'historical',method:'cash',received:8500});
 s=setInventoryStatus(s,'t1',{id:'status-1',productId:'x',expectedRevision:0,active:false,reason:'Fora de catálogo'},'operator-id');
 assert.equal(s.products[0].active,false);assert.equal(s.sales.length,1);
 assert.throws(()=>createSale(s,{tenantId:'t1',role:'owner',cart:[{productId:'x',quantity:1}],id:'new',method:'cash',received:8500}),/product/);
 s=setInventoryStatus(s,'t1',{id:'status-2',productId:'x',expectedRevision:1,active:true,reason:'Regressou'},'operator-id');
 assert.equal(s.products[0].active,true);
 assert.throws(()=>setInventoryStatus(s,'t1',{id:'status-3',productId:'x',expectedRevision:1,active:false,reason:'old'},'operator-id'),/revision_conflict/);
});

test('Stock receipts are idempotent, adjustments require a fresh count, stock never negative',()=>{
 let s=state(),first={id:'received',productId:'x',kind:'receive',quantity:3.5,reason:'Fornecedor'};
 s=recordInventoryMovement(s,'t1',first,'operator-id');
 assert.equal(s.products[0].stock,13.5);
 assert.strictEqual(recordInventoryMovement(s,'t1',first,'operator-id'),s);
 assert.throws(()=>recordInventoryMovement(s,'t1',{...first,quantity:5},'operator-id'),/operation_conflict/);
 const adjust={id:'count',productId:'x',kind:'adjust',quantity:12,expectedStock:13.5,reason:'Contagem física'};
 s=recordInventoryMovement(s,'t1',adjust,'operator-id');
 assert.equal(s.products[0].stock,12);assert.equal(s.stockMovements[0].delta,-1.5);
 assert.throws(()=>recordInventoryMovement(s,'t1',{...adjust,id:'stale',quantity:8},'operator-id'),/stock_conflict/);
 assert.throws(()=>recordInventoryMovement(s,'t1',{...adjust,id:'negative',quantity:-1,expectedStock:12},'operator-id'),/invalid_quantity/);
 assert.equal(s.inventoryEvents.length,2);
});

test('Inventory validates integer-only units, actor identity and protected tenant data',()=>{
 let s=state();s.products[0].unit='un';
 assert.throws(()=>recordInventoryMovement(s,'t1',{id:'bad',productId:'x',kind:'receive',quantity:0.5,reason:'X'},'u'),/invalid_quantity/);
 assert.throws(()=>recordInventoryMovement(s,'t2',{id:'cross',productId:'x',kind:'receive',quantity:2,reason:'X'},'u'),/product_not_found/);
 assert.throws(()=>editInventoryProduct(s,'t1',{...change(),reason:''},'u'),/invalid_inventory_request/);
 assert.throws(()=>setInventoryStatus(s,'t1',{id:'s1',productId:'x',expectedRevision:0,active:'false',reason:'wrong'},'u'),/invalid_status/);
});

function bootstrap(){
 const store=createStore(':memory:',{bootstrapUser:'rootuser',bootstrapPassword:'BootstrapPassword2026!',secure:false});
 const admin=store.session(store.login('rootuser','BootstrapPassword2026!','ubuntu').token);
 const company=store.createBusiness(admin,{name:'Mercearia Um',type:'Retail',owner:'Owner One'});
 const login=store.login(company.onboarding.username,company.onboarding.temporaryPassword,'phone');
 store.changePassword(store.session(login.token),company.onboarding.temporaryPassword,'ChangedPassword2026!abc',login.token);
 return {store,owner:store.session(login.token),token:login.token,businessId:store.session(login.token).business_id};
}

test('Authenticated server enforces permissions, tenant scoping and movement audit',()=>{
 const {store,owner,businessId}=bootstrap();
 try{
  let s=store.product(owner,{tenantId:businessId,name:'Feijão',category:'Food',unit:'kg',price:3000,stock:6,min:1,code:'F'});
  const p=s.products[0];
  const edited={id:'edit1',productId:p.id,expectedRevision:0,reason:'Alteração de preço',name:'Feijão premium',category:'Food',code:'F',price:4000,min:1};
  s=store.productEdit(owner,edited);assert.equal(s.products[0].price,4000);
  assert.strictEqual(store.productEdit(owner,edited).inventoryEvents.length,s.inventoryEvents.length);
  assert.equal(store.productEdit(owner,{...edited,id:'edit2',expectedRevision:1,name:'Feijão extra'}).products[0].revision,2);
  assert.throws(()=>store.productEdit(owner,{...edited,id:'stale',expectedRevision:0}),e=>e.status===409);
  s=store.inventoryMovement(owner,{id:'receive',productId:p.id,kind:'receive',quantity:4,reason:'Entrega'});
  assert.equal(s.products[0].stock,10);
  s=store.inventoryMovement(owner,{id:'count',productId:p.id,kind:'adjust',quantity:8,expectedStock:10,reason:'Contagem física'});
  assert.equal(s.products[0].stock,8);
  assert.throws(()=>store.inventoryMovement(owner,{id:'stale-count',productId:p.id,kind:'adjust',quantity:3,expectedStock:10,reason:'Desactualizado'}),e=>e.status===409);
  assert.equal(s.stockMovements.length,2);
  assert.ok(s.inventoryEvents.some(e=>e.actorId===owner.id&&e.action==='edit'));
  const person=store.createMember(owner,{name:'Cash',role:'cashier'}).onboarding;
  const l=store.login(person.username,person.temporaryPassword,'cash');
  store.changePassword(store.session(l.token),person.temporaryPassword,'ChangedCash2026!abc',l.token);
  const cashier=store.session(l.token);
  assert.throws(()=>store.productStatus(cashier,{id:'s',productId:p.id,expectedRevision:2,active:false,reason:'Wrong'}),e=>e.status===403);
  assert.equal(store.snapshot(cashier).inventoryEvents.length,0);
  assert.equal(store.snapshot(cashier).stockMovements.length,0);
 }finally{store.close();}
});

test('HTTP inventory endpoints reject unauthenticated requests and cross-site writes',async()=>{
 const {store}=bootstrap();const app=createApp(store);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+app.address().port;
 try{
  const body=JSON.stringify({id:'operation',productId:'test',kind:'receive',quantity:1,reason:'X'});
  const opts={method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body};
  const guest=await fetch(url+'/api/stock/movements',opts);
  assert.equal(guest.status,401);
  const forged=await fetch(url+'/api/products/edit',{...opts,headers:{...opts.headers,Origin:'https://malicious.invalid'}});
  assert.equal(forged.status,403);
 }finally{await new Promise(resolve=>app.close(resolve));store.close();}
});

test('History escapes untrusted inventory descriptions and includes the operator',()=>{
 const s={inventoryEvents:[{id:'event',tenantId:'t1',action:'edit',productId:'x',productName:'<img src=x>',reason:'<script>',actorId:'user',createdAt:new Date().toISOString(),before:{name:'A'},after:{name:'B'}}],members:[{id:'user',name:'Operador'}]};
 const html=inventoryHistoryHTML(s,'t1','pt',v=>v+' MT');
 assert.match(html,/Operador/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(html,/<img src/);
});

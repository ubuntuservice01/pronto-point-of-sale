import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseProductPhoto,productPhotoHTML,MAX_PHOTO_DATA_URL,photoFieldHTML,bindProductPhoto,photoFromForm} from '../src/product-photo.js';
test('photo accepts only bounded JPEG data URLs',()=>{
 const jpeg='data:image/jpeg;base64,/9j/abcd';
 assert.equal(normaliseProductPhoto(jpeg),jpeg);
 assert.equal(normaliseProductPhoto(''),'');
 for(const value of ['https://example.com/photo.jpg','data:image/svg+xml;base64,abc','data:image/png;base64,abc','data:image/jpeg;base64,<script>',jpeg+'A'.repeat(MAX_PHOTO_DATA_URL)])assert.throws(()=>normaliseProductPhoto(value),/invalid_product_photo/);
});
test('photo HTML uses a real image safely and falls back for demo records',()=>{
 assert.match(productPhotoHTML({photo:'data:image/jpeg;base64,/9j/abcd'}),/<img class="product-photo"/);
 assert.match(productPhotoHTML({emoji:'📦'}),/product-photo-fallback/);
 assert.doesNotMatch(productPhotoHTML({photo:'javascript:alert(1)',emoji:'🫙'}),/<img/);
 const requiredForm=photoFieldHTML('',false,true);
 assert.match(requiredForm,/data-photo-required="true"/);
 assert.match(requiredForm,/name="productPhoto" accept="image\/\*"/);
 assert.match(requiredForm,/name="productCamera" accept="image\/\*" capture="environment"/);
 assert.match(requiredForm,/Carregar fotografia/);
 assert.match(requiredForm,/Tirar fotografia/);
 assert.match(photoFieldHTML('data:image/jpeg;base64,/9j/abcd'),/Remover fotografia actual/);
});

import {seed,addProduct} from '../src/model.js';
import {editInventoryProduct} from '../src/inventory.js';
const sample='data:image/jpeg;base64,/9j/abcd';
test('demo product retains uploaded photograph and can replace it without copying raw images into history',()=>{
 const input={name:'Arroz 1kg',category:'Alimentação',unit:'un',code:'AR-1',price:7000,stock:12,min:2,photo:sample};
 let state=addProduct(seed(),'t1',input);
 const product=state.products.at(-1);
 assert.equal(product.photo,sample);
 const edit={id:'photo-change',productId:product.id,expectedRevision:0,name:product.name,category:product.category,code:product.code,price:product.price,min:product.min,reason:'Actualizar fotografia',photo:''};
 state=editInventoryProduct(state,'t1',edit,'operator-1');
 assert.equal(state.products.at(-1).photo,'');
 assert.equal(state.inventoryEvents[0].before.photo,true);
 assert.equal(state.inventoryEvents[0].after.photo,false);
 assert.ok(!JSON.stringify(state.inventoryEvents).includes(sample));
 assert.equal(editInventoryProduct(state,'t1',edit,'operator-1'),state);
 assert.throws(()=>addProduct(seed(),'t1',{...input,code:'AR-2',photo:'https://invalid/photo.jpg'}),/invalid_product_photo/);
});


test('camera and gallery selections use one compressed preview and either can be saved',async()=>{
 const originalBitmap=globalThis.createImageBitmap,originalDocument=globalThis.document;
 const fileA={type:'image/jpeg',size:1000},fileB={type:'image/png',size:2000};
 const photo='data:image/jpeg;base64,/9j/abcd';
 globalThis.createImageBitmap=async()=>({width:900,height:600,close(){}});
 globalThis.document={createElement:()=>({
  width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),
  toDataURL:()=>photo
 })};
 const input=()=>({files:[],value:'',addEventListener(type,callback){this.listener=callback;}});
 const gallery=input(),camera=input();
 const image={src:'',hidden:true,attrs:{src:''},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;}};
 const placeholder={hidden:false},remove={checked:false};
 const elements={'[name="productPhoto"]':gallery,'[name="productCamera"]':camera,'[data-photo-preview]':image,'[data-photo-placeholder]':placeholder,'[name="removeProductPhoto"]':remove};
 const form={querySelector:(selector)=>elements[selector]||null};
 try{
  bindProductPhoto(form);
  gallery.files=[fileA];gallery.value='local.jpg';
  await gallery.listener();
  assert.equal(image.src,photo);
  assert.equal(image.hidden,false);
  assert.equal(placeholder.hidden,true);
  assert.equal(await photoFromForm(form),photo);
  camera.files=[fileB];camera.value='photo.png';
  await camera.listener();
  assert.equal(gallery.value,'');
  assert.equal(await photoFromForm(form),photo);
  remove.checked=true;
  assert.equal(await photoFromForm(form,photo),'');
 } finally {
  globalThis.createImageBitmap=originalBitmap;globalThis.document=originalDocument;
 }
});

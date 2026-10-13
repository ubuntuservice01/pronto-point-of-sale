import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseProductPhoto,productPhotoHTML,MAX_PHOTO_DATA_URL,photoFieldHTML} from '../src/product-photo.js';
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
 assert.match(photoFieldHTML('',false,true),/accept="image\/\*".+required/);
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

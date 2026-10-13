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

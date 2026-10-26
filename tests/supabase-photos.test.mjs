import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {renderInventoryView,normalizeInventorySnapshot} from '../src/supabase-inventory-ui.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
const B='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333',U='44444444-4444-4444-8444-444444444444';
const product={id:P,name:'Óleo',code:'PR-0001',category:'Geral',unit:'un',
 price_cents:2500,stock:5,min_stock:1,revision:3,active:true,
 photo_path:B+'/'+R+'/'+P+'/'+U+'.jpg'};
test('Inventory and selling screens keep user-controlled paths escaped and image loading deferred',()=>{
 const stock=normalizeInventorySnapshot({today:'2026-10-15',products:[product],batches:[],movements:[],suggestions:[]});
 const inventory=renderInventoryView({view:'inventory',inventory:stock,role:'owner',selectedProductId:P});
 assert.ok(inventory.includes('data-shop-form="photo_upload"'));
 assert.ok(inventory.includes('name="photo"'));
 assert.ok(inventory.includes('capture="environment"'));
 assert.ok(inventory.includes('data-shop-product-photo'));
 const checkout=renderShopScreen({account:{userId:U,email:'shop@example.org'},
 grants:[{id:B,name:'Loja',role:'owner'}],grant:{id:B,name:'Loja',role:'owner'},
 branches:[{id:R,name:'Central'}],branchId:R,
 data:{products:[{...stock.products[0],priceCents:2500,minStock:1,photoPath:product.photo_path}],
  sales:[],sessions:[]},
 cart:[],view:'sell',method:'cash',discount:'0',query:'',feedback:'',pending:null});
 assert.ok(checkout.includes('data-shop-product-photo'));
 assert.ok(!checkout.includes('https://xgtpvszwzvkwysrswkek.supabase.co/storage/v1/object/public'));
});
test('Image upload requires valid size, type, signed-in session, and belongs to correct product',async()=>{
 const calls=[];
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return json({access_token:'mock-jwt',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return json({id:U,email:'stock@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return json(false);
  if(url.includes('pronto_memberships?'))return json([{business_id:B,role:'stock',active:true}]);
  if(url.includes('pronto_businesses?'))return json([{id:B,name:'Loja',status:'active'}]);
  if(url.includes('/storage/v1/object/pronto-product-photos/'))return json({Key:'saved'});
  if(url.endsWith('/rest/v1/rpc/pronto_product_attach_and_activate'))return json({product_id:P,revision:4});
  if(url.includes('/storage/v1/object/sign/'))return json({signedURL:'/object/sign/pronto-product-photos/'+product.photo_path+'?token=test'});
  return json({},404);
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await assert.rejects(()=>client.uploadProductPhoto({
  businessId:B,branchId:R,productId:P,expectedRevision:3,file:new Blob(['image'],{type:'image/jpeg'})}),/supabase_unauthorized/);
 await client.signIn('stock@example.org','password');
 await assert.rejects(()=>client.uploadProductPhoto({
  businessId:B,branchId:R,productId:P,expectedRevision:3,file:new Blob(['x'],{type:'image/svg+xml'})}),/photo_mime/);
 await assert.rejects(()=>client.uploadProductPhoto({
  businessId:B,branchId:R,productId:P,expectedRevision:3,file:new Blob([new Uint8Array(3145729)],{type:'image/jpeg'})}),/photo_invalid/);
 const result=await client.uploadProductPhoto({
  businessId:B,branchId:R,productId:P,expectedRevision:3,file:new Blob(['abc'],{type:'image/jpeg'})});
 assert.equal(result.product_id,P);
 const upload=calls.find(c=>c.url.includes('/storage/v1/object/pronto-product-photos/'));
 assert.equal(upload.opts.headers.Authorization,'Bearer mock-jwt');
 assert.equal(upload.opts.headers['Content-Type'],'image/jpeg');
 assert.ok(upload.url.includes(B+'/'+R+'/'+P+'/'));
 const attach=calls.find(c=>c.url.endsWith('/rpc/pronto_product_attach_and_activate'));
 const payload=JSON.parse(attach.opts.body).p_data;
 assert.ok(payload.photo_path.startsWith(B+'/'+R+'/'+P+'/'));
 assert.equal(payload.expected_revision,3);
 const signed=await client.productPhotoUrl(product.photo_path);
 assert.ok(signed.startsWith('https://xgtpvszwzvkwysrswkek.supabase.co/storage/v1/object/sign/pronto-product-photos/'));
 assert.ok(signed.includes('?token=test'));
 await assert.rejects(()=>client.productPhotoUrl('https://evil.example/image.jpg'),/photo_path/);
 client.lockScreen();
 await assert.rejects(()=>client.uploadProductPhoto({
  businessId:B,branchId:R,productId:P,expectedRevision:3,file:new Blob(['image'],{type:'image/jpeg'})}),/pin_screen_locked/);
});
test('Bucket is private; RLS checks authenticated tenant, branch, role and exact product path',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015212000_pronto_product_photos.sql',import.meta.url),'utf8');
 for(const re of [/false,3145728/,/image\/webp/,/photo_permission/,/product_revision_conflict/,
  /create policy "pronto_product_photo_read"/,/create policy "pronto_product_photo_upload"/,
  /pronto_private\.member_role/,/storage\.objects/,/auth\.uid/,/photo_attach/])assert.match(sql,re);
 assert.doesNotMatch(sql,/create policy .* for (update|delete) to authenticated/i);
});

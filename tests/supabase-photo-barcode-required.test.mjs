import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
import {createShopScannerFeedback,shopScannerHTML} from '../src/shop-mobile-scanner.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';

const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const P='44444444-4444-4444-8444-444444444444';
test('New product UI requires photo and barcode or internal-code selection',()=>{
 const html=renderShopScreen({
  account:{userId:U,email:'owner@example.org'},grants:[{id:B,name:'Loja',role:'owner'}],
  grant:{id:B,name:'Loja',role:'owner'},branches:[{id:R,name:'Principal'}],branchId:R,
  data:{products:[],sales:[],sessions:[]},cart:[],view:'products'
 });
 for(const part of ['data-shop-product-scan','name="product_camera"','name="product_photo"',
  'data-shop-create-photo-preview','name="generate_code"','name="code"'])
  assert.match(html,new RegExp(part));
 assert.match(html,/Fotografia obrigatória/);
 assert.match(html,/capture="environment"/);
 assert.match(html,/gerar código interno/i);
 assert.doesNotMatch(html,/Código de fábrica \(opcional\)/);
 const source=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 assert.match(source,/A fotografia é obrigatória/);
 assert.match(source,/Já existe um produto com este código/);
 assert.match(source,/if\(el\.hasAttribute\('data-shop-product-scan'\)\)/);
});
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('Photo-first activation: no product becomes active until private upload and attach succeed',async()=>{
 const operations=[];
 const fetchImpl=async(url,opt)=>{
  operations.push(url);
  if(url.includes('grant_type=password'))return json(200,{user:{id:U},access_token:'jwt',expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return json(200,{id:U,email:'owner@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return json(200,false);
  if(url.includes('/rest/v1/pronto_memberships?'))return json(200,[{business_id:B,role:'owner',active:true}]);
  if(url.includes('/rest/v1/pronto_businesses?'))return json(200,[{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rest/v1/rpc/pronto_product_create_pending_photo'))return json(200,{product_id:P,code:'PR-000001'});
  if(url.includes('/storage/v1/object/pronto-product-photos/'))return json(200,{Key:'ok'});
  if(url.endsWith('/rest/v1/rpc/pronto_product_attach_and_activate'))return json(200,{product_id:P,revision:1,photo_path:B+'/'+R+'/'+P+'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'});
  return json(404,{message:'not found'});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.signIn('owner@example.org','password');
 const file=new Blob(['jpeg contents'],{type:'image/jpeg'});
 const result=await client.createProductWithPhoto({business_id:B,branch_id:R,name:'Arroz',category:'Geral',
  unit:'un',code:'8900000000',price_cents:1000,min_stock:'0'},file);
 assert.equal(result.code,'PR-000001');
 assert.equal(result.revision,1);
 const seq=operations.filter(url=>/pending_photo|product-photos|attach_and_activate/.test(url));
 assert.match(seq[0],/create_pending_photo/);
 assert.match(seq[1],/product-photos/);
 assert.match(seq[2],/attach_and_activate/);
});
test('Audio confirms recognised product with high bip, unknown product with lower alert',()=>{
 const frequencies=[];
 class FakeAudio{
  currentTime=5;destination={};resume(){return Promise.resolve();}
  createOscillator(){return {frequency:{setValueAtTime(value){frequencies.push(value);}},
   connect(){},start(){},stop(){}};}
  createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
  close(){return Promise.resolve();}
 }
 const signal=createShopScannerFeedback(FakeAudio);
 assert.equal(signal('success'),true);
 assert.deepEqual(frequencies,[880,1174]);
 frequencies.length=0;
 assert.equal(signal('error'),true);
 assert.deepEqual(frequencies,[370,260]);
 signal.close();
 assert.equal(createShopScannerFeedback(null)('success'),false);
 const scanner=readFileSync(new URL('../src/shop-mobile-scanner.js',import.meta.url),'utf8');
 assert.match(scanner,/const ok=result===true\|\|result\?\.accepted===true/);
 assert.match(scanner,/if\(ok\)\{\s*audio\('success'\)/);
 assert.match(scanner,/audio\('error'\)/);
 assert.match(shopScannerHTML(),/data-shop-scan-video/);
});
test('Photo activation SQL preserves intentionally inactive and existing imported products',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261026143000_product_photo_before_activation.sql',import.meta.url),'utf8');
 assert.match(migration,/pending_product_photos/);
 assert.match(migration,/active=false/);
 assert.match(migration,/photo_attach\(p_data\)/);
 assert.match(migration,/if v_pending is not null then/);
 assert.match(migration,/active=true/);
 assert.match(migration,/grant execute.*authenticated/i);
});

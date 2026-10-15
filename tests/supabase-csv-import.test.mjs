import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProductCSV} from '../src/product-import.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111',BR='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333';
test('CSV recognises header aliases and validates codes, quantity and prices',()=>{
 const parsed=parseProductCSV('nome;categoria;preco;unidade;stock;minimo\nArroz;Alimentos;50,00;kg;10;2\nÓleo;Alimentos;80,00;un;5;1');
 assert.equal(parsed.products.length,2);
 assert.equal(parsed.products[0].price,5000);
 assert.equal(parsed.products[1].stock,5);
 assert.equal(parsed.errors.length,0);
 assert.deepEqual(parseProductCSV('nome;categoria;preco\nX;Produtos;10\nY;Produtos;0').errors,[3]);
});
test('Product import refuses unauthenticated or unsafe request shapes',async()=>{
 let called=false;
 const reply=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:async(url,o)=>{
  called=true;
  if(url.includes('grant_type=password'))return reply({access_token:'mock',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply({id:U,email:'test@shop.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(false);
  if(url.includes('pronto_memberships?'))return reply([{business_id:B,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return reply([{id:B,name:'Shop',status:'active'}]);
  if(url.endsWith('/rpc/pronto_import_products_csv')){
   assert.equal(o.headers.Authorization,'Bearer mock');
   assert.equal(JSON.parse(o.body).p_data.idempotency_key,'test-key');
   return reply({imported_count:1,duplicate:false});
  }
  return reply([],404);
 }});
 await assert.rejects(()=>client.importProductsCSV({items:[{name:'X'}]}),/supabase_unauthorized/);
 await client.signIn('test@shop.org','pw');
 await assert.rejects(()=>client.importProductsCSV({items:Array(101).fill({})}),/csv_import_invalid/);
 assert.deepEqual(await client.importProductsCSV({business_id:B,branch_id:BR,idempotency_key:'test-key',items:[{name:'X'}]}),{imported_count:1,duplicate:false});
 assert.equal(called,true);
});
test('Server migration guards tenant, atomicity, audit and idempotency',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015222000_pronto_csv_product_import.sql',import.meta.url),'utf8');
 for(const rule of [/security definer/,/member_role/,/pg_advisory_xact_lock/,/idempotency_conflict/,
 /merchant_action\('product_create'/,/merchant_action\('stock_receive'/,/stock.csv_import/,/revoke all on function public.pronto_import_products_csv/])assert.match(sql,rule);
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 assert.match(ui,/data-shop-form="csv_import"/);
 assert.match(app,/parseProductCSV/);
 assert.match(app,/pendingCSV/);
});
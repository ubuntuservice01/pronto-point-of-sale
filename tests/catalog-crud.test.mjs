import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogControls,catalogFeedback} from '../src/ui/pronto-catalog-controls.js';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id='12345678-1234-4234-8234-123456789012';
test('CRUD controls render safe archive, restore and delete actions',()=>{
 const markup=catalogControls({kind:'product',id,active:true,revision:2});
 assert.match(markup,/data-catalog-action="archive"/);
 assert.match(markup,/data-catalog-action="delete"/);
 assert.match(markup,/data-catalog-revision="2"/);
 assert.match(catalogControls({kind:'customer',id,active:false}),/data-catalog-action="restore"/);
 assert.equal(catalogControls({kind:'customer',id:'"><script>',active:true}),'');
 assert.equal(catalogControls({kind:'sale',id,active:true}),'');
});
test('Delete outcomes distinguish real deletion from preservation of financial history',()=>{
 assert.match(catalogFeedback('supplier','delete','deleted').message,/definitivamente/);
 assert.match(catalogFeedback('supplier','delete','archived').message,/histórico|vendas|compras/i);
 assert.match(catalogFeedback('customer','restore','restored').title,/reactivado/);
});
test('Merchant UI exposes CRUD only with appropriate role and requires server confirmation',()=>{
 const supplier=read('src/supabase-finance-ui.js'),customer=read('src/supabase-credit-ui.js');
 const products=read('src/supabase-inventory-ui.js'),controller=read('src/supabase-shop-dashboard.js');
 const api=read('src/supabase-identity.js');
 for(const [file,source] of [['supplier',supplier],['customer',customer],['product',products]]){
  assert.ok(source.includes("catalogControls({kind:'"+file+"'"),file);
  assert.match(source,/\['owner','manager'\]\.includes\(role\)/);
 }
 assert.match(controller,/if\(el\.hasAttribute\('data-catalog-action'\)\)/);
 assert.match(controller,/if\(!await confirmShop\(question\)\)return/);
 assert.ok(controller.indexOf('await client.catalogLifecycle(')<controller.indexOf("void showSuccessModal({...feedback,confirmText:'OK'})"));
 assert.match(api,/rpc\/pronto_catalog_lifecycle/);
});
test('Migration enforces tenant role, server-side delete constraints and audit',()=>{
 const sql=read('supabase/migrations/20261026203000_catalog_lifecycle_crud.sql');
 for(const phrase of ["coalesce(v_role,'') not in('owner','manager')","p_kind is null or p_action is null",
  'pronto_private.member_role(p_business_id)','v_p.stock<>0',
  'when foreign_key_violation','pronto_audit_events',
  "to authenticated","product_revision_conflict","pronto_held_sales"]){
  assert.ok(sql.includes(phrase),phrase);
 }
 assert.doesNotMatch(sql,/grant execute on function public\.pronto_catalog_lifecycle\([\s\S]*?\) to anon;/i);
});
test('PWA caches CRUD components',()=>{
 const sw=read('public/sw.js'),html=read('index.html');
 for(const file of ['/src/ui/pronto-catalog-controls.js','/src/ui/pronto-catalog-controls.css'])
  assert.ok(sw.includes(file),file);
 assert.ok(html.includes('/src/ui/pronto-catalog-controls.css'));
});

test('Product creation screen links directly to CRUD inventory',()=>{
 const shop=read('src/supabase-shop-ui.js'),dash=read('src/supabase-shop-dashboard.js');
 assert.match(shop,/data-shop-open-inventory/);
 assert.match(dash,/el\.hasAttribute\('data-shop-open-inventory'\)/);
 assert.match(dash,/view='inventory';render\(\)/);
});

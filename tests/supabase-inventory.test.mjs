import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeInventorySnapshot,inventoryAlerts,renderInventoryView,shoppingListCSV} from '../src/supabase-inventory-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333',P='44444444-4444-4444-8444-444444444444';
const fixture={today:'2026-10-15',products:[{id:P,name:'Arroz <Premium>',code:'PR-001',category:'Mercearia',unit:'kg',price_cents:2500,stock:3,min_stock:5,revision:7,active:true}],
 batches:[{id:U,product_id:P,lot_number:'L-1',expires_on:'2026-10-20',qty:3,unit_cost_cents:1200},
 {id:R,product_id:P,lot_number:'EXP',expires_on:'2026-10-01',qty:1,unit_cost_cents:1200}],
 movements:[{id:U,product_id:P,kind:'adjust',qty_delta:-2,reason:'Contagem física',created_at:'2026-10-14'}],
 suggestions:[{product_id:P,name:'Arroz <Premium>',available_qty:3,min_stock:5,sold_last_30_days:30,suggested_qty:11,low_stock:true}]};
const inventory=normalizeInventorySnapshot(fixture);
test('stock and expiration alerts distinguish low, upcoming, expired, and shopping list',()=>{
 const out=inventoryAlerts(inventory,7);
 assert.equal(out.low.length,1);assert.equal(out.expiring.length,1);
 assert.equal(out.expired.length,1);assert.equal(out.suggestions[0].suggested,11);
 assert.equal(inventoryAlerts(inventory,1).expiring.length,0);
});
test('inventory editor escapes products; finance cannot change prices',()=>{
 const html=renderInventoryView({view:'inventory',inventory,role:'owner',selectedProductId:P});
 assert.ok(html.includes('data-shop-form="product_update"'));
 assert.ok(html.includes('data-shop-form="inventory_count"'));
 assert.ok(html.includes('data-shop-form="inventory_adjust"'));
 assert.ok(html.includes('Arroz &lt;Premium&gt;'));
 assert.ok(!html.includes('Arroz <Premium>'));
 assert.ok(!renderInventoryView({view:'inventory',inventory,role:'stock',selectedProductId:P}).includes('data-shop-form="product_update"'));
});
test('alerts and reorder list can export CSV with formula injection mitigation',()=>{
 const html=renderInventoryView({view:'alerts',inventory,role:'owner'});
 assert.ok(html.includes('shop-alert-days'));
 assert.ok(html.includes('data-inventory-export'));
 const csv=shoppingListCSV({...inventory,suggestions:[{...inventory.suggestions[0],name:'=SUM(1+1)'}]});
 assert.ok(csv.includes("'=SUM(1+1)"));
 assert.ok(csv.includes('Vendido_30_dias'));
});
test('inventory server RPCs are tenant-scoped and allowlisted',async()=>{
 const calls=[];
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return reply({access_token:'mock-jwt',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply({id:U,email:'stock@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(false);
  if(url.includes('pronto_memberships?'))return reply([{business_id:B,role:'stock',active:true}]);
  if(url.includes('pronto_businesses?'))return reply([{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_inventory_snapshot'))return reply(fixture);
  if(url.endsWith('/rpc/pronto_inventory_action'))return reply({product_id:P,revision:8,stock:3});
  return reply({},404);
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.signIn('stock@example.org','password');
 assert.equal((await client.inventorySnapshot(B,R)).products[0].revision,7);
 await client.inventoryAction('inventory_count',{business_id:B,branch_id:R,product_id:P,counted_qty:3});
 const c=calls.find(x=>x.url.endsWith('/rpc/pronto_inventory_action'));
 assert.equal(c.opts.headers.Authorization,'Bearer mock-jwt');
 assert.deepEqual(JSON.parse(c.opts.body),{p_action:'inventory_count',p_data:{business_id:B,branch_id:R,product_id:P,counted_qty:3}});
 await assert.rejects(()=>client.inventoryAction('inventory_delete_all',{}),/inventory_action_invalid/);
 await assert.rejects(()=>client.inventorySnapshot(B,'bad'),/shop_scope/);
});
test('inventory migration checks role, branch, revision, lot quantities and audit',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015201000_pronto_inventory_actions.sql',import.meta.url),'utf8');
 const fix=readFileSync(new URL('../supabase/migrations/20261015201200_pronto_inventory_lot_prefix_fix.sql',import.meta.url),'utf8');
 for(const regex of [/security definer/,/member_role/,/branch_unavailable/,/product_revision_conflict/,/for update/,/pronto_stock_movements/,/pronto_audit_events/,/suggested_qty/,/min_stock/]) assert.match(sql,regex);
 assert.match(fix,/'AJ-'\|\|left/);
});

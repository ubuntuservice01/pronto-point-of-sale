import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {icon} from '../src/icons.js';
import {normalizeInventorySnapshot,inventoryNotificationSummary} from '../src/supabase-inventory-ui.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const productA='11111111-1111-4111-8111-111111111111';
const productB='22222222-2222-4222-8222-222222222222';
const inventory=normalizeInventorySnapshot({
 today:'2026-10-21',
 products:[
  {id:productA,name:'Arroz <Premium>',code:'AR-01',category:'Geral',unit:'saco',price_cents:149900,stock:0,min_stock:10,revision:1,active:true},
  {id:productB,name:'Sabão',code:'SB-01',category:'Geral',unit:'un',price_cents:5500,stock:1,min_stock:10,revision:1,active:true}
 ],
 batches:[
  {id:'a',product_id:productA,lot_number:'A1',expires_on:'2026-10-25',qty:5},
  {id:'b',product_id:productB,lot_number:'B1',expires_on:'2026-10-10',qty:2},
  {id:'c',product_id:productB,lot_number:'B2',expires_on:'2026-10-23',qty:0}
 ],
 movements:[],
 suggestions:[
  {product_id:productA,name:'Arroz <Premium>',available_qty:0,min_stock:10,sold_last_30_days:4,suggested_qty:10,low_stock:true},
  {product_id:productB,name:'Sabão',available_qty:1,min_stock:10,sold_last_30_days:3,suggested_qty:9,low_stock:true}
 ]
});
const render=(options={})=>{
 const account={userId:'33333333-3333-4333-8333-333333333333',email:'loja@example.co.mz'};
 const grant={id:'44444444-4444-4444-8444-444444444444',name:'ISA FISH',role:'owner'};
 return renderShopScreen({account,grants:[grant],grant,
  branches:[{id:'55555555-5555-4555-8555-555555555555',name:'Principal'}],
  branchId:'55555555-5555-4555-8555-555555555555',
  data:{products:[],sales:[],sessions:[]},cart:[],view:'history',method:'cash',discount:'0',
  query:'',feedback:'',pending:null,inventory,...options});
};
test('Badge counts only real branch low-stock and non-empty expiring/expired lots',()=>{
 const data=inventoryNotificationSummary(inventory,30);
 assert.equal(data.total,4);
 assert.equal(data.low,2);
 assert.equal(data.expiring,1);
 assert.equal(data.expired,1);
 assert.ok(data.items.some(x=>x.kind==='expired'&&x.detail.includes('Sabão')));
 assert.equal(inventoryNotificationSummary(inventory,1).total,3);
 assert.equal(inventoryNotificationSummary(null).total,0);
 assert.ok(!data.items.some(x=>x.detail.includes('2026-10-23')));
});
test('Sidebar badges, bell by Sair, and popover list use real data and escape product names',()=>{
 const html=render({notificationsOpen:true});
 assert.match(html,/data-shop-view="alerts"/);
 assert.match(html,/data-shop-alert-count/);
 assert.match(html,/aria-label="Notificações: 4 alerta\(s\)"/);
 assert.match(html,/shop-notification-trigger/);
 assert.match(html,/shop-notification-popover/);
 assert.match(html,/data-shop-notifications-all/);
 assert.match(html,/shop-notification-expired/);
 assert.match(html,/shop-notification-low/);
 assert.match(html,/shop-notification-expiring/);
 assert.ok(html.indexOf('data-shop-notifications')<html.indexOf('data-shop-logout'));
 assert.match(html,/Arroz &lt;Premium&gt;/);
 assert.doesNotMatch(html,/Arroz <Premium>/);
 assert.match(html,/shop-nav-icon" aria-hidden="true"><svg/);
});
test('Zero alerts hide red counter while keeping the accessible bell',()=>{
 const none={...inventory,suggestions:[],batches:[]};
 const html=render({inventory:none,notificationsOpen:true});
 assert.match(html,/aria-label="Notificações: 0 alerta\(s\)"/);
 assert.match(html,/data-shop-alert-count aria-label="0 alerta\(s\)" hidden/);
 assert.match(html,/Não existem alertas/);
 const cashier={id:'44444444-4444-4444-8444-444444444444',name:'ISA FISH',role:'cashier'};
 const restricted=render({grant:cashier,inventory});
 assert.doesNotMatch(restricted,/data-shop-view="alerts"/);
 assert.match(restricted,/aria-label="Notificações: 0 alerta\(s\)"/);
});
test('Merchant navigation uses real individual SVG symbols with distinct palettes and larger targets',()=>{
 for(const key of ['sell','products','cash','history','customers','debts','suppliers','purchases',
  'expenses','held','returns','inventory','alerts','shopping_list','reports','team','audit','branches','transfers']){
  assert.match(icon(key),/<svg/);
  assert.doesNotMatch(icon(key),/<script/);
 }
 assert.notEqual(icon('alerts'),icon('inventory'));
 const css=read('src/shop-sidebar.css');
 assert.match(css,/\.shop-layout \.shop-nav-icon svg\{[^}]*width:25px/);
 assert.match(css,/\.shop-nav button\[data-shop-view="alerts"\]/);
 assert.match(css,/\.shop-nav button\[data-shop-view="cash"\]/);
 assert.match(css,/\.shop-notification-trigger \.shop-alert-count/);
 assert.match(css,/@media\(max-width:680px\)/);
});
test('Bell state, accessible close, scoped server refresh and context-switch guards are wired',()=>{
 const js=read('src/supabase-shop-dashboard.js');
 assert.match(js,/notificationsOpen=!notificationsOpen/);
 assert.match(js,/data-shop-notifications-all/);
 assert.match(js,/refreshAlertBadges/);
 assert.match(js,/client\.inventorySnapshot\(business,branch\)/);
 assert.match(js,/grant\.id!==business\|\|branchId!==branch/);
 assert.match(js,/client\.isScreenLocked\?\.\(\)/);
 assert.match(js,/event\.key!=='Escape'/);
 assert.match(js,/setInterval\(\(\)=>\{void refreshAlerts\(\);\},120000\)/);
});

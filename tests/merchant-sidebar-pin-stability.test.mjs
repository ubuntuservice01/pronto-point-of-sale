import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
import {PIN_IDLE_MS} from '../src/supabase-pin-lock.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=(options={})=>renderShopScreen({
 account:{userId:'11111111-1111-4111-8111-111111111111',email:'dono@exemplo.co.mz'},
 grants:[{id:'22222222-2222-4222-8222-222222222222',name:'Mercearia Teste',role:'owner'}],
 grant:{id:'22222222-2222-4222-8222-222222222222',name:'Mercearia Teste',role:'owner'},
 branches:[{id:'33333333-3333-4333-8333-333333333333',name:'Filial Principal'}],
 branchId:'33333333-3333-4333-8333-333333333333',
 data:{products:[],sales:[],sessions:[]},cart:[],view:'cash',method:'cash',discount:'0',
 query:'',feedback:'',pending:null,...options
});
test('Desktop merchants have a left sidebar, not the old wide horizontal menu',()=>{
 const html=shell();
 assert.match(html,/class="shop-sidebar"/);
 assert.match(html,/class="shop-workspace"/);
 assert.match(html,/class="shop-nav"/);
 assert.match(html,/class="shop-mobile-bottom"/);
 assert.ok(html.indexOf('class="shop-sidebar"')<html.indexOf('class="shop-workspace"'));
 assert.match(html,/data-shop-sidebar-collapse/);
 assert.match(html,/data-shop-menu-toggle/);
 const css=read('src/shop-sidebar.css');
 assert.match(css,/grid-template-columns:var\(--shop-sidebar-width\) minmax\(0,1fr\)/);
 assert.match(css,/@media\(max-width:830px\)/);
 assert.match(css,/position:fixed/);
 assert.match(css,/shop-mobile-bottom/);
 assert.match(read('index.html'),/src\/shop-sidebar\.css/);
 assert.match(read('public/sw.js'),/src\/shop-sidebar\.css/);
});
test('Mobile drawer closes and quick actions respect merchant role',()=>{
 const html=shell({menuOpen:true,sidebarCollapsed:true});
 assert.match(html,/shop-menu-open/);
 assert.match(html,/shop-menu-collapsed/);
 assert.match(html,/data-shop-menu-toggle aria-label="Fechar menu"/);
 const stock=shell({grant:{id:'22222222-2222-4222-8222-222222222222',name:'Loja de Stock',role:'stock'}});
 assert.doesNotMatch(stock,/data-shop-view="sell"/);
 assert.match(stock,/data-shop-view="inventory"/);
 assert.match(stock,/data-shop-view="products"/);
});
test('Every merchant submit prevents default before inspecting busy state',()=>{
 const js=read('src/supabase-shop-dashboard.js');
 const start=js.indexOf("root.addEventListener('submit',async event=>{");
 assert.ok(start>=0);
 const part=js.slice(start,start+340);
 assert.ok(part.indexOf('event.preventDefault();')>0);
 assert.ok(part.indexOf('event.preventDefault();')<part.indexOf('if(busy)return;'));
 assert.match(js,/if\(el\.hasAttribute\('data-shop-menu-toggle'\)\)/);
 assert.match(js,/view=el\.dataset\.shopView;menuOpen=false;/);
 const admin=read('src/supabase-admin-dashboard.js');
 for(const start of ["const submit=async event=>{","const controlForm=async event=>{"]){
  const position=admin.indexOf(start);
  assert.ok(position>=0);
  const block=admin.slice(position,position+320);
  assert.ok(block.indexOf('event.preventDefault();')<block.indexOf('if(busy)return;'));
 }
});
test('PIN never locks after product saves; idle protects genuinely inactive sessions',()=>{
 const pin=read('src/supabase-pin-lock.js');
 assert.equal(PIN_IDLE_MS,600000);
 assert.match(pin,/\['pointerdown','keydown','touchstart','wheel','input','change','submit','focusin'\]/);
 assert.match(pin,/doc\.hidden&&opened&&!locking/);
 assert.match(pin,/pagehide/);
 const shop=read('src/supabase-shop-dashboard.js');
 assert.match(shop,/await execute\(action,payload,action==='product_create'\?/);
 assert.match(shop,/if\(action==='product_create'\)view='products'/);
});

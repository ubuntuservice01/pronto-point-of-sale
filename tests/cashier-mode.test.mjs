import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderShopScreen} from '../src/supabase-shop-ui.js';

const base=(opts={})=>renderShopScreen({
 account:{userId:'11111111-1111-4111-8111-111111111111',email:'caixa@exemplo.co.mz'},
 grants:[{id:'22222222-2222-4222-8222-222222222222',name:'Loja',role:'cashier'}],
 grant:{id:'22222222-2222-4222-8222-222222222222',name:'Loja',role:'cashier'},
 branches:[{id:'33333333-3333-4333-8333-333333333333',name:'Filial'}],
 branchId:'33333333-3333-4333-8333-333333333333',
 data:{products:[],sales:[],sessions:[]},cart:[],view:'sell',method:'cash',
 discount:'0',query:'',feedback:'',pending:null,heldSales:[],...opts
});
test('Modo Caixa is before notifications and uses large quick actions on sales',()=>{
 const html=base({cashierMode:true});
 assert.match(html,/shop-fast-cashier/);
 assert.match(html,/aria-pressed="true"/);
 assert.match(html,/Modo normal/);
 assert.ok(html.indexOf('data-shop-cashier-toggle')<html.indexOf('data-shop-notifications'));
 for(const action of ['data-shop-scan','data-shop-hold','data-shop-held-tab','data-shop-go-checkout']){
  assert.match(html,new RegExp(action));
 }
 assert.match(html,/Em espera/);
 assert.match(html,/Cobrar/);
});
test('Normal mode and non-sales roles do not receive unauthorised shortcuts',()=>{
 const normal=base();
 assert.match(normal,/data-shop-cashier-toggle/);
 assert.doesNotMatch(normal,/shop-fast-cashier/);
 assert.doesNotMatch(normal,/shop-cashier-quick-actions/);
 const stock=base({grant:{id:'22222222-2222-4222-8222-222222222222',name:'Loja',role:'stock'},view:'inventory',cashierMode:true});
 assert.doesNotMatch(stock,/data-shop-cashier-toggle/);
 assert.doesNotMatch(stock,/shop-fast-cashier/);
});
test('Held cart can be accessed; empty cart cannot be held; rendering never mutates checkout',()=>{
 const html=base({cashierMode:true,heldSales:[]});
 assert.match(html,/data-shop-hold disabled/);
 const controller=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 assert.match(controller,/cashierMode=!\(cashierMode&&view==='sell'\)/);
 assert.match(controller,/if\(!authorizedView\('sell'\)\)return/);
 assert.match(controller,/view='sell';render\(\);return/);
 assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/shop-cashier-mode\.css/);
 assert.match(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),/shop-cashier-mode\.css/);
 const css=readFileSync(new URL('../src/shop-cashier-mode.css',import.meta.url),'utf8');
 assert.match(css,/@media\(max-width:750px\)/);
 assert.match(css,/min-height:65px/);
});

test('Modo Caixa shows scanner, hold, resume and checkout exactly once without duplicated lower controls',()=>{
 const product={id:'44444444-4444-4444-8444-444444444444',name:'Arroz',code:'EAN-123',
  category:'Mercearia',unit:'un',stock:10,minStock:1,priceCents:5000};
 const cart=[{productId:product.id,quantity:2}];
 const held=[{id:'55555555-5555-4555-8555-555555555555',
  cart,createdAt:'2026-10-25T16:00:00Z'}];
 const fast=base({cashierMode:true,cart,data:{products:[product],sales:[],sessions:[]},
  heldSales:held});
 const count=selector=>(fast.match(new RegExp(selector,'g'))||[]).length;
 assert.equal(count('data-shop-scan(?=[ >])'),1,'only the big scan shortcut remains');
 assert.equal(count('data-shop-hold(?=[ >])'),1,'hold is not repeated in the floating bar');
 assert.equal(count('data-shop-held-tab(?=[ >])'),1,'resume goes to the held sales screen');
 assert.equal(count('data-shop-go-checkout(?=[ >])'),1,'the quick action scrolls to checkout');
 assert.doesNotMatch(fast,/shop-scan-launch|shop-hold-mobile-bar|shop-held-in-sales|shop-main-hold-active/);
 assert.match(fast,/id="shop-search"/);
 assert.match(fast,/id="shop-checkout-panel"/);
 assert.match(fast,/name="cash_received"/);
 const normal=base({cashierMode:false,cart,data:{products:[product],sales:[],sessions:[]},heldSales:held});
 assert.match(normal,/shop-scan-launch/);
 assert.match(normal,/shop-hold-mobile-bar/);
 assert.match(normal,/shop-held-in-sales/);
 assert.match(normal,/shop-main-hold-active/);
 assert.doesNotMatch(normal,/shop-cashier-quick-actions/);
});
test('Modo Caixa retains single safe actions with empty cart, pending sale or no held sales',()=>{
 const empty=base({cashierMode:true,cart:[],heldSales:[]});
 assert.match(empty,/data-shop-hold disabled/);
 assert.doesNotMatch(empty,/shop-hold-mobile-bar|shop-held-in-sales|shop-scan-launch/);
 const pending=base({cashierMode:true,cart:[{productId:'none',quantity:1}],pending:{id:'pending'}});
 assert.match(pending,/data-shop-hold disabled/);
 assert.match(pending,/data-shop-retry/);
 assert.match(pending,/data-shop-discard/);
});

test('Modo Caixa presents an item counter, stock-aware quantity controls and a fast scan path',()=>{
 const product={id:'44444444-4444-4444-8444-444444444444',name:'Café',code:'789100',
  category:'Mercearia',unit:'un',stock:5,minStock:1,priceCents:12000};
 const html=base({cashierMode:true,cart:[{productId:product.id,quantity:2}],
  data:{products:[product],sales:[],sessions:[]}});
 assert.match(html,/Nova venda/);
 assert.match(html,/2 artigo\(s\)/);
 assert.match(html,/data-shop-fast-minus/);
 assert.match(html,/shop-fast-product-qty/);
 assert.match(html,/shop-cashier-scan-primary/);
 assert.match(html,/Cobrar · 240,00 MT/);
 const dashboard=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 assert.match(dashboard,/continuous:cashierMode/);
 assert.match(dashboard,/data-shop-fast-minus/);
 assert.match(dashboard,/onDone:/);
});

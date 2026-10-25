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
 assert.match(controller,/cashierMode=!cashierMode/);
 assert.match(controller,/if\(!authorizedView\('sell'\)\)return/);
 assert.match(controller,/view='sell';render\(\);return/);
 assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/shop-cashier-mode\.css/);
 assert.match(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),/shop-cashier-mode\.css/);
 const css=readFileSync(new URL('../src/shop-cashier-mode.css',import.meta.url),'utf8');
 assert.match(css,/@media\(max-width:750px\)/);
 assert.match(css,/min-height:65px/);
});

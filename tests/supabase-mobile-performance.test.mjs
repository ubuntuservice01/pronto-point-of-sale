import test from 'node:test';
import assert from 'node:assert/strict';
import {renderShopProductResults,renderShopScreen} from '../src/supabase-shop-ui.js';

const product=(n,name=`Produto ${n}`)=>({
 id:`product-${n}`,code:`PR-${String(n).padStart(4,'0')}`,name,
 category:'Mercearia',unit:'kg',priceCents:10000,stock:12,minStock:2
});

test('mobile catalog initially builds at most 80 cards but can search the entire list',()=>{
 const products=Array.from({length:240},(_,i)=>product(i));
 products[238]=product(238,'Arroz especial');
 const initial=renderShopProductResults(products,'');
 assert.equal((initial.match(/class="shop-product"/g)||[]).length,80);
 assert.match(initial,/A mostrar 80 de 240 produtos/);
 assert.doesNotMatch(initial,/Arroz especial/);
 const searched=renderShopProductResults(products,'arroz especial');
 assert.match(searched,/Arroz especial/);
 assert.match(searched,/data-shop-add="product-238"/);
 assert.equal((searched.match(/class="shop-product"/g)||[]).length,1);
});

test('catalog search escapes untrusted names and preserves empty-state feedback',()=>{
 const html=renderShopProductResults([product(1,'<img src=x onerror=alert(1)>')],'img');
 assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('<img src=x'));
 assert.match(renderShopProductResults([product(1)],'inexistente'),/Não há produtos encontrados/);
});

test('navigating away from sales does not walk or render the product catalog',()=>{
 let productNameReads=0;
 const record={...product(1),get name(){productNameReads++;return 'Produto';}};
 const html=renderShopScreen({
  account:{userId:'user-1',email:'caixa@example.org'},
  grants:[],grant:{role:'cashier',id:'business-1',name:'Loja'},
  branches:[{id:'branch-1',name:'Principal'}],branchId:'branch-1',
  data:{products:[record],sessions:[],sales:[]},cart:[],view:'history'
 });
 assert.equal(productNameReads,0);
 assert.ok(!html.includes('data-shop-add="product-1"'));
});

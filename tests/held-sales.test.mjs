import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../src/model.js';
import {makeHeldSale,eligibleHeldSales,loadHeldSales,persistHeldSales,heldSalesStorageKey,heldSaleChanged} from '../src/held-sales.js';
import {heldSalesDialogHTML} from '../src/held-sales-ui.js';

function store(){const map=new Map();return {
 getItem:key=>map.get(key)||null,setItem:(key,val)=>{map.set(key,val);},clear:()=>map.clear()
};}
const state=seed();
const cart=[{productId:'p1',quantity:2},{productId:'p3',quantity:1}];
const hold=(id='hold-1',tenantId='t1',userId='u2')=>makeHeldSale({
 id,tenantId,userId,cart,products:state.products,method:'mixed',
 mixed:{cash:'100',emola:'115'},received:'100',
 selectedCustomerId:'abc',discountText:'5',debtDueDate:'',
 now:'2026-10-14T18:00:00.000Z'
});

test('Guardado e recuperação de vendas em espera sem concluir qualquer venda',()=>{
 const sale=hold();
 assert.equal(sale.cart.length,2);
 assert.equal(sale.subtotal,21500);
 assert.equal(sale.total,21000);
 assert.equal(sale.method,'mixed');
 assert.deepEqual(sale.mixed,{cash:'100',mpesa:'',emola:'115',transfer:''});
 assert.deepEqual(sale.cart,cart);
 assert.equal(state.sales.length,0);
 const storage=store();
 persistHeldSales(storage,'t1','u2',[sale]);
 assert.deepEqual(loadHeldSales(storage,'t1','u2'),[sale]);
 assert.deepEqual(loadHeldSales(storage,'t1','u1'),[]);
 assert.deepEqual(loadHeldSales(storage,'t2','u2'),[]);
 assert.notEqual(heldSalesStorageKey('t1','u2'),heldSalesStorageKey('t1','u1'));
});

test('Vendas suspensas ficam isoladas por operador e estabelecimento',()=>{
 const storage=store();
 persistHeldSales(storage,'t1','u2',[hold()]);
 assert.equal(loadHeldSales(storage,'t1','u2').length,1);
 const forged={...hold(),tenantId:'t2'};
 assert.deepEqual(eligibleHeldSales([forged], 't1','u2'),[]);
 const anotherUser={...hold(),userId:'u1'};
 assert.deepEqual(eligibleHeldSales([anotherUser], 't1','u2'),[]);
 assert.throws(()=>persistHeldSales(storage,'t1','u2',[hold(),hold()]),/held_invalid/);
 assert.throws(()=>persistHeldSales(storage,'t1','u2',[hold(),forged]),/held_invalid/);
});

test('Destaques avisam de alterações de preços, stock ou produtos removidos',()=>{
 const sale=hold();
 assert.equal(heldSaleChanged(sale,state.products),false);
 assert.equal(heldSaleChanged(sale,state.products.map(p=>p.id==='p1'?{...p,price:p.price+500}:p)),true);
 assert.equal(heldSaleChanged(sale,state.products.filter(p=>p.id!=='p1')),true);
 assert.equal(heldSaleChanged(sale,state.products.map(p=>p.id==='p1'?{...p,stock:0}:p)),true);
});

test('Popup mostra valores e retoma a venda sem um botão de venda automática',()=>{
 const item=hold();
 const html=heldSalesDialogHTML({
  holds:[item],customers:[{id:'abc',tenantId:'t1',name:'Cliente A'}],
  products:state.products,tenantId:'t1',lang:'pt',money:n=>(n/100).toFixed(2)+' MT',
  currentCartCount:0
 });
 assert.match(html,/Vendas em espera/);
 assert.match(html,/210.00 MT/);
 assert.match(html,/Cliente A/);
 assert.match(html,/Arroz/);
 assert.match(html,/Sabonete/);
 assert.match(html,/Retomar para finalizar/);
 assert.match(html,/data-resume-held="hold-1"/);
 assert.doesNotMatch(html,/data-quick-payment/);
 assert.match(heldSalesDialogHTML({holds:[item],products:state.products,tenantId:'t1',lang:'pt',money:String,currentCartCount:2}),/Suspender actual e retomar/);
});
test('O conteúdo dos artigos e clientes é escapado no popup',()=>{
 const sample=hold();
 sample.lines[0].name='<img src=x onerror=alert(1)>';
 const html=heldSalesDialogHTML({
  holds:[sample],customers:[{id:'abc',tenantId:'t1',name:'<script>alert(1)</script>'}],
  products:state.products,tenantId:'t1',money:String
 });
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
});

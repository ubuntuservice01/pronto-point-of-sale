import test from 'node:test';
import assert from 'node:assert/strict';
import {allowsFractionalSale,quantityFromValueCents,validateSaleQuantity,saleQuantityLabel} from '../src/sale-by-value.js';
import {seed,createSale} from '../src/model.js';
import {cartTotal,makeSaleRequest} from '../src/supabase-shop-core.js';
import {shopPaymentPanel} from '../src/supabase-shop-ui.js';
import {readFileSync} from 'node:fs';

const arroz={unit:'kg',stock:10,allowFractional:true};
const byValue=(product,priceCents,amountCents)=>quantityFromValueCents({product,priceCents,amountCents});

test('Venda em meticais converte arroz a 100 MT/kg e desconta gramas exactas',()=>{
 assert.equal(byValue(arroz,10000,1000),0.1);
 assert.equal(byValue(arroz,10000,3000),0.3);
 assert.equal(byValue(arroz,10000,9000),0.9);
 assert.equal(saleQuantityLabel(0.3,'kg'),'0,3 kg (300 g)');
 assert.equal(validateSaleQuantity(arroz,0.3),0.3);
});

test('Apenas produtos autorizados aceitam uma fracção',()=>{
 const fechado={...arroz,allowFractional:false};
 assert.throws(()=>byValue(fechado,10000,3000),/amount_unrepresentable/);
 assert.equal(byValue(fechado,10000,20000),2);
 assert.throws(()=>validateSaleQuantity(fechado,0.3),/quantity_invalid/);
 assert.equal(allowsFractionalSale({unit:'un',allowFractional:true}),false);
 assert.throws(()=>byValue({unit:'un',allowFractional:true,stock:10},10000,3000),/amount_unrepresentable/);
});

test('Quantidade tem três casas e preço deve coincidir exactamente com o pedido',()=>{
 assert.throws(()=>byValue(arroz,8300,1000),/amount_unrepresentable/);
 assert.throws(()=>byValue(arroz,10000,1),/amount_unrepresentable/);
 assert.throws(()=>byValue({...arroz,stock:0.2},10000,3000),/quantity_invalid/);
 assert.throws(()=>byValue(arroz,10000,0),/amount_invalid/);
 assert.throws(()=>validateSaleQuantity(arroz,0.0009),/quantity_invalid/);
 assert.equal(allowsFractionalSale({unit:'kg'}),true);
 assert.equal(allowsFractionalSale({unit:'saco'}),false);
});

test('Venda de 30 MT reduz 300 g do stock sem alterar o preço por kg',()=>{
 const state=seed(),product={...state.products[0],price:10000,stock:1,allowFractional:true};
 state.products[0]=product;
 const quantity=byValue(product,10000,3000);
 const next=createSale(state,{tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity}],
  method:'cash',received:3000,id:'v-30',deviceId:'d',userId:'u1'});
 assert.equal(next.products[0].stock,0.7);
 assert.equal(next.sales[0].lines[0].quantity,0.3);
 assert.equal(next.sales[0].lines[0].total,3000);
 assert.equal(next.inventoryEvents[0].delta,-0.3);
 assert.equal(next.products[0].price,10000);
 assert.throws(()=>createSale({...state,products:[{...product,allowFractional:false},...state.products.slice(1)]},
  {tenantId:'t1',role:'owner',cart:[{productId:'p1',quantity}],method:'cash',received:3000,id:'v-31'}),/quantity/);
});

test('A venda Supabase e o painel exibem o mesmo montante e a mesma quantidade',()=>{
 const product={id:'x',name:'Arroz',code:'R1',unit:'kg',priceCents:10000,stock:1,allowFractional:true};
 const cart=[{productId:'x',quantity:0.3}];
 assert.deepEqual(cartTotal(cart,[product]),{subtotal:3000,total:3000});
 const payload=makeSaleRequest({businessId:'b',branchId:'r',sessionId:'s',cart,
  products:[product],discount:'0',allocations:[{method:'cash',amount:'30'}],cashReceived:'30',idempotencyKey:'k'});
 assert.deepEqual(payload.items,[{product_id:'x',quantity:0.3}]);
 const html=shopPaymentPanel({method:'cash',cart,products:[product],session:{id:'s'},valueModeProducts:['x']});
 assert.match(html,/data-shop-cart-value="x"/);
 assert.match(html,/300 g/);
 assert.match(html,/30,00 MT/);
 assert.throws(()=>cartTotal(cart,[{...product,allowFractional:false}]),/quantity_invalid/);
});

test('Migração usa RPC de acesso controlado e verifica vendas no servidor',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261025143000_product_fractional_sales.sql',import.meta.url),'utf8');
 for(const fragment of ['allow_fractional boolean not null default false','pronto_private.member_role',
  'product_revision_conflict','pronto_private.guard_fractional_sale_item','pronto_fraction_sale_item_guard',
  'pronto_audit_events','revoke all on function public.pronto_product_fraction'])assert.ok(sql.includes(fragment));
});

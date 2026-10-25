import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shopPaymentPanel,renderShopScreen} from '../src/supabase-shop-ui.js';
import {makeSaleRequest} from '../src/supabase-shop-core.js';
import {confirmedSaleReceipt,receiptMarkup} from '../src/ui/pronto-sale-success.js';
const p='33333333-3333-4333-8333-333333333333', b='22222222-2222-4222-8222-222222222222';
const u='11111111-1111-4111-8111-111111111111';
const item={id:p,name:'Arroz',unit:'saco',priceCents:149900,stock:24,minStock:2,code:'AR-01'};
const cart=[{productId:p,quantity:2}];
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Cash received starts blank, not prefilled with the transaction total',()=>{
 const html=shopPaymentPanel({method:'cash',cart,products:[item],session:{id:b},role:'owner'});
 assert.match(html,/name="cash_received" value=""/);
 assert.match(html,/placeholder="Introduza o valor entregue"/);
 assert.doesNotMatch(html,/name="cash_received" value="2998/);
 assert.match(html,/required/);
 const mixed=shopPaymentPanel({method:'mixed',cart,products:[item],session:{id:b},role:'owner'});
 assert.match(mixed,/name="cash_received" value=""/);
});
test('Caixa no telemóvel mostra os seis meios de pagamento apenas na cobrança',()=>{
 const account={userId:u,email:'caixa@loja.co.mz',grants:[{id:u,name:'Loja',role:'cashier'}]};
 const opts={account,grants:account.grants,grant:account.grants[0],branches:[{id:b,name:'Centro'}],branchId:b,
  data:{products:[item],sessions:[],sales:[]},cart,view:'sell',method:'bank',discount:'0',query:'',feedback:'',pending:null,heldSales:[]};
 const html=renderShopScreen(opts);
 assert.ok(html.indexOf('shop-search-control')<html.indexOf('id="shop-checkout-panel"'));
 assert.doesNotMatch(html,/shop-mobile-payment-shortcut|shop-sale-hold-toolbar/);
 assert.doesNotMatch(html,/class="shop-sales-tabs" role="group"/);
 assert.doesNotMatch(html,/<h2>Centro<\/h2>/);
 assert.equal((html.match(/data-shop-method="bank"/g)||[]).length,1,'Only checkout owns the payment options');
 const checkout=html.slice(html.indexOf('id="shop-checkout-panel"'));
 for(const label of ['Dinheiro','M-Pesa','e-Mola','Transferência','Banco','Repartido'])
  assert.ok(checkout.includes('>'+label+'</button>'),label);
 assert.match(checkout,/data-shop-method="bank" aria-pressed="true"/);
 assert.match(html,/shop-held-in-sales/);
 const controller=read('src/supabase-shop-dashboard.js');
 assert.match(controller,/el\.hasAttribute\('data-shop-method'\)/);
});
test('Confirmed sales produce an escaped printable receipt with correct cash and change',()=>{
 const req=makeSaleRequest({
  businessId:u,branchId:b,sessionId:b,cart,products:[item],discount:'0',
  allocations:[{method:'cash',amount:'2998'}],
  cashReceived:'3000',idempotencyKey:u
 });
 const receipt=confirmedSaleReceipt({request:req,result:{sale_id:'55555555-5555-4555-8555-555555555555',total_cents:299800,change_cents:200},
  products:[item],shop:'Mercearia XYZ',branch:'Centro',seller:'vendedor@loja.co.mz',
  at:new Date('2026-10-21T12:00:00Z')});
 assert.equal(receipt.total,299800);
 assert.equal(receipt.cashReceived,300000);
 assert.equal(receipt.change,200);
 assert.equal(receipt.items[0].name,'Arroz');
 const html=receiptMarkup(receipt);
 assert.match(html,/Comprovativo de venda/);
 assert.match(html,/3000,00 MT/);
 assert.match(html,/2,00 MT/);
 assert.match(html,/não substitui documento fiscal/);
 assert.throws(()=>confirmedSaleReceipt({request:req,result:{},products:[item]}),/sale_not_confirmed/);
 const escaped=receiptMarkup({...receipt,shop:'<script>danger</script>'});
 assert.doesNotMatch(escaped,/<script>/);
 assert.match(escaped,/&lt;script&gt;/);
});
test('Sales are still rejected if the amount physically tendered is insufficient',()=>{
 assert.throws(()=>makeSaleRequest({businessId:u,branchId:b,sessionId:b,cart,products:[item],discount:'0',
   allocations:[{method:'cash',amount:'2998'}],cashReceived:'1000',idempotencyKey:u}),/cash_short/);
});
test('Held sales appear as a dedicated tab and directly on the selling screen',()=>{
 const account={userId:u,email:'vendedor@loja.co.mz',grants:[{id:u,name:'Loja',role:'owner'}]};
 const grants=account.grants,grant=grants[0],branches=[{id:b,name:'Centro'}];
 const data={products:[item],sessions:[],sales:[]};
 const opts={account,grants,grant,branches,branchId:b,data,cart:[],view:'sell',method:'cash',discount:'0',
  query:'',feedback:'',pending:null,heldSales:[{id:u,cart,createdAt:'2026-10-21T12:00:00Z'}]};
 const html=renderShopScreen(opts);
 assert.match(html,/data-shop-held-tab/);
 assert.match(html,/Vendas em espera/);
 assert.match(html,/data-shop-hold-resume=/);
 assert.match(html,/Arroz/);
 assert.match(html,/shop-held-menu-count/);
 const held=renderShopScreen({...opts,view:'held'});
 assert.match(held,/data-shop-sell-tab/);
 assert.match(held,/data-shop-hold-delete/);
});
test('Mobile hold stays on the floating action bar, not in the repeated top block',()=>{
 const account={userId:u,email:'caixa@loja.co.mz',grants:[{id:u,name:'Loja',role:'cashier'}]};
 const opts={account,grants:account.grants,grant:account.grants[0],branches:[{id:b,name:'Centro'}],branchId:b,
  data:{products:[item],sessions:[{id:b,operatorId:u}],sales:[]},cart,view:'sell',method:'cash',discount:'0',
  query:'',feedback:'',pending:null,heldSales:[{id:u,cart,createdAt:'2026-10-21T12:00:00Z'}]};
 const html=renderShopScreen(opts);
 assert.doesNotMatch(html,/shop-sale-hold-toolbar|shop-mobile-payment-shortcut/);
 assert.ok(html.indexOf('<h3>Produtos</h3>')<html.indexOf('shop-held-in-sales'));
 assert.match(html,/<div class="shop-hold-mobile-bar"[^>]*>[\s\S]*data-shop-hold/);
 assert.match(html,/data-shop-held-tab>Ver todas/);
 assert.match(html,/shop-main-hold-active/);
 const empty=renderShopScreen({...opts,cart:[]});
 assert.doesNotMatch(empty,/data-shop-hold(?:\s|>)/);
 assert.doesNotMatch(empty,/shop-hold-mobile-bar/);
 const awaiting=renderShopScreen({...opts,pending:{id:u}});
 assert.doesNotMatch(awaiting,/data-shop-hold(?:\s|>)/);
 assert.doesNotMatch(awaiting,/shop-hold-mobile-bar/);
 const css=read('src/supabase-checkout-flow.css');
 assert.match(css,/\.shop-hold-mobile-bar\{display:flex;position:fixed/);
 assert.match(css,/\.shop-main\.shop-main-hold-active\{padding-bottom:/);
});
test('Checkout confirmation is shown only after successful server response, and printing is an explicit choice',()=>{
 const js=read('src/supabase-shop-dashboard.js');
 const css=read('src/ui/pronto-sale-success.css');
 const modal=read('src/ui/pronto-sale-success.js');
 const serverIndex=js.indexOf('const result=await client.merchantAction(pending.due_on?');
 const modalIndex=js.indexOf('showSaleCompleteModal(receipt)');
 assert.ok(serverIndex>=0&&modalIndex>serverIndex);
 assert.match(js,/cash_required/);
 assert.match(js,/data-shop-held-tab/);
 for(const action of ['new','print','close'])assert.match(modal,new RegExp('data-sale-done="'+action+'"'));
 assert.match(modal,/win\.print\(\)/);
 assert.match(css,/@media print/);
 assert.match(modal,/thermalPageRule\(width,receiptHeight\)/);
 assert.match(modal,/pronto-sale-paper-width/);
 assert.match(modal,/saveThermalPaperWidth/);
 assert.match(css,/body\.pronto-printing/);
});

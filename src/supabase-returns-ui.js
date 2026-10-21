import {esc,MONEY} from './supabase-shop-core.js';
const money=x=>MONEY(Number(x)||0);
export function normalizeReturnSnapshot(raw){
 if(!raw||!Array.isArray(raw.sales)||!Array.isArray(raw.returns))throw Error('returns_snapshot_invalid');
 return {
  sales:raw.sales.map(s=>({id:s.id,total:Number(s.total_cents)||0,method:s.method,
   date:s.created_at,status:s.status,items:(Array.isArray(s.items)?s.items:[]).map(i=>({
    productId:i.product_id,name:String(i.name||''),unit:i.unit,qty:Number(i.qty)||0,
    returned:Number(i.returned_qty)||0,price:Number(i.unit_price_cents)||0
   }))})),
  returns:raw.returns.map(r=>({id:r.id,saleId:r.sale_id,amount:Number(r.amount_cents)||0,
   method:r.method,reason:String(r.reason||''),date:r.created_at})),
  generatedAt:raw.generated_at
 };
}
const methods=[['cash','Dinheiro'],['mpesa','M-Pesa'],['emola','e-Mola'],['transfer','Transferência']];
export function renderReturnView({returns,selectedSaleId='',session=null}={}){
 if(!returns)return '<section class="shop-box"><h3>Devoluções</h3><p></p></section>';
 const sales=returns.sales.filter(s=>s.status==='completed');
 const sale=sales.find(s=>s.id===selectedSaleId)||null;
 return '<div class="shop-two">'+
  '<section class="shop-box"><h3>Devoluções e reembolsos</h3>'+
  '<p class="shop-help">Operações apenas para proprietário e gerente. Não cancela pagamentos nas operadoras nem emite nota de crédito fiscal.</p>'+
  '<label>Seleccionar venda<select id="shop-return-sale"><option value="">Escolha a venda</option>'+
   sales.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===selectedSaleId?' selected':'')+'>'+
   esc(String(s.date||'').slice(0,10))+' · '+money(s.total)+' · '+esc(s.id.slice(0,8))+'</option>').join('')+'</select></label>'+
  (sale?'<form data-shop-form="return_confirm" class="shop-form"><input type="hidden" name="sale_id" value="'+esc(sale.id)+'">'+
   '<p><strong>Valor original:</strong> '+money(sale.total)+'</p>'+
   sale.items.map((i,n)=>
    '<div class="finance-purchase-line"><strong>'+esc(i.name)+'</strong>'+
    '<small>Vendido: '+esc(i.qty)+' '+esc(i.unit)+' · Já devolvido: '+esc(i.returned)+'</small>'+
    '<input type="hidden" name="product_'+n+'" value="'+esc(i.productId)+'">'+
    '<label>Quantidade a devolver<input type="number" name="qty_'+n+'" min="0" max="'+esc(Math.max(0,i.qty-i.returned))+'" step="0.001" value="0"></label>'+
    '<label><input type="checkbox" name="resellable_'+n+'"> Artigo em condições de voltar ao stock</label>'+
    '<label>Validade do artigo devolvido (se aplicável)<input type="date" name="expiry_'+n+'"></label></div>').join('')+
   '<label>Meio do reembolso<select name="method">'+methods.map(([id,name])=>
    '<option value="'+id+'">'+name+'</option>').join('')+'</select></label>'+
   '<label>Referência do reembolso digital<input name="reference" maxlength="128"></label>'+
   '<label>Motivo<input name="reason" required minlength="3" maxlength="250"></label>'+
   '<label><input type="checkbox" name="confirmed" required> Confirmo que o reembolso foi efectivamente realizado ao cliente</label>'+
   '<button type="submit" class="shop-submit">Registar devolução</button></form>':
   '<p class="shop-help">Seleccione uma venda para devolver artigos.</p>')+
  '</section><section class="shop-box"><h3>Histórico de devoluções</h3>'+
  (returns.returns.length?returns.returns.map(r=>'<div class="credit-line">'+
   esc(String(r.date||'').slice(0,10))+' · '+money(r.amount)+' · '+esc(r.method)+' · '+esc(r.reason)+'</div>').join(''):
   '<p class="shop-help">Nenhuma devolução nesta filial.</p>')+
  '<p class="shop-help">Artigos danificados não regressam ao stock. Artigos revendáveis entram num novo lote com identificação da devolução.</p></section></div>';
}

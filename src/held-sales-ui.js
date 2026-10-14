import {heldSaleChanged} from './held-sales.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);

export function heldSalesDialogHTML({holds=[],customers=[],products=[],tenantId,lang='pt',money,currentCartCount=0}){
 const en=lang==='en';
 const sorted=holds.filter(h=>h.tenantId===tenantId).slice().reverse();
 const cards=sorted.map(hold=>{
  const date=new Date(hold.createdAt);
  const when=Number.isFinite(date.getTime())?date.toLocaleString(en?'en-GB':'pt-MZ',{
   timeZone:'Africa/Maputo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
  }):'—';
  const customer=customers.find(c=>c.id===hold.selectedCustomerId&&c.tenantId===tenantId);
  const lines=(hold.lines||[]).slice(0,4).map(line=>escapeHTML(line.name||'—'));
  const more=(hold.lines||[]).length>4?' +'+(hold.lines.length-4):'';
  const changed=heldSaleChanged(hold,products);
  return [
   '<article class="held-sale-item">',
   '<div class="held-sale-head"><div><strong>#ESP-',escapeHTML(hold.id.slice(0,8).toUpperCase()),'</strong><small>',escapeHTML(when),
   '</small></div><strong>',escapeHTML(money(Number.isSafeInteger(hold.total)?hold.total:0)),'</strong></div>',
   '<div class="held-sale-details"><small>',en?'Customer':'Cliente',': ',
   escapeHTML(customer?.name||(en?'Not identified':'Não identificado')),'</small>',
   '<small>',hold.cart.length,' ',en?'products':'produtos',' · ',lines.join(', '),more,'</small></div>',
   changed?'<p class="held-sale-warning">'+(en?'Stock or prices may have changed. Review the basket before completing.':'O stock ou os preços podem ter mudado. Confira o carrinho antes de concluir.')+'</p>':'',
   '<button type="button" class="primary held-resume-button" data-resume-held="',escapeHTML(hold.id),'">',
   currentCartCount?(en?'Hold current and resume':'Suspender actual e retomar'):(en?'Resume to complete':'Retomar para finalizar'),
   '</button></article>'
  ].join('');
 });
 return [
  '<div class="held-sales-popup"><p class="eyebrow">PRONTO POS</p><h2>',
  en?'Held sales':'Vendas em espera',' <span class="held-sales-count">',sorted.length,'</span></h2>',
  '<p class="info-note">',
  en?'Choose a sale to continue in checkout. No payment is registered until Complete sale is pressed.':
   'Escolha a venda que deseja recuperar no caixa. Nenhum pagamento é registado até clicar em Concluir venda.',
  '</p><div class="held-sales-list">',
  cards.length?cards.join(''):'<div class="empty-state"><p>'+(en?'No sales on hold.':'Ainda não existem vendas em espera.')+'</p></div>',
  '</div><p class="info-note">',
  en?'Held sales do not reserve stock. The list is stored on this device; authenticated accounts do not yet synchronise it across devices.':
   'Vendas em espera não reservam stock. A lista fica neste dispositivo; contas autenticadas ainda não sincronizam estas vendas entre dispositivos.',
  '</p></div>'
 ].join('');
}

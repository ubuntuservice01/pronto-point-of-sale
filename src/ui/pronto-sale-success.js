// Confirmed sale summary. Only successful server responses may reach this screen.
// Printable document is explicitly an operational receipt, not a fiscal invoice.
import {esc,MONEY} from '../supabase-shop-core.js';
const methods={cash:'Dinheiro',mpesa:'M-Pesa',emola:'e-Mola',transfer:'Transferência'};
const integer=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0;
const formatDate=stamp=>new Intl.DateTimeFormat('pt-PT',{
 timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'
}).format(stamp);
export function confirmedSaleReceipt({request,result,products,shop,branch,seller,at=new Date()}){
 if(!result||typeof result.sale_id!=='string'||!result.sale_id||
  !request||!Array.isArray(request.items)||!request.items.length)throw Error('sale_not_confirmed');
 const catalog=new Map((products||[]).map(p=>[p.id,p]));
 const items=request.items.map(item=>{
  const p=catalog.get(item.product_id);
  if(!p||!Number.isFinite(item.quantity)||item.quantity<=0||!integer(p.priceCents))
   throw Error('receipt_items_unavailable');
  return {name:String(p.name),unit:String(p.unit||'un'),qty:Number(item.quantity),
   unitCents:Number(p.priceCents),lineCents:Math.round(Number(p.priceCents)*Number(item.quantity))};
 });
 const subtotal=items.reduce((s,p)=>s+p.lineCents,0);
 const discount=Number(request.discount_cents||0);
 const total=integer(result.total_cents)?Number(result.total_cents):subtotal-discount;
 if(!integer(discount)||!integer(total))throw Error('receipt_amount_invalid');
 const payments=Array.isArray(request.allocations)?request.allocations.map(p=>({
  name:methods[p.method]||String(p.method),cents:Number(p.amount_cents||0)
 })):[];
 const change=integer(result.change_cents)?Number(result.change_cents):
  Math.max(0,Number(request.cash_received_cents||0)-(payments.find(x=>x.name==='Dinheiro')?.cents||0));
 return {id:result.sale_id,date:formatDate(at),shop:String(shop||'Loja'),
  branch:String(branch||''),seller:String(seller||''),items,subtotal,discount,total,
  payments,cashReceived:Number(request.cash_received_cents||0),change,
  credit:Boolean(result.debt_id||request.due_on),duplicate:Boolean(result.duplicate)};
}
export function receiptMarkup(r){
 const rows=r.items.map(p=>'<tr><td>'+esc(p.name)+'<small>'+esc(p.qty)+' × '+MONEY(p.unitCents)+' / '+esc(p.unit)+'</small></td>'+
  '<td>'+MONEY(p.lineCents)+'</td></tr>').join('');
 const pay=r.payments.map(p=>'<div><span>'+esc(p.name)+'</span><strong>'+MONEY(p.cents)+'</strong></div>').join('');
 return '<div class="pronto-receipt-content">'+
  '<header><strong>Pronto POS</strong><p>'+esc(r.shop)+'</p>'+
  (r.branch?'<p>Filial: '+esc(r.branch)+'</p>':'')+'</header>'+
  '<p><b>Comprovativo de venda</b></p>'+
  '<p>Ref.: '+esc(r.id)+'</p><p>Data: '+esc(r.date)+'</p>'+
  (r.seller?'<p>Operador: '+esc(r.seller)+'</p>':'')+
  '<table><thead><tr><th>Artigo</th><th>Valor</th></tr></thead><tbody>'+rows+'</tbody></table>'+
  '<div class="pronto-receipt-totals">'+
  '<div><span>Subtotal</span><strong>'+MONEY(r.subtotal)+'</strong></div>'+
  (r.discount?'<div><span>Desconto</span><strong>−'+MONEY(r.discount)+'</strong></div>':'')+
  '<div class="pronto-receipt-grand"><span>Total</span><strong>'+MONEY(r.total)+'</strong></div>'+
  pay+
  (r.payments.some(p=>p.name==='Dinheiro')?'<div><span>Dinheiro recebido</span><strong>'+MONEY(r.cashReceived)+'</strong></div>'+
   '<div><span>Troco</span><strong>'+MONEY(r.change)+'</strong></div>':'')+
  (r.credit?'<p>Venda a crédito — pagamento pendente.</p>':'')+
  '</div><footer>Obrigado pela preferência.<p>Comprovativo operacional; não substitui documento fiscal.</p></footer></div>';
}
export function showSaleCompleteModal(receipt,{doc=document}={}){
 if(!receipt?.id)throw Error('sale_not_confirmed');
 return new Promise(resolve=>{
  const dialog=doc.createElement('dialog');
  dialog.className='pronto-dialog pronto-sale-success-dialog';
  dialog.setAttribute('aria-labelledby','pronto-sale-success-title');
  dialog.setAttribute('aria-modal','true');
  dialog.innerHTML='<div class="pronto-sale-success-head"><div class="pronto-sale-success-icon" aria-hidden="true">✓</div>'+
   '<button type="button" class="pronto-dialog-x" data-sale-done="close" aria-label="Fechar janela">×</button></div>'+
   '<h2 id="pronto-sale-success-title">Venda concluída!</h2>'+
   '<p class="pronto-sale-success-copy">A venda foi confirmada no sistema. Escolha o próximo passo.</p>'+
   '<div class="pronto-sale-success-total">'+MONEY(receipt.total)+'</div>'+
   '<p class="pronto-sale-success-ref">Referência: '+esc(receipt.id.slice(0,8))+'</p>'+
   (receipt.duplicate?'<p class="pronto-sale-success-note">Esta venda já estava registada. Não foi duplicada.</p>':'')+
   '<div class="pronto-sale-success-actions">'+
    '<button type="button" class="pronto-dialog-button pronto-dialog-button-primary" data-sale-done="new">+ Nova venda</button>'+
    '<button type="button" class="pronto-dialog-button pronto-sale-print-action" data-sale-done="print">Imprimir recibo</button>'+
    '<button type="button" class="pronto-dialog-button pronto-dialog-button-cancel" data-sale-done="close">Fechar</button>'+
   '</div>';
  doc.body.append(dialog);
  let complete=false;
  const done=action=>{
   if(complete)return;
   complete=true;
   dialog.close();
   dialog.remove();
   resolve(action);
  };
  dialog.addEventListener('click',e=>{
   const button=e.target.closest('[data-sale-done]');
   if(button)done(button.dataset.saleDone);
  });
  dialog.addEventListener('cancel',e=>{e.preventDefault();done('close');});
  try{dialog.showModal();dialog.querySelector('[data-sale-done="new"]')?.focus();}
  catch{dialog.remove();resolve('close');}
 });
}
export function printSaleReceipt(r,{doc=document,win=window}={}){
 if(!r?.id)throw Error('sale_not_confirmed');
 // Only one print container; escaped data come from confirmed checkout request.
 doc.getElementById('pronto-sale-print')?.remove();
 const page=doc.createElement('section');
 page.id='pronto-sale-print';page.className='pronto-sale-print-page';
 page.innerHTML=receiptMarkup(r);
 doc.body.append(page);
 const cleanup=()=>page.remove();
 win.addEventListener('afterprint',cleanup,{once:true});
 try{win.print();}catch(e){cleanup();throw e;}
 // Some mobile PWA engines don't emit afterprint after cancelling printing.
 win.setTimeout?.(cleanup,60000);
}

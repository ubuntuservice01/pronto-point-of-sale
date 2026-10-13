import {productBatches,sellableQty,receiveBatch,adjustProductBatch} from './batches.js';
import {expiryInfo,formatExpiryDate} from './expiry.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&quot;',"'":'&#39;'}[c]));
const dayInfo=(date,en)=>{
 if(!date)return en?'No expiry date':'Sem validade definida';
 const status=expiryInfo(date).status;
 const word={expired:en?'Expired':'Vencido',today:en?'Expires today':'Vence hoje',soon:en?'Expires soon':'A vencer',valid:en?'Valid':'Válido'}[status];
 return word+' · '+formatExpiryDate(date,en?'en':'pt');
};
export function productBatchSummary(state,product,lang='pt'){
 const en=lang==='en',batches=productBatches(state,product),valid=sellableQty(state,product);
 const expired=batches.filter(b=>b.quantity>0&&b.expiryDate&&expiryInfo(b.expiryDate).status==='expired').reduce((sum,b)=>sum+b.quantity,0);
 return `<div class="batch-summary"><span>${batches.length} ${en?'lots/stock groups':'lotes/grupos de stock'}</span><span>${en?'Sellable':'Disponível para venda'}: <strong>${valid} ${esc(product.unit)}</strong></span>${expired? `<span class="batch-expired">${en?'Expired':'Vencido'}: ${expired} ${esc(product.unit)}</span>`:''}</div>`;
}
export function batchRowsHTML(state,product,lang='pt'){
 const en=lang==='en';
 const batches=productBatches(state,product).sort((a,b)=>(a.expiryDate||'9999-12-31').localeCompare(b.expiryDate||'9999-12-31'));
 if(!batches.length)return `<p class="empty">${en?'There is no stock in this product.':'Este produto não tem existências.'}</p>`;
 return `<div class="batch-list">${batches.map(b=>{
  const status=b.expiryDate?expiryInfo(b.expiryDate).status:'none';
  const num=b.source==='legacy'?(en?'Untracked previous stock':'Stock anterior sem lote'):b.number;
  return `<div class="batch-line ${status==='expired'?'batch-line-expired':''}"><div><strong>${esc(num)}</strong><small>${esc(dayInfo(b.expiryDate,en))}</small></div><div class="batch-right"><strong>${b.quantity} ${esc(product.unit)}</strong><span class="batch-chip batch-${status}">${status==='expired'?(en?'Not sellable':'Venda bloqueada'):status==='soon'?(en?'Expires soon':'A vencer'):status==='today'?(en?'Expires today':'Vence hoje'):(en?'In stock':'Em stock')}</span></div></div>`;
 }).join('')}</div>`;
}
export function batchActions({getState,getProducts,getTenantId,remote,submit,apply,render,modal,toast,lang}){
 const en=lang==='en',L=en?{title:'Lots and expiry',receive:'Receive a batch',adjust:'Correct a batch count',number:'Lot/batch number',expiry:'Expiry date (optional)',qty:'Quantity received',count:'Counted quantity',reason:'Reason/reference',save:'Save',failed:'Could not save lot. Check quantity, expiry date and number.',conflict:'Lot quantity or expiry was changed in another operation. Refresh and try again.',success:'Lot updated.',legacy:'Untracked previous stock',note:'For products already in stock, the untracked group has no invented batch number. FEFO chooses dated, valid batches before undated stock.',empty:'No stock groups.'}:{title:'Lotes e validades',receive:'Receber lote',adjust:'Corrigir contagem de lote',number:'Número do lote',expiry:'Data de validade (opcional)',qty:'Quantidade recebida',count:'Quantidade contada',reason:'Motivo / referência',save:'Guardar',failed:'Não foi possível guardar o lote. Verifique quantidade, validade e número.',conflict:'O lote ou a contagem foi alterado noutra operação. Actualize e tente novamente.',success:'Lote actualizado.',legacy:'Stock anterior sem lote',note:'O stock anterior mantém-se sem número de lote inventado. O FEFO escolhe primeiro lotes válidos com validade conhecida.',empty:'Não existem grupos de stock.'};
 const get=id=>getProducts().find(p=>p.id===id);
 const commit=async(dialog,path,payload,fn,button)=>{
  button.disabled=true;
  try{
   if(remote)await submit(path,{...payload,tenantId:getTenantId()});
   else await apply(state=>fn(state,getTenantId(),payload,'demo'));
   dialog.close();render();toast(L.success);
  }catch(e){button.disabled=false;toast(['stock_conflict','batch_expiry_conflict','operation_conflict'].includes(e.message)?L.conflict:L.failed);}
 };
 function receive(id){
  const p=get(id);if(!p)return;
  const unit=['un','caixa','pacote','saco','rolo','par','conjunto'].includes(p.unit),opId=crypto.randomUUID();
  const d=modal(`<h2>${L.receive}</h2><p>${esc(p.name)}</p><form><label>${L.number}<input name="batchNumber" maxlength="80" required placeholder="L-2026-001"></label><label>${L.expiry}<input name="expiryDate" type="date"></label><label>${L.qty} (${esc(p.unit)})<input name="quantity" type="number" min="${unit?1:0.001}" step="${unit?1:0.001}" required></label><label>${L.reason}<textarea name="reason" maxlength="200" rows="2" required></textarea></label><p class="info-note">${L.note}</p><button class="primary full">${L.save}</button></form>`);
  d.querySelector('form').onsubmit=e=>{
   e.preventDefault();const f=new FormData(e.target),payload={id:opId,productId:p.id,batchNumber:String(f.get('batchNumber')||'').trim(),expiryDate:String(f.get('expiryDate')||''),quantity:Number(f.get('quantity')),reason:String(f.get('reason')||'').trim()};
   if(!payload.batchNumber||!payload.reason||!Number.isFinite(payload.quantity)||payload.quantity<=0){toast(L.failed);return;}
   commit(d,'batches/receive',payload,receiveBatch,e.target.querySelector('button'));
  };
 }
 function adjust(id){
  const p=get(id);if(!p)return;const choices=productBatches(getState(),p);
  if(!choices.length){toast(L.empty);return;}
  const discrete=['un','caixa','pacote','saco','rolo','par','conjunto'].includes(p.unit),opId=crypto.randomUUID();
  const d=modal(`<h2>${L.adjust}</h2><p>${esc(p.name)}</p><form><label>${L.title}<select name="batchId">${choices.map(b=>`<option value="${esc(b.id||'legacy')}">${esc(b.number||L.legacy)} · ${b.quantity} ${esc(p.unit)} · ${esc(dayInfo(b.expiryDate,en))}</option>`).join('')}</select></label><label>${L.count} (${esc(p.unit)})<input name="quantity" type="number" min="0" step="${discrete?1:0.001}" value="${choices[0].quantity}" required></label><label>${L.reason}<textarea name="reason" maxlength="200" rows="2" required></textarea></label><button class="primary full">${L.save}</button></form>`);
  const select=d.querySelector('select'),amount=d.querySelector('[name=quantity]');
  select.onchange=()=>{amount.value=choices.find(b=>(b.id||'legacy')===select.value)?.quantity??0;};
  d.querySelector('form').onsubmit=e=>{
   e.preventDefault();const f=new FormData(e.target),batch=choices.find(b=>(b.id||'legacy')===f.get('batchId'));
   if(!batch)return toast(L.conflict);
   const payload={id:opId,productId:p.id,batchId:batch.id,quantity:Number(f.get('quantity')),expectedQuantity:batch.quantity,reason:String(f.get('reason')||'').trim()};
   if(!payload.reason||!Number.isFinite(payload.quantity)||payload.quantity<0){toast(L.failed);return;}
   commit(d,'batches/adjust',payload,adjustProductBatch,e.target.querySelector('button'));
  };
 }
 function details(id){
  const p=get(id);if(!p)return;
  const d=modal(`<h2>${L.title} — ${esc(p.name)}</h2><p class="info-note">${L.note}</p>${batchRowsHTML(getState(),p,lang)}<div class="batch-actions"><button id="receive-from-detail" class="primary">${L.receive}</button><button id="adjust-from-detail" class="secondary">${L.adjust}</button></div>`);
  d.querySelector('#receive-from-detail').onclick=()=>{d.close();receive(id);};
  d.querySelector('#adjust-from-detail').onclick=()=>{d.close();adjust(id);};
 }
 return {receive,adjust,details};
}

const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
export function inventoryHistoryHTML(state,tenantId,lang,money){
 const en=lang==='en',events=(state.inventoryEvents||[]).filter(e=>e.tenantId===tenantId);
 const ids=new Set(events.map(e=>e.id));
 const legacy=(state.stockMovements||[]).filter(e=>e.tenantId===tenantId&&!ids.has(e.id));
 const history=[...events,...legacy].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,20);
 if(!history.length)return `<p class="empty">${en?'No recorded changes yet. Operations before this update may not have history.':'Ainda não existem alterações registadas. Operações anteriores a esta actualização podem não ter histórico.'}</p>`;
 const actions={created:en?'Created':'Criado',edit:en?'Edited':'Editado',status:en?'Status':'Estado',receive:en?'Stock received':'Stock recebido',adjust:en?'Stock count':'Contagem'};
 const actor=e=>(state.members||[]).find(m=>m.id===(e.actorId||e.userId))?.name||e.actorId||e.userId||'—';
 const difference=e=>{
  if(e.action==='status')return e.after?.active?(en?'Activated':'Activado'):(en?'Deactivated':'Desactivado');
  if(e.action==='edit'){
   const fields={name:en?'Name':'Nome',category:en?'Category':'Categoria',code:en?'Barcode':'Código',price:en?'Price':'Preço',min:en?'Minimum':'Mínimo'};
   return Object.keys(e.after||{}).filter(k=>e.before?.[k]!==e.after?.[k]).map(k=>`${fields[k]||k}: ${k==='price'?money(e.before[k]):String(e.before?.[k]??'—')} → ${k==='price'?money(e.after[k]):String(e.after?.[k]??'—')}`).join(' · ');
  }
  return e.before!==undefined&&e.after!==undefined?`${e.before} → ${e.after} ${e.unit||''} (${e.delta>0?'+':''}${e.delta})`:'';
 };
 return history.map(e=>`<div class="list-row inventory-event"><div class="grow"><strong>${escape(actions[e.action||e.type]||e.action||e.type||'—')} · ${escape(e.productName)}</strong><small>${escape(e.reason)} · ${escape(new Date(e.createdAt).toLocaleString(en?'en-GB':'pt-MZ'))}</small><small>${en?'Operator':'Operador'}: ${escape(actor(e))}</small></div><div class="inventory-event-detail">${escape(difference(e))}</div></div>`).join('');
}
export function inventoryActions({getProducts,submit,modal,render,toast,reload,lang,money}){
 const en=lang==='en';
 const labels=en?{reason:'Reason / reference',save:'Save',edit:'Edit product',adjust:'Adjust inventory',receive:'Receive stock',failed:'Could not save. Check the fields.',success:'Saved successfully.',conflict:'Product or stock has changed in another session. Reloaded the latest information.',duplicate:'This barcode is already in use.',missing:'Please enter a reason.'}:{reason:'Motivo / referência',save:'Guardar',edit:'Editar produto',adjust:'Ajustar inventário',receive:'Receber stock',failed:'Não foi possível guardar. Verifique os dados.',success:'Alteração guardada.',conflict:'O produto ou o stock foi alterado noutra sessão. Dados actualizados.',duplicate:'Este código de barras já está em uso.',missing:'Indique o motivo da operação.'};
 const find=id=>getProducts().find(p=>p.id===id),reasons=()=>`<label>${labels.reason}<textarea name="reason" maxlength="250" rows="2" required></textarea></label>`;
 const handle=async(dialog,route,body,button)=>{
  button.disabled=true;
  try{await submit(route,body);dialog.close();render();toast(labels.success);}
  catch(error){
   button.disabled=false;
   if(['revision_conflict','stock_conflict'].includes(error.message)){dialog.close();try{await reload();}catch{}toast(labels.conflict);}
   else toast(error.message==='barcode_in_use'?labels.duplicate:labels.failed);
  }
 };
 return {
  edit(id){
   const p=find(id);if(!p)return;const opId=crypto.randomUUID();
   const d=modal(`<h2>${labels.edit}</h2><form><label>${en?'Name':'Nome'}<input name="name" value="${escape(p.name)}" maxlength="100" required></label><label>${en?'Category':'Categoria'}<input name="category" value="${escape(p.category)}" maxlength="60" required></label><label>${en?'Barcode':'Código de barras'}<input name="code" value="${escape(p.code)}" maxlength="80"></label><div class="form-grid"><label>${en?'Price (MT)':'Preço (MT)'}<input name="price" type="number" min="0.01" step="0.01" value="${(p.price/100).toFixed(2)}" required></label><label>${en?'Minimum stock':'Stock mínimo'}<input name="min" type="number" min="0" step="0.001" value="${p.min}" required></label></div>${reasons()}<p class="info-note">${en?'To change quantity, use Adjust.':'Para alterar a quantidade, utilize Ajustar.'}</p><button class="primary full">${labels.save}</button></form>`);
   d.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),reason=String(f.get('reason')).trim(),price=Number(f.get('price')),min=Number(f.get('min'));if(!reason)return toast(labels.missing);if(!Number.isFinite(price)||price<=0||!Number.isFinite(min)||min<0)return toast(labels.failed);
    handle(d,'products/edit',{id:opId,productId:p.id,expectedRevision:p.revision||0,name:String(f.get('name')).trim(),category:String(f.get('category')).trim(),code:String(f.get('code')).trim(),price:Math.round(price*100),min,reason},e.target.querySelector('button'));
   };
  },
  status(id){
   const p=find(id);if(!p)return;const next=p.active===false,opId=crypto.randomUUID();
   const d=modal(`<h2>${next?(en?'Activate product':'Activar produto'):(en?'Deactivate product':'Desactivar produto')}</h2><p>${escape(p.name)}</p><p>${en?'This does not delete past sales.':'As vendas antigas não serão eliminadas.'}</p><form>${reasons()}<button class="primary full">${en?'Confirm':'Confirmar'}</button></form>`);
   d.querySelector('form').onsubmit=e=>{e.preventDefault();const reason=String(new FormData(e.target).get('reason')).trim();if(!reason)return toast(labels.missing);
    handle(d,'products/status',{id:opId,productId:p.id,expectedRevision:p.revision||0,active:next,reason},e.target.querySelector('button'));
   };
  },
  movement(id,kind){
   const p=find(id);if(!p)return;const opId=crypto.randomUUID(),discrete=['un','caixa','pacote','saco','rolo','par','conjunto'].includes(p.unit);
   const d=modal(`<h2>${kind==='receive'?labels.receive:labels.adjust}</h2><p>${escape(p.name)} · ${p.stock} ${escape(p.unit)}</p><form><label>${kind==='receive'?(en?'Quantity received':'Quantidade recebida'):(en?'Counted quantity':'Quantidade contada')} (${escape(p.unit)})<input name="quantity" type="number" min="${kind==='receive'?(discrete?'1':'0.001'):'0'}" step="${discrete?'1':'0.001'}" ${kind==='adjust'?`value="${p.stock}"`:''} required></label>${reasons()}<p class="info-note">${en?'The operator and reason will appear in inventory history.':'O operador e o motivo ficarão no histórico do inventário.'}</p><button class="primary full">${labels.save}</button></form>`);
   d.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),reason=String(f.get('reason')).trim(),quantity=Number(f.get('quantity'));if(!reason)return toast(labels.missing);if(!Number.isFinite(quantity)||quantity<(kind==='receive'?0.001:0)||(discrete&&!Number.isInteger(quantity))||Math.abs(quantity*1000-Math.round(quantity*1000))>.00001)return toast(labels.failed);
    handle(d,'stock/movements',{id:opId,productId:p.id,kind,quantity,expectedStock:p.stock,reason},e.target.querySelector('button'));
   };
  }
 };
}

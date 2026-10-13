import {inventoryAlerts,updateAlertSettings} from './alerts.js';
import {formatExpiryDate} from './expiry.js';
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const strings={
 pt:{
  title:'Alertas de Stock e Validade',subtitle:'Identifique riscos, evite perdas e prepare a reposição de mercadorias.',all:'Todos',expired:'Vencidos',today:'Vence hoje',urgent:'Validade urgente',soon:'Próximos da validade',low:'Stock baixo',out:'Sem stock disponível',none:'Sem alertas para este filtro.',good:'Tudo controlado! Não existem alertas neste momento.',expiry:'Validade',days:'dias',daysLeft:'Faltam',overdue:'Vencido há',batch:'Lote',legacy:'Stock anterior sem lote',quantity:'Quantidade',available:'Disponível para venda',physical:'Stock físico',minimum:'Stock mínimo',units:'unidades',seeLots:'Ver lotes',receive:'Receber lote',settings:'Configurar alertas',settingsInfo:'Os limites são definidos por negócio. Os avisos são calculados com os dados actuais, sem envio automático.',expiryDays:'Avisar até quantos dias antes da validade',urgentDays:'Considerar urgente até quantos dias antes',reorderDays:'Cobertura desejada para reposição (dias)',reason:'Motivo da alteração',save:'Guardar configurações',saved:'Configurações de alertas guardadas.',failed:'Não foi possível guardar. Confira os valores ou actualize os dados.',conflict:'As configurações foram alteradas noutra sessão. Actualize e tente novamente.',recommendations:'Sugestões de reposição',replenishment:'Lista de compras sugerida',estimated:'Estimativa pelas vendas dos últimos 30 dias e pelo stock mínimo — confirme as quantidades antes de comprar.',bySales:'Base: vendas recentes e stock mínimo',byMinimum:'Base: stock mínimo (sem vendas recentes)',suggested:'Quantidade sugerida',target:'Stock pretendido',sales30:'Vendidas nos últimos 30 dias',prepare:'Preparar lista de compras',copy:'Copiar lista',copied:'Lista copiada.',whatsapp:'Partilhar no WhatsApp',noReplenish:'Sem necessidades de reposição calculadas.',search:'Pesquisar produto ou número de lote',filter:'Filtrar alertas',expSoon:'A vencer',noExpiry:'Sem validade registada',timezone:'Prazos calculados no horário de Moçambique.',noAutomatic:'As sugestões não criam encomendas, descontos ou notificações automaticamente.',todayLabel:'Hoje',configNotAllowed:'Só o proprietário ou gerente pode alterar os parâmetros.'
 },
 en:{
  title:'Stock and Expiry Alerts',subtitle:'Spot risks, prevent losses and plan replenishment.',all:'All',expired:'Expired',today:'Expires today',urgent:'Urgent expiry',soon:'Expiring soon',low:'Low stock',out:'No sellable stock',none:'No alerts match this filter.',good:'All clear! No current alerts.',expiry:'Expiry',days:'days',daysLeft:'Days left',overdue:'Expired',batch:'Batch',legacy:'Previous untracked stock',quantity:'Quantity',available:'Sellable stock',physical:'Physical stock',minimum:'Stock minimum',units:'units',seeLots:'View batches',receive:'Receive batch',settings:'Configure alerts',settingsInfo:'Thresholds are configured per business. Alerts use current data and do not send automatic messages.',expiryDays:'Warn how many days before expiry',urgentDays:'Mark urgent within how many days',reorderDays:'Replenishment target coverage (days)',reason:'Reason for changing settings',save:'Save settings',saved:'Alert settings saved.',failed:'Could not save. Check values or refresh.',conflict:'Settings were changed in another session. Refresh and try again.',recommendations:'Replenishment suggestions',replenishment:'Suggested shopping list',estimated:'Estimate from the last 30 days of sales and minimum stock. Verify quantities before purchasing.',bySales:'Basis: recent sales and minimum stock',byMinimum:'Basis: minimum stock (no recent sales)',suggested:'Suggested quantity',target:'Target stock',sales30:'Sold in past 30 days',prepare:'Prepare shopping list',copy:'Copy list',copied:'List copied.',whatsapp:'Share on WhatsApp',noReplenish:'No replenishment quantities currently suggested.',search:'Search product or batch number',filter:'Filter alerts',expSoon:'Expiring',noExpiry:'Expiry not defined',timezone:'Dates are calculated in Mozambique time.',noAutomatic:'Suggestions do not place orders, discount products or send automatic notifications.',todayLabel:'Today',configNotAllowed:'Only owners or managers can configure thresholds.'
 }
};
let filter={kind:'all',search:''};
const count=(summary,kind)=>kind==='expiry'?summary.counts.expired+summary.counts.today+summary.counts.urgent+summary.counts.soon:kind==='critical'?summary.counts.expired+summary.counts.today+summary.counts.out:summary.counts[kind]||0;
export function alertsHomeHTML({state,tenantId,lang}){
 const L=strings[lang]||strings.pt,summary=inventoryAlerts(state,tenantId);
 const high=count(summary,'critical'),expiry=count(summary,'expiry'),low=summary.counts.low+summary.counts.out;
 return `<section class="panel alerts-home"><div class="alerts-home-text"><span class="eyebrow">PRONTO POS · ${lang==='en'?'INVENTORY':'INVENTÁRIO'}</span><h2>🔔 ${safe(L.title)}</h2><p>${high?`${high} ${lang==='en'?'priority issues to review':'situações prioritárias por verificar'}`:L.good}</p><div class="alerts-home-counts"><span class="${high?'alert-count-critical':''}">${high} ${lang==='en'?'critical':'críticos'}</span><span>${expiry} ${lang==='en'?'expiry notices':'avisos de validade'}</span><span>${low} ${lang==='en'?'stock notices':'avisos de stock'}</span></div></div><button class="primary" type="button" data-page="alerts">${lang==='en'?'View alerts':'Consultar alertas'} →</button></section>`;
}
export function alertsPage({state,tenantId,lang,role}){
 const L=strings[lang]||strings.pt,summary=inventoryAlerts(state,tenantId),config=summary.settings;
 const searches=filter.search.trim().toLocaleLowerCase();
 const options=[['all',L.all],['critical',lang==='en'?'Critical':'Críticos'],['expired',L.expired],['today',L.today],['urgent',L.urgent],['soon',L.soon],['out',L.out],['low',L.low]];
 const chosen=summary.alerts.filter(a=>(filter.kind==='all'||(filter.kind==='critical'?['expired','today','out'].includes(a.type):a.type===filter.kind))&&(!searches||[a.productName,a.batchNumber||'',a.expiryDate||''].join(' ').toLocaleLowerCase().includes(searches)));
 const label=a=>a.type==='expired'?L.expired:a.type==='today'?L.today:a.type==='urgent'?L.urgent:a.type==='soon'?L.soon:a.type==='out'?L.out:L.low;
 const actions=a=>`<div class="alert-row-actions"><button class="secondary" type="button" data-alert-product="${safe(a.productId)}">${L.seeLots} →</button><button class="text-button" type="button" data-alert-receive="${safe(a.productId)}">＋ ${L.receive}</button></div>`;
 return `<div class="page-heading"><div><p class="eyebrow">PRONTO POS · INVENTÁRIO</p><h1 tabindex="-1">${L.title}</h1><p>${L.subtitle}</p></div>${['owner','manager'].includes(role)?`<button class="secondary" id="alert-settings">⚙ ${L.settings}</button>`:''}</div>
 <section class="management-stats alerts-stats">${[[L.expired,summary.counts.expired,'critical'],[L.today,summary.counts.today,'critical'],[L.urgent,summary.counts.urgent,'warning'],[L.out,summary.counts.out,'critical'],[L.low,summary.counts.low,'warning'],[L.soon,summary.counts.soon,'soon']].map(([n,v,k])=>`<article class="alert-stat ${v?'alert-stat-'+k:''}"><small>${n}</small><strong>${v}</strong></article>`).join('')}</section>
 <section class="panel alerts-main"><div class="panel-title"><div><h2>${lang==='en'?'Current alerts':'Alertas actuais'} <span class="alert-pill">${summary.total}</span></h2><small>${L.timezone} ${L.settingsInfo}</small></div></div>
 <div class="management-filters alerts-filters"><input type="search" id="alerts-search" placeholder="${L.search}" aria-label="${L.search}" value="${safe(filter.search)}"><select id="alerts-kind" aria-label="${L.filter}">${options.map(([id,name])=>`<option value="${id}" ${filter.kind===id?'selected':''}>${safe(name)}</option>`).join('')}</select></div>
 <div id="alerts-results" aria-live="polite">${chosen.length?chosen.map(a=>{
   const expiry=!!a.expiryDate,when=expiry?`${L.expiry}: ${safe(formatExpiryDate(a.expiryDate,lang))} · ${a.days<0?`${L.overdue} ${-a.days} ${L.days}`:a.days===0?L.todayLabel:`${L.daysLeft}: ${a.days}`}`:`${L.available}: ${a.available} ${safe(a.unit)} · ${L.minimum}: ${a.minimum} ${safe(a.unit)}`;
   const info=expiry?`${L.batch}: ${a.legacy?L.legacy:safe(a.batchNumber)} · ${L.quantity}: ${a.quantity} ${safe(a.unit)}`:`${L.physical}: ${a.physical} ${safe(a.unit)}`;
   return `<article class="alert-row alert-${safe(a.type)}"><div class="alert-row-main"><span class="alert-indicator" aria-hidden="true">${a.type==='expired'?'⛔':a.type==='out'?'🔴':a.type==='today'?'⚠️':a.type==='low'?'📉':'⏳'}</span><div class="grow"><strong>${safe(a.productName)}</strong><span class="alert-type alert-type-${safe(a.type)}">${safe(label(a))}</span><small>${when}</small><small>${info}</small></div></div>${actions(a)}</article>`;
 }).join(''):`<p class="empty">${summary.total?L.none:L.good}</p>`}</div></section>
 <section class="panel alert-reorder"><div class="panel-title"><div><h2>🛒 ${L.recommendations}</h2><p class="form-hint">${L.estimated}</p></div><button class="primary" id="alert-shopping-list" type="button" ${summary.recommendations.length?'':'disabled'}>${L.prepare}</button></div>
 ${summary.recommendations.length?`<div class="alert-reorder-list">${summary.recommendations.map(a=>`<div class="alert-reorder-item"><div class="grow"><strong>${safe(a.productName)}</strong><small>${L.available}: ${a.available} ${safe(a.unit)} · ${L.minimum}: ${a.minimum} ${safe(a.unit)}</small><small>${a.basis==='sales_and_minimum'?L.bySales:L.byMinimum} · ${L.sales30}: ${a.sold30}</small></div><div class="alert-suggest"><small>${L.suggested}</small><strong>＋${a.quantity} ${safe(a.unit)}</strong><button class="text-button" type="button" data-alert-receive="${safe(a.productId)}">${L.receive}</button></div></div>`).join('')}</div>`:`<p class="empty">${L.noReplenish}</p>`}
 <p class="info-note">${L.noAutomatic}</p></section>`;
}
export function bindAlertActions({getState,getTenantId,getRole,lang,remote,submit,apply,reload,render,modal,toast,openStock}){
 const L=strings[lang]||strings.pt;
 const filters={search:document.querySelector('#alerts-search'),kind:document.querySelector('#alerts-kind')};
 if(filters.search)filters.search.oninput=()=>{
  filter.search=filters.search.value;
  const old=filters.search.selectionStart;
  // Keep the cursor and focus intact while refreshing search results.
  const html=alertsPage({state:getState(),tenantId:getTenantId(),lang,role:getRole()});
  const fragment=document.createElement('template');fragment.innerHTML=html;
  const results=fragment.content.querySelector('#alerts-results');
  const current=document.querySelector('#alerts-results');
  if(results&&current){current.innerHTML=results.innerHTML;bindButtons(current);}
 };
 if(filters.kind)filters.kind.onchange=()=>{filter.kind=filters.kind.value;render();};
 const receive=async(id,mode)=>{try{await openStock(id,mode);}catch{toast(L.failed);}};
 function bindButtons(root){
  root.querySelectorAll('[data-alert-product]').forEach(button=>button.onclick=()=>receive(button.dataset.alertProduct,'lots'));
  root.querySelectorAll('[data-alert-receive]').forEach(button=>button.onclick=()=>receive(button.dataset.alertReceive,'receive'));
 }
 bindButtons(document);
 const configure=document.querySelector('#alert-settings');
 if(configure)configure.onclick=()=>{
  if(!['owner','manager'].includes(getRole()))return toast(L.configNotAllowed);
  const v=inventoryAlerts(getState(),getTenantId()).settings;
  const d=modal(`<h2>⚙ ${L.settings}</h2><p class="info-note">${L.settingsInfo}</p><form><label>${L.expiryDays}<input type="number" name="expiryDays" min="1" max="180" step="1" value="${v.expiryDays}" required></label><label>${L.urgentDays}<input type="number" name="urgentDays" min="1" max="180" step="1" value="${v.urgentDays}" required></label><label>${L.reorderDays}<input type="number" name="reorderDays" min="1" max="90" step="1" value="${v.reorderDays}" required></label><label>${L.reason}<textarea name="reason" maxlength="250" required></textarea></label><button class="primary full">${L.save}</button></form>`);
  const form=d.querySelector('form');
  form.onsubmit=async e=>{
   e.preventDefault();const input=new FormData(form),expiryDays=Number(input.get('expiryDays')),urgentDays=Number(input.get('urgentDays')),reorderDays=Number(input.get('reorderDays')),reason=String(input.get('reason')||'').trim();
   if(!reason||![expiryDays,urgentDays,reorderDays].every(Number.isSafeInteger)||expiryDays<1||expiryDays>180||urgentDays<1||urgentDays>expiryDays||reorderDays<1||reorderDays>90)return toast(L.failed);
   const body={expiryDays,urgentDays,reorderDays,expectedRevision:v.revision,reason,tenantId:getTenantId()};
   const button=form.querySelector('button');button.disabled=true;
   try{
    if(remote)await submit('alerts/settings',body);
    else await apply(state=>updateAlertSettings(state,body,{id:'demo',tenantId:getTenantId(),role:getRole()}));
    d.close();render();toast(L.saved);
   }catch(error){button.disabled=false;if(error?.message==='revision_conflict'){d.close();try{await reload();}catch{}toast(L.conflict);}else toast(L.failed);}
  };
 };
 const list=document.querySelector('#alert-shopping-list');
 if(list)list.onclick=()=>{
  const summary=inventoryAlerts(getState(),getTenantId());
  const shop=(getState().tenants||[]).find(t=>t.id===getTenantId())?.name||'Pronto POS';
  const content=[L.replenishment+' — '+shop,...summary.recommendations.map((p,i)=>`${i+1}. ${p.productName} — ${p.quantity} ${p.unit} (${L.available}: ${p.available})`),'',L.estimated].join('\n');
  const d=modal(`<h2>🛒 ${L.replenishment}</h2><p class="info-note">${L.estimated}</p><textarea id="alert-list-text" readonly rows="12" class="alert-list-copy">${safe(content)}</textarea><div class="alert-share-actions"><button type="button" class="secondary" id="alert-copy">${L.copy}</button><a class="primary" id="alert-whatsapp" href="https://wa.me/?text=${encodeURIComponent(content)}" target="_blank" rel="noopener noreferrer">${L.whatsapp} ↗</a></div>`);
  d.querySelector('#alert-copy').onclick=async()=>{
   const text=d.querySelector('#alert-list-text');
   try{await navigator.clipboard.writeText(text.value);toast(L.copied);}
   catch{text.select();toast(lang==='en'?'Select and copy the list.':'Seleccione e copie a lista.');}
  };
 };
}

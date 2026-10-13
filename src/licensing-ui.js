const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const dict={
 pt:{plans:'Planos comerciais',add:'Criar plano',plan:'Plano',price:'Preço por período (MT)',days:'Duração (dias)',enabled:'Disponível',disabled:'Desactivado',disable:'Desactivar plano',enable:'Activar plano',legacy:'Sem licença atribuída (acesso legado)',active:'Licença activa',expired:'Licença expirada',cancelled:'Licença cancelada',expires:'Validade',noPlans:'Ainda não existem planos. Crie o primeiro para atribuir licenças.',assign:'Atribuir licença',renew:'Renovar licença',cancel:'Cancelar licença',periods:'Número de períodos',reason:'Motivo / autorização administrativa',reference:'Referência de pagamento (opcional)',confirm:'Confirmar',noAutomatic:'Esta operação não cobra dinheiro automaticamente nem comprova pagamentos. Confirme qualquer recebimento fora do Pronto POS.',warning:'O acesso do comerciante ficará bloqueado se a licença expirar ou for cancelada. Os dados serão preservados.',existing:'Uma licença ainda válida não pode ser substituída por outro plano. Renove-a ou aguarde que termine.',audit:'Histórico da licença',none:'Sem operações de licença registadas.',saved:'Alteração de licenciamento guardada.',failed:'Não foi possível efectuar a operação.',changed:'A licença foi alterada noutra sessão. Dados recarregados.',choose:'Escolher plano',noEnabled:'Não existem planos disponíveis.',fee:'Preço definido pelo administrador',trial:'Pode criar um plano gratuito (0 MT) para testes, com uma duração própria.',actions:'Licenciamento',period:'período(s)',money:'MT'},
 en:{plans:'Commercial plans',add:'Create plan',plan:'Plan',price:'Price per term (MZN)',days:'Duration (days)',enabled:'Available',disabled:'Disabled',disable:'Deactivate plan',enable:'Activate plan',legacy:'No licence assigned (legacy access)',active:'Active licence',expired:'Expired licence',cancelled:'Cancelled licence',expires:'Valid until',noPlans:'No plans yet. Create one before assigning licences.',assign:'Assign licence',renew:'Renew licence',cancel:'Cancel licence',periods:'Number of terms',reason:'Reason / administrative approval',reference:'Payment reference (optional)',confirm:'Confirm',noAutomatic:'This does not collect money or verify payments automatically. Confirm any receipt outside Pronto POS.',warning:'The merchant will lose access when the licence expires or is cancelled. Data is preserved.',existing:'An active licence cannot be replaced with a different plan. Renew it or wait until it expires.',audit:'Licence history',none:'No licence activity recorded.',saved:'Licensing change saved.',failed:'Could not complete this operation.',changed:'The licence was changed in another session. The latest data has been loaded.',choose:'Choose plan',noEnabled:'No enabled plans available.',fee:'Administrator-defined price',trial:'Create a free plan (0 MZN) with its own duration for trials.',actions:'Licensing',period:'term(s)',money:'MZN'}
};
const labels=lang=>dict[lang]||dict.pt;
const money=(c,lang)=>((c||0)/100).toLocaleString(lang==='en'?'en-GB':'pt-MZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+labels(lang).money;
const date=(v,lang)=>v?new Date(v).toLocaleDateString(lang==='en'?'en-GB':'pt-MZ',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}):'—';
const names=(state)=>new Map((state.plans||[]).map(p=>[p.id,p.name]));
export function licenseBadge(license,lang){
 const L=labels(lang),status=license?.status||'legacy';
 const name=({legacy:L.legacy,active:L.active,expired:L.expired,cancelled:L.cancelled})[status]||L.legacy;
 return `<span class="license-pill license-${safe(status)}">${safe(name)}</span>`;
}
export function planPanelHTML({state,lang,remote}){
 const L=labels(lang),plans=state.plans||[];
 if(!remote)return `<section class="panel"><h2>${L.plans}</h2><p>${lang==='en'?'Plan management requires authenticated server mode.':'A gestão de planos exige o modo autenticado do servidor.'}</p></section>`;
 return `<section class="panel licensing-panel" id="licensing-panel"><div class="panel-title"><div><h2>${L.plans}</h2><p class="small-muted">${L.noAutomatic}</p></div><button class="primary" id="new-plan">＋ ${L.add}</button></div>
 <p class="info-note">${L.trial}</p><div class="license-plans">${plans.length?plans.map(p=>`<article class="license-plan-card"><div><strong>${safe(p.name)}</strong><small>${money(p.priceCents,lang)} / ${p.durationDays} ${L.days.toLowerCase()}</small><span class="license-pill ${p.active?'license-active':'license-cancelled'}">${p.active?L.enabled:L.disabled}</span></div><button class="secondary" data-plan-status="${safe(p.id)}">${p.active?L.disable:L.enable}</button></article>`).join(''):`<p class="empty">${L.noPlans}</p>`}</div></section>`;
}
export function licenseDetailHTML({business,state,lang,remote}){
 if(!remote)return '';
 const L=labels(lang),license=business.license||{status:'legacy'},plans=names(state),events=(state.licenseEvents||[]).filter(e=>e.tenantId===business.id).slice(0,12);
 return `<section class="license-detail"><h3>${L.actions}</h3>${licenseBadge(license,lang)}
  <p>${license.planName?safe(license.planName)+' · '+money(license.priceCents,lang)+' / '+license.durationDays+' '+L.days.toLowerCase():'—'}</p>
  ${license.expiresAt?`<p class="small-muted">${L.expires}: <strong>${date(license.expiresAt,lang)} (UTC)</strong></p>`:''}
  <div class="business-detail-actions">${license.status!=='active'?`<button type="button" class="secondary" id="license-assign">${L.assign}</button>`:''}
   ${license.status!=='legacy'?`<button type="button" class="primary" id="license-renew">${L.renew}</button>`:''}
   ${license.status==='active'?`<button type="button" class="secondary danger-outline" id="license-cancel">${L.cancel}</button>`:''}
  </div><p class="info-note">${L.noAutomatic}</p>
  <h4>${L.audit}</h4>${events.length?events.map(e=>`<div class="business-event"><strong>${safe(e.action)} · ${safe(plans.get(e.planId)||'—')}</strong><small>${safe(e.actorName)} · ${date(e.createdAt,lang)} (UTC)</small><p>${safe(e.reason)}${e.reference?' · '+safe(e.reference):''}</p></div>`).join(''):`<p class="empty">${L.none}</p>`}</section>`;
}
export function makeLicensingActions({getState,submit,reload,render,modal,toast,lang}){
 const L=labels(lang);
 async function action(d,route,body,button){
  button.disabled=true;
  try{await submit(route,body);d.close();render();toast(L.saved);}
  catch(error){
   button.disabled=false;
   if(['revision_conflict','license_already_active','operation_conflict'].includes(error?.message)){d.close();try{await reload();}catch{}toast(L.changed);}
   else toast(L.failed);
  }
 }
 function createPlan(){
  const d=modal(`<h2>${L.add}</h2><form><label>${L.plan}<input name="name" maxlength="80" required></label><label>${L.price}<input type="number" name="price" min="0" step="0.01" required></label><label>${L.days}<input type="number" name="durationDays" min="1" max="3660" step="1" required></label><p class="info-note">${L.noAutomatic}</p><button class="primary full">${L.confirm}</button></form>`);
  d.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),price=Number(f.get('price')),durationDays=Number(f.get('durationDays')),name=String(f.get('name')||'').trim();
   if(!name||!Number.isFinite(price)||price<0||!Number.isSafeInteger(Math.round(price*100))||Math.abs(price*100-Math.round(price*100))>0.00001||!Number.isSafeInteger(durationDays)||durationDays<1||durationDays>3660){toast(L.failed);return;}
   action(d,'plans',{name,priceCents:Math.round(price*100),durationDays},e.target.querySelector('button'));
  };
 }
 function planStatus(id){
  const plan=(getState().plans||[]).find(p=>p.id===id);if(!plan)return;
  const d=modal(`<h2>${plan.active?L.disable:L.enable}</h2><p>${safe(plan.name)}</p><p class="info-note">${L.existing}</p><button type="button" class="primary full" id="plan-status-confirm">${L.confirm}</button>`);
  d.querySelector('#plan-status-confirm').onclick=()=>action(d,'plans/status',{planId:plan.id,active:!plan.active},d.querySelector('#plan-status-confirm'));
 }
 function subscription(businessId,kind){
  const business=(getState().tenants||[]).find(b=>b.id===businessId);if(!business)return;
  const license=business.license||{status:'legacy',revision:0},opId=crypto.randomUUID(),plans=(getState().plans||[]).filter(p=>p.active);
  if(kind==='assign'&&!plans.length){toast(L.noEnabled);return;}
  const details=kind==='assign'?`<label>${L.choose}<select name="planId">${plans.map(p=>`<option value="${safe(p.id)}">${safe(p.name)} · ${money(p.priceCents,lang)} / ${p.durationDays} ${L.days.toLowerCase()}</option>`).join('')}</select></label>`:kind==='renew'?`<label>${L.periods}<input type="number" name="periods" min="1" max="12" step="1" value="1" required></label><label>${L.reference}<input name="reference" maxlength="100"></label>`:'';
  const heading=kind==='assign'?L.assign:kind==='renew'?L.renew:L.cancel;
  const d=modal(`<h2>${heading}</h2><p><strong>${safe(business.name)}</strong></p><form>${details}<label>${L.reason}<textarea name="reason" maxlength="250" required rows="3"></textarea></label><p class="info-note">${L.noAutomatic} ${L.warning}</p><button class="primary full">${L.confirm}</button></form>`);
  d.querySelector('form').onsubmit=e=>{
   e.preventDefault();const data=new FormData(e.target),reason=String(data.get('reason')||'').trim();
   if(!reason){toast(L.failed);return;}
   const input={businessId,expectedRevision:license.revision||0,reason};
   if(kind==='assign')Object.assign(input,{operationId:opId,planId:String(data.get('planId'))});
   if(kind==='renew'){const periods=Number(data.get('periods'));if(!Number.isSafeInteger(periods)||periods<1||periods>12){toast(L.failed);return;}Object.assign(input,{operationId:opId,periods,reference:String(data.get('reference')||'').trim()});}
   action(d,'licenses/'+kind,input,e.target.querySelector('button'));
  };
 }
 return {
  bindDashboard(root){root.querySelector('#new-plan')?.addEventListener('click',createPlan);root.querySelectorAll('[data-plan-status]').forEach(el=>el.addEventListener('click',()=>planStatus(el.dataset.planStatus)));},
  bindBusiness(root,businessId){for(const kind of ['assign','renew','cancel'])root.querySelector('#license-'+kind)?.addEventListener('click',()=>{root.close();subscription(businessId,kind);});}
 };
}

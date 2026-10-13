import {inventoryAlerts} from './alerts.js';
export function alertPriorityCounts(state,tenantId){
 const {counts,total}=inventoryAlerts(state,tenantId);
 return {total,critical:counts.expired+counts.today+counts.out,warning:counts.urgent+counts.low,notice:counts.soon};
}
export function alertBadgeHTML(state,tenantId,lang='pt'){
 const {total,critical}=alertPriorityCounts(state,tenantId);
 if(!total)return '';
 const number=total>99?'99+':String(total);
 const label=lang==='en'?`${total} inventory alerts`:`${total} alertas de stock e validade`;
 return `<span class="nav-alert-badge ${critical?'nav-alert-badge-critical':''}" role="status" aria-label="${label}" title="${label}">${number}</span>`;
}
export function alertPriorityBannerHTML(state,tenantId,lang='pt'){
 const {total,critical,warning}=alertPriorityCounts(state,tenantId);
 const en=lang==='en';
 const msg=critical?(en?`${critical} critical inventory alerts need attention.`:`${critical} alertas críticos de stock ou validade precisam de atenção.`):warning?(en?`${warning} inventory warnings need review.`:`${warning} avisos de stock ou validade precisam de revisão.`):total?(en?`${total} notices to review.`:`${total} avisos para consultar.`):(en?'No current stock or expiry alerts.':'Sem alertas de stock ou validade neste momento.');
 return `<div class="alerts-priority-banner ${critical?'priority-critical':warning?'priority-warning':'priority-ok'}" role="status"><span aria-hidden="true">${critical?'●':warning?'◆':'✓'}</span><strong>${msg}</strong></div>`;
}

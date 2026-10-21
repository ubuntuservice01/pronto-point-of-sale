// PIN scene: dynamic, scoped aggregate values. Never invent sales figures.
// Data are held in RAM for the current authenticated session only.
import {MONEY,esc} from './supabase-shop-core.js';
// Runtime-only cache. No KPIs or business identifiers survive closing this tab.
let activeMetrics=null;
export function setPinKPIs(value){
 activeMetrics=value&&validatePinKPIs(value,value.userId)?value:null;
 return activeMetrics;
}
export function readPinKPIs(userId){
 return validatePinKPIs(activeMetrics,userId);
}
export function clearPinKPIs(userId){
 if(!userId||activeMetrics?.userId===userId)activeMetrics=null;
}
const fmtCount=n=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:0}).format(n);
const positive=n=>Number.isSafeInteger(n)&&n>=0;
export function getPinKPIs({today,month,businessId,branchId,userId,shopName,role}={}){
 const daily=today?.totals,monthly=month?.totals;
 if(!positive(daily?.gross)||!positive(monthly?.gross)||!positive(daily?.salesCount)||!positive(monthly?.salesCount)||
 !/^[0-9a-f-]{36}$/i.test(String(businessId||''))||!/^[0-9a-f-]{36}$/i.test(String(userId||'')))
  return null;
 return Object.freeze({userId,businessId,branchId:String(branchId||''),
  shopName:String(shopName||'A sua loja').slice(0,80),role:String(role||''),
  todayCents:daily.gross,monthCents:monthly.gross,todayCount:daily.salesCount,monthCount:monthly.salesCount,
  at:Date.now()});
}
export function validatePinKPIs(value,userId){
 if(!value||value.userId!==userId||Date.now()-value.at>15*60*1000||value.at>Date.now()+30000||
 !positive(value.todayCents)||!positive(value.monthCents)||!positive(value.todayCount)||!positive(value.monthCount)||
 !/^[0-9a-f-]{36}$/i.test(value.businessId))return null;
 return value;
}
const mozMap='<svg viewBox="0 0 128 190" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'+
 '<path d="M26 3 L62 6 L75 29 L92 34 L84 58 L110 64 L121 82 L96 102 L108 115 L86 132 L87 147 L67 161 L54 187 L43 163 L47 142 L31 126 L40 104 L25 91 L42 72 L17 56 L29 39 L21 22 Z" fill="#0b806d" fill-opacity=".28" stroke="#34d6aa" stroke-width="3" stroke-linejoin="round"/>'+
 '<path d="M75 55 L73 132" stroke="#a3ffe0" stroke-opacity=".4" stroke-dasharray="3 5"/>'+
 '<circle cx="72" cy="120" r="9" fill="#b7ffd9"/><circle cx="72" cy="120" r="4" fill="#058c6a"/></svg>';
export function pinCityBackdrop({metrics}={}){
 const m=metrics||null;
 return '<div class="pin-city-landscape" aria-hidden="true"><div class="pin-city-stars"></div></div>'+
 '<div class="pin-city-layout" aria-hidden="true">'+
  '<aside class="pin-city-stats pin-city-stats-left">'+
   '<div class="pin-city-float pin-city-today"><small>Vendas de hoje</small>'+
    '<strong data-pin-kpi="today">'+(m?esc(MONEY(m.todayCents)):'—')+'</strong>'+
    '<span class="pin-city-sparkline">▁ ▂ ▃ ▂ ▄ ▅ ▃ ▆ ▇</span>'+
    '<p>Os seus resultados, todos os dias</p></div>'+
   '<div class="pin-city-float pin-city-map">'+mozMap+
    '<div><strong>Moçambique</strong><small>Sempre em movimento</small>'+
    '<span>◉ Pessoas</span><span>▣ Negócios</span><span>✦ Comunidades</span>'+
    '<span class="pin-city-green">Um futuro maior</span></div></div>'+
  '</aside>'+
  '<aside class="pin-city-stats pin-city-stats-right">'+
   '<div class="pin-city-float pin-city-month"><small>Vendas deste mês</small>'+
    '<strong data-pin-kpi="month">'+(m?esc(MONEY(m.monthCents)):'—')+'</strong>'+
    '<span>Os seus números, sem estimativas</span></div>'+
   '<div class="pin-city-float pin-city-transactions"><small>Transacções hoje</small>'+
    '<strong data-pin-kpi="todayCount">'+(m?esc(fmtCount(m.todayCount)):'—')+'</strong>'+
    '<span class="pin-city-steps"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div>'+
   '<div class="pin-city-float pin-city-message"><strong>Negócios de hoje.<br>Um Moçambique<br>mais forte amanhã.</strong>'+
    '<span class="pin-city-message-rule"></span></div>'+
   '<div class="pin-city-float pin-city-transactions-month"><small>Transacções deste mês</small>'+
    '<strong data-pin-kpi="monthCount">'+(m?esc(fmtCount(m.monthCount)):'—')+'</strong></div>'+
  '</aside>'+
 '</div>';
}
export function updatePinCityBackdrop(root,metrics){
 for(const [key,value] of Object.entries({
  today:metrics?MONEY(metrics.todayCents):'—',
  month:metrics?MONEY(metrics.monthCents):'—',
  todayCount:metrics?fmtCount(metrics.todayCount):'—',
  monthCount:metrics?fmtCount(metrics.monthCount):'—'
 })){
  const node=root?.querySelector('[data-pin-kpi="'+key+'"]');
  if(node)node.textContent=value;
 }
}

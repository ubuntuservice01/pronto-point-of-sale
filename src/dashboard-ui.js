import {commercialReport} from './commercial.js';
import {debtBalance} from './debts.js';
import {sellableQty} from './batches.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=(at=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export function dashboardMetrics(state,tenantId,at=new Date()){
 const now=day(at),start=new Date(at.getTime()-6*86400000),from=day(start);
 const report=commercialReport(state,tenantId,{from:now,to:now});
 const week=commercialReport(state,tenantId,{from,to:now});
 const debt=(state.debts||[]).filter(d=>d.tenantId===tenantId).reduce((n,d)=>n+debtBalance(state,d),0);
 const low=(state.products||[]).filter(p=>p.tenantId===tenantId&&p.active!==false&&sellableQty(state,p)<=p.min).length;
 const sold=new Map();
 const refundIds=new Set((state.refunds||[]).filter(r=>r.tenantId===tenantId).map(r=>r.saleId));
 for(const sale of state.sales||[])if(sale.tenantId===tenantId&&!refundIds.has(sale.id))for(const line of sale.lines||[]){
  const p=sold.get(line.productId)||{name:line.name,quantity:0};
  p.quantity+=Number(line.quantity||0);sold.set(line.productId,p);
 }
 const top=[...sold.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,5);
 const days=Array.from({length:7},(_,i)=>day(new Date(at.getTime()-(6-i)*86400000)));
 const salesDays=new Map(week.daily.map(x=>[x.date,x.total]));
 return {report,week,debt,low,top,days,values:days.map(d=>salesDays.get(d)||0)};
}
export function dashboardInsightsHTML(state,tenantId,{lang='pt',money,showFinances=true,showDebts=true,at=new Date()}={}){
 const en=lang==='en',m=dashboardMetrics(state,tenantId,at),p=m.report;
 const cards=[
  [en?'Today’s sales':'Vendas de hoje',money(p.net),'↗'],
  [en?'Transactions today':'Vendas realizadas',p.transactions,'✓'],
  [en?'Low-stock products':'Stock baixo',m.low,'!']
 ];
 if(showFinances)cards.splice(1,0,[p.completeCostData?(en?'Estimated operating result':'Resultado operacional estimado'):(en?'Partial gross margin':'Margem bruta parcial'),money(p.completeCostData?p.netOperatingResult:p.estimatedGrossMargin),'◈']);
 if(showDebts)cards.push([en?'Outstanding debts':'Dívidas por receber',money(m.debt),'▤']);
 const max=Math.max(1,...m.values);
 return `<section class="merchant-insights" aria-label="${en?'Business overview':'Resumo do negócio'}">
 <div class="merchant-insights-grid">${cards.map(([label,value,mark])=>`<article class="merchant-insight"><span class="merchant-insight-symbol" aria-hidden="true">${mark}</span><small>${escape(label)}</small><strong>${escape(value)}</strong></article>`).join('')}</div>
 ${showFinances?`<p class="merchant-margin-note">${p.completeCostData?(en?'Estimated result after recorded expenses; may exclude other costs.':'Resultado estimado após despesas registadas; pode excluir outros custos.'):(en?'Gross margin uses only sales with recorded costs; not net profit.':'Margem bruta calculada apenas com custos conhecidos; não é lucro líquido.')}</p>`:''}
 <div class="merchant-insights-bottom">
 ${showFinances?`<article class="panel merchant-chart"><h2>${en?'Sales · last 7 days':'Vendas · últimos 7 dias'}</h2><div class="merchant-chart-bars" role="img" aria-label="${en?'Daily sales chart':'Gráfico de vendas diárias'}">${m.days.map((date,i)=>`<div class="merchant-chart-day" title="${escape(date)}: ${escape(money(m.values[i]))}"><span class="merchant-chart-track"><i style="height:${Math.max(m.values[i]?6:2,Math.round(m.values[i]/max*100))}%"></i></span><small>${escape(date.slice(8))}</small></div>`).join('')}</div><p class="merchant-chart-caption">${en?'Last seven calendar days · Mozambique time':'Últimos sete dias · hora de Moçambique'}</p></article>`:''}
 <article class="panel merchant-top"><h2>${en?'Top 5 products':'5 produtos mais vendidos'}</h2>${m.top.length?m.top.map((x,i)=>`<div class="merchant-top-row"><span>${i+1}</span><strong>${escape(x.name)}</strong><small>${escape(x.quantity)}</small></div>`).join(''):`<p class="empty">${en?'No sales recorded yet.':'Ainda não há vendas registadas.'}</p>`}</article>
 </div></section>`;
}

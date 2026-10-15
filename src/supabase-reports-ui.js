// Financial management reports for authenticated Supabase users.
// Reports are operational and provisional, NOT fiscal certificates or invoices.
import {esc,MONEY} from './supabase-shop-core.js';
const amount=n=>MONEY(Number(n)||0);
const n=x=>Number(x)||0;
const safe=s=>String(s??'');
const cell=s=>'<td>'+esc(s)+'</td>';
const title=(text,body)=>'<section class="shop-box"><h3>'+esc(text)+'</h3>'+body+'</section>';
const dateLabel=s=>safe(s).slice(0,10);
export function normalizeReports(raw){
 if(!raw||!raw.totals||!['by_method','by_seller','by_product','by_branch','expenses_by_category'].every(k=>Array.isArray(raw[k])))
  throw Error('reports_invalid');
 const t=raw.totals;
 return {
  totals:{salesCount:n(t.sales_count),gross:n(t.gross_sales_cents),returns:n(t.returns_cents),
   net:n(t.net_sales_cents),received:n(t.received_cents),expenses:n(t.expenses_cents),
   cost:n(t.cogs_estimated_cents),unknownCosts:n(t.cogs_missing_lines),
   grossProfit:t.gross_profit_estimated_cents===null?null:n(t.gross_profit_estimated_cents),
   netProfit:t.net_profit_estimated_cents===null?null:n(t.net_profit_estimated_cents),
   debts:n(t.total_unpaid_debts_cents),openCash:n(t.cash_sessions_open)},
  methods:raw.by_method.map(x=>({name:safe(x.method),amount:n(x.collected_cents)})),
  sellers:raw.by_seller.map(x=>({id:x.user_id,name:safe(x.name),count:n(x.sales_count),amount:n(x.gross_cents)})),
  products:raw.by_product.map(x=>({id:x.product_id,name:safe(x.name),qty:n(x.quantity),revenue:n(x.revenue_cents)})),
  branches:raw.by_branch.map(x=>({id:x.branch_id,name:safe(x.name),count:n(x.sales_count),amount:n(x.gross_cents)})),
  categories:raw.expenses_by_category.map(x=>({name:safe(x.category),amount:n(x.total_cents)})),
  start:raw.start,end:raw.end,generatedAt:raw.generated_at,
  branchId:raw.branch_id
 };
}
function rows(items,cols){
 return '<div class="credit-list"><table class="shop-table"><thead><tr>'+
  cols.map(c=>'<th>'+esc(c.title)+'</th>').join('')+'</tr></thead><tbody>'+
  items.map(x=>'<tr>'+cols.map(c=>cell(c.print(x))).join('')+'</tr>').join('')+
  '</tbody></table></div>';
}
export function renderReportsView({report,from,to,scope='branch',allAllowed=false}={}){
 const top='<form id="shop-reports-form" class="shop-form">'+
  '<label>De<input name="from" type="date" required value="'+esc(from||'')+'"></label>'+
  '<label>Até<input name="to" type="date" required value="'+esc(to||'')+'"></label>'+
  (allAllowed?'<label>Abrangência<select name="scope">'+
   '<option value="branch"'+(scope==='branch'?' selected':'')+'>Filial actual</option>'+
   '<option value="all"'+(scope==='all'?' selected':'')+'>Todas as filiais da empresa</option></select></label>':'')+
  '<button type="submit" class="shop-submit">Actualizar relatórios</button></form>';
 const lead=title('Relatórios financeiros e operacionais',
  '<p class="shop-help">Valores em meticais, filtrados pela empresa e pelas permissões. Relatório interno NÃO fiscal. O valor de vendas inclui crédito por receber; recebimentos e dívidas são indicadores separados.</p>'+
  top+(report?'<p class="shop-help">Actualizado em '+esc(dateLabel(report.generatedAt))+'</p>':''));
 if(!report)return lead+'<section class="shop-box"><p>Escolha o período e clique em «Actualizar relatórios».</p></section>';
 const t=report.totals;
 const metrics=[
  ['Vendas registadas',amount(t.gross)],['Devoluções',amount(t.returns)],
  ['Vendas líquidas',amount(t.net)],['Recebimentos líquidos',amount(t.received)],
  ['Despesas',amount(t.expenses)],['Custo estimado das mercadorias',amount(t.cost)],
  ['Dívidas ainda por receber',amount(t.debts)],['Vendas realizadas',t.salesCount],
  ['Caixas abertos',t.openCash],['Lucro bruto estimado',t.grossProfit===null?'Indisponível':amount(t.grossProfit)],
  ['Lucro líquido estimado',t.netProfit===null?'Indisponível':amount(t.netProfit)]
 ];
 const cards='<div class="shop-metric-grid">'+metrics.map(([label,value])=>
  '<div class="shop-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('')+'</div>';
 const warning=t.unknownCosts?
  '<p class="credit-warning">'+t.unknownCosts+' saída(s) de stock sem custo de compra registado. O lucro real não pode ser calculado com rigor.</p>':
  '<p class="shop-help">O lucro é estimado: não equivale ao lucro contabilístico ou fiscal. Podem faltar impostos, descontos adicionais, custos indirectos, devoluções e encargos.</p>';
 const tables='<div class="shop-two">'+
  title('Recebimentos por meio',rows(report.methods,[
   {title:'Meio',print:x=>x.name},{title:'Valor líquido',print:x=>amount(x.amount)}]))+
  title('Vendas por operador',rows(report.sellers,[
   {title:'Colaborador',print:x=>x.name},{title:'Vendas',print:x=>x.count},{title:'Montante',print:x=>amount(x.amount)}]))+
  title('Artigos mais vendidos',rows(report.products,[
   {title:'Produto',print:x=>x.name},{title:'Quantidade',print:x=>x.qty},{title:'Vendas',print:x=>amount(x.revenue)}]))+
  title('Filiais',rows(report.branches,[
   {title:'Filial',print:x=>x.name},{title:'Vendas',print:x=>x.count},{title:'Montante',print:x=>amount(x.amount)}]))+
  title('Despesas por categoria',rows(report.categories,[
   {title:'Categoria',print:x=>x.name},{title:'Total',print:x=>amount(x.amount)}]))+'</div>';
 return lead+cards+warning+
 '<button type="button" data-report-export class="shop-submit">Exportar relatório CSV</button>'+tables;
}
export function reportsCSV(report){
 if(!report)return '';
 const t=report.totals;
 const rows=[['Secção','Nome','Quantidade','Valor_MZN'],
  ['Resumo','Vendas brutas',t.salesCount,(t.gross/100).toFixed(2)],
  ['Resumo','Devoluções','',(t.returns/100).toFixed(2)],
  ['Resumo','Vendas líquidas','',(t.net/100).toFixed(2)],
  ['Resumo','Recebimentos','',(t.received/100).toFixed(2)],
  ['Resumo','Despesas','',(t.expenses/100).toFixed(2)],
  ['Resumo','Lucro líquido estimado','',t.netProfit===null?'Indisponível':(t.netProfit/100).toFixed(2)]];
 for(const x of report.methods)rows.push(['Recebimentos',x.name,'',(x.amount/100).toFixed(2)]);
 for(const x of report.sellers)rows.push(['Operadores',x.name,x.count,(x.amount/100).toFixed(2)]);
 for(const x of report.products)rows.push(['Produtos',x.name,x.qty,(x.revenue/100).toFixed(2)]);
 for(const x of report.branches)rows.push(['Filiais',x.name,x.count,(x.amount/100).toFixed(2)]);
 for(const x of report.categories)rows.push(['Despesas',x.name,'',(x.amount/100).toFixed(2)]);
 return '\uFEFF'+rows.map(row=>row.map(value=>{
  const raw=String(value??'');const neutral=/^\s*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
  return '"'+neutral.replace(/"/g,'""')+'"';
 }).join(';')).join('\r\n');
}

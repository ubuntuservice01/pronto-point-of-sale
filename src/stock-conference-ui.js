// Physical stock reconciliation report. Read-only and scoped to the authorised branch.
import {esc} from './supabase-shop-core.js';

const iso=date=>/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))&&!Number.isNaN(Date.parse(date+'T00:00:00Z')) &&
 new Date(Date.parse(date+'T00:00:00Z')).toISOString().slice(0,10)===date;
export function stockConferenceRange(today,period='1',from='',to=''){
 if(!iso(today))throw Error('stock_conference_date');
 if(period==='custom'){
  if(!iso(from)||!iso(to)||from>to||to>today ||
    (Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000>3660)throw Error('stock_conference_date');
  return {from,to};
 }
 if(!['1','3','6'].includes(period))throw Error('stock_conference_period');
 const [year,month]=today.split('-').map(Number);
 const start=new Date(Date.UTC(year,month-Number(period),1)).toISOString().slice(0,10);
 return {from:start,to:today};
}
const num=value=>{
 const n=Number(value);
 if(value===null||value===undefined||value===''||!Number.isFinite(n))throw Error('stock_conference_invalid');
 return n;
};
export function normalizeStockConference(raw){
 if(!raw||!Array.isArray(raw.rows)||!iso(raw.from)||!iso(raw.to)||
    raw.rows.length>2000||raw.total_products!==raw.rows.length)throw Error('stock_conference_invalid');
 const rows=raw.rows.map(r=>{
  if(!r.product_id||!r.name||!r.code||!r.unit)throw Error('stock_conference_invalid');
  const item={id:r.product_id,name:String(r.name),code:String(r.code),unit:String(r.unit),
   initial:num(r.initial),received:num(r.received),sold:num(r.sold),
   otherIn:num(r.other_in),otherOut:num(r.other_out),final:num(r.final),active:r.active===true};
  if(Math.abs(item.initial+item.received+item.otherIn-item.sold-item.otherOut-item.final)>0.0001)
   throw Error('stock_conference_balance_mismatch');
  return item;
 });
 return {businessId:raw.business_id,branchId:raw.branch_id,from:raw.from,to:raw.to,
  generatedAt:raw.generated_at,rows};
}
const qty=n=>Number(n).toLocaleString('pt-PT',{minimumFractionDigits:0,maximumFractionDigits:3});
export const stockConferenceColumns=['Produto','Código','Un.','Inicial','Entradas','Vendido','Outras entradas','Outras saídas','Saldo final','Contagem física','Diferença'];
export function stockConferenceWorkbook(snapshot,branchName='Filial'){
 if(!snapshot)throw Error('stock_conference_missing');
 return {
  title:'Conferência física de inventário',
  period:snapshot.from+' a '+snapshot.to+' · '+branchName,
  summary:[['Filial',branchName],['Produtos',snapshot.rows.length],
    ['Produtos com vendas',snapshot.rows.filter(r=>r.sold>0).length],
    ['Gerado em',String(snapshot.generatedAt||'').slice(0,19).replace('T',' ')]],
  sections:[{title:'Conferência por produto · preencher coluna J',columns:stockConferenceColumns,
   rows:snapshot.rows.map(r=>[r.name,r.code,r.unit,r.initial,r.received,r.sold,r.otherIn,r.otherOut,r.final,'',
     {kind:'physical_difference'}])}]
 };
}
export function stockConferencePrintData(snapshot,branchName='Filial'){
 if(!snapshot)throw Error('stock_conference_missing');
 return {
  subtitle:'Para conferir o stock físico; documento operacional sem valor fiscal.',
  meta:[['Filial',branchName],['Período',snapshot.from+' a '+snapshot.to],
    ['Número de produtos',String(snapshot.rows.length)],['Gerado em',String(snapshot.generatedAt||'').slice(0,19).replace('T',' ')]],
  sections:[
   {title:'Histórico do stock no período',
    columns:['Produto','Código','Un.','Inicial','Entradas','Vendido','Outras ent.','Outras saídas','Final'],
    rows:snapshot.rows.map(r=>[r.name,r.code,r.unit,qty(r.initial),qty(r.received),qty(r.sold),
      qty(r.otherIn),qty(r.otherOut),qty(r.final)])},
   {title:'Folha de contagem física',
    columns:['Produto','Código','Un.','Saldo do sistema','Contagem física','Diferença'],
    rows:snapshot.rows.map(r=>[r.name,r.code,r.unit,qty(r.final),'____________','____________'])}
  ],
  scopeNote:'Saldo reconstruído com base no stock e movimentos registados. Entradas = recepções; outras entradas/saídas incluem transferências, ajustes e devoluções. Conferir a mercadoria fisicamente. A exportação não altera o stock.'
 };
}
export function renderStockConferenceView(snapshot,{period='1',today,customFrom='',customTo='',branchName='Filial'}={}){
 const isCustom=period==='custom';
 const form='<section class="shop-box"><h3>📋 Conferência física de inventário</h3>'+
  '<p class="shop-help">Descarregue o movimento de todos os produtos da filial, incluindo os que não venderam. Depois conte o que existe nas prateleiras e compare com o saldo indicado.</p>'+
  '<form id="shop-stock-conference-form" class="shop-form">'+
  '<label>Período<select id="shop-stock-conference-period" name="period">'+
  [['1','Este mês'],['3','Últimos 3 meses'],['6','Últimos 6 meses'],['custom','Escolher datas']].map(([k,v])=>
    '<option value="'+k+'"'+(period===k?' selected':'')+'>'+v+'</option>').join('')+'</select></label>'+
  (isCustom?'<label>De<input type="date" name="from" value="'+esc(customFrom||today)+'" max="'+esc(today)+'" required></label>'+
    '<label>Até<input type="date" name="to" value="'+esc(customTo||today)+'" max="'+esc(today)+'" required></label>':'')+
  '<button class="shop-submit" type="submit">Gerar lista de conferência</button></form>'+
  '<p class="shop-help">Inclui entradas, vendas e outras movimentações. Não regista uma contagem nem altera o stock automaticamente.</p></section>';
 if(!snapshot)return form+'<section class="shop-box"><p class="shop-help">Escolha o período e toque em «Gerar lista de conferência».</p></section>';
 const rows=snapshot.rows.slice(0,100).map(r=>'<tr>'+
  [r.name,r.code,r.unit,qty(r.initial),qty(r.received),qty(r.sold),
   qty(r.otherIn),qty(r.otherOut),qty(r.final)].map(v=>'<td>'+esc(v)+'</td>').join('')+
   '<td>_____</td><td>_____</td></tr>').join('');
 return form+'<section class="shop-box"><h3>Resultado · '+esc(snapshot.rows.length)+' produtos</h3>'+
  '<p class="shop-help">Filial: '+esc(branchName)+' · '+esc(snapshot.from)+' a '+esc(snapshot.to)+
  '. O Excel calcula a diferença quando preencher a contagem física.</p>'+
  '<div class="document-export-actions">'+
  '<button class="shop-submit" type="button" data-stock-conference-xlsx>⬇ Descarregar Excel</button>'+
  '<button class="secondary" type="button" data-stock-conference-pdf>🖨 PDF para conferência</button></div>'+
  '<div class="credit-list" style="overflow-x:auto"><table class="shop-table"><thead><tr>'+
  stockConferenceColumns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
  (rows||'<tr><td colspan="11">Sem produtos neste período.</td></tr>')+
  '</tbody></table></div>'+
  (snapshot.rows.length>100?'<p class="shop-help">Pré-visualização limitada a 100 produtos. Os ficheiros incluem todos os '+snapshot.rows.length+' produtos.</p>':'')+
  '<p class="shop-help">Saldo histórico baseado no stock actual e nos movimentos registados. Uma diferença física deve ser investigada antes de fazer um ajuste.</p></section>';
}

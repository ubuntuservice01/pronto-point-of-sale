// Commercial management: pure business logic, money in integer cents.
const moneyCents = value => Number.isSafeInteger(value) && value >= 0;
const positiveText = (value,max=120) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const boundedText = (value,max=200) => typeof value === 'string' && value.length <= max;
const validQty = (value,discrete) => Number.isFinite(value) && value > 0 && value <= 1000000 && Math.abs(value*1000-Math.round(value*1000))<0.000001 && (!discrete || Number.isInteger(value));
export const discreteUnits=['un','caixa','pacote','saco','rolo','par','conjunto'];
export function saveCustomer(state,tenantId,input){
 if(!state.tenants.some(t=>t.id===tenantId))throw Error('tenant');
 if(!positiveText(input.name,120)||!boundedText(input.phone??'',40)||!boundedText(input.email??'',120)||!boundedText(input.note??'',300))throw Error('customer');
 if(input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw Error('customer_email');
 const id=String(input.id||'');
 if(!id||id.length>80)throw Error('customer_id');
 const existing=(state.customers||[]).find(c=>c.id===id && c.tenantId===tenantId);
 const other=(state.customers||[]).find(c=>c.id===id&&c.tenantId!==tenantId);
 if(other)throw Error('customer_id');
 const fields={name:input.name.trim(),phone:(input.phone||'').trim(),email:(input.email||'').trim(),note:(input.note||'').trim()};
 if(existing)return {...state,customers:state.customers.map(c=>c===existing?{...c,...fields,updatedAt:new Date().toISOString()}:c)};
 const customer={id,tenantId,...fields,createdAt:new Date().toISOString()};
 return {...state,customers:[customer,...(state.customers||[])]};
}
export function recordPurchase(state,tenantId,input,userId){
 if(!state.tenants.some(t=>t.id===tenantId))throw Error('tenant');
 const previous=(state.purchases||[]).find(p=>p.id===input.id);
 if(previous){if(previous.tenantId===tenantId&&previous.productId===input.productId&&previous.quantity===input.quantity&&previous.unitCost===input.unitCost&&previous.supplier===input.supplier)return state;throw Error('purchase_conflict');}
 if(typeof input.id!=='string'||!input.id||input.id.length>80||!positiveText(input.supplier,120)||!boundedText(input.reference??'',120))throw Error('purchase');
 const product=state.products.find(p=>p.id===input.productId&&p.tenantId===tenantId);
 if(!product)throw Error('product');
 if(!validQty(input.quantity,discreteUnits.includes(product.unit))||!moneyCents(input.unitCost)||input.unitCost<=0)throw Error('purchase_amount');
 const total=Math.round(input.quantity*input.unitCost);
 if(!moneyCents(total)||total<=0)throw Error('purchase_amount');
 const after=Math.round((product.stock+input.quantity)*1000)/1000;
 if(!Number.isFinite(after)||after>100000000)throw Error('stock');
 const item={id:input.id,tenantId,productId:product.id,productName:product.name,unit:product.unit,supplier:input.supplier.trim(),reference:(input.reference||'').trim(),quantity:input.quantity,unitCost:input.unitCost,total,userId,createdAt:new Date().toISOString()};
 return {...state,products:state.products.map(p=>p.id===product.id?{...p,stock:after,cost:input.unitCost}:p),purchases:[item,...(state.purchases||[])]};
}
export function recordExpense(state,tenantId,input,userId){
 if(!state.tenants.some(t=>t.id===tenantId))throw Error('tenant');
 const previous=(state.expenses||[]).find(x=>x.id===input.id);
 if(previous){if(previous.tenantId===tenantId&&previous.amount===input.amount&&previous.category===input.category&&previous.note===input.note)return state;throw Error('expense_conflict');}
 if(typeof input.id!=='string'||!input.id||input.id.length>80||!positiveText(input.category,80)||!positiveText(input.note,250)||!moneyCents(input.amount)||input.amount<=0)throw Error('expense');
 return {...state,expenses:[{id:input.id,tenantId,category:input.category.trim(),note:input.note.trim(),amount:input.amount,userId,createdAt:new Date().toISOString()},...(state.expenses||[])]};
}
const inDates=(value,from,to)=>{const day=String(value||'').slice(0,10);return (!from||day>=from)&&(!to||day<=to);};
export function commercialReport(state,tenantId,{from='',to=''}={}){
 if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from)||to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)||from&&to&&from>to)throw Error('date');
 const sales=(state.sales||[]).filter(s=>s.tenantId===tenantId&&inDates(s.createdAt,from,to));
 const refunds=(state.refunds||[]).filter(r=>r.tenantId===tenantId&&inDates(r.createdAt,from,to));
 const purchases=(state.purchases||[]).filter(p=>p.tenantId===tenantId&&inDates(p.createdAt,from,to));
 const expenses=(state.expenses||[]).filter(e=>e.tenantId===tenantId&&inDates(e.createdAt,from,to));
 const gross=sales.reduce((n,s)=>n+s.total,0),refundTotal=refunds.reduce((n,r)=>n+r.total,0),net=gross-refundTotal;
 const purchasesTotal=purchases.reduce((n,p)=>n+p.total,0),expensesTotal=expenses.reduce((n,e)=>n+e.amount,0);
 const refundedIds=new Set((state.refunds||[]).filter(r=>r.tenantId===tenantId).map(r=>r.saleId));
 let marginRevenue=0,cogs=0,costedSales=0;
 for(const sale of sales){
   if(refundedIds.has(sale.id))continue;
   if(!sale.lines?.length||!sale.lines.every(line=>Number.isSafeInteger(line.cost)&&line.cost>=0))continue;
   const amount=sale.lines.reduce((n,line)=>n+Math.round(line.cost*line.quantity),0);
   if(!Number.isSafeInteger(amount))continue;
   cogs+=amount;marginRevenue+=sale.total;costedSales++;
 }
 const grouped=new Map(),daily=new Map();
 for(const sale of sales){
   const date=String(sale.createdAt).slice(0,10);
   daily.set(date,(daily.get(date)||0)+sale.total);
   for(const line of sale.lines||[]){
    const key=line.productId,entry=grouped.get(key)||{productId:key,name:line.name,quantity:0,revenue:0};
    entry.quantity+=line.quantity;entry.revenue+=line.total;grouped.set(key,entry);
   }
 }
 for(const refund of refunds){
   const date=String(refund.createdAt).slice(0,10);daily.set(date,(daily.get(date)||0)-refund.total);
   const sale=(state.sales||[]).find(s=>s.id===refund.saleId&&s.tenantId===tenantId);
   for(const line of sale?.lines||[]){const entry=grouped.get(line.productId);if(entry){entry.quantity-=line.quantity;entry.revenue-=line.total;}}
 }
 return {gross,refundTotal,net,purchasesTotal,expensesTotal,transactions:sales.length,refundsCount:refunds.length,marginRevenue,cogs,costedSales,estimatedGrossMargin:marginRevenue-cogs,marginCoverage:sales.length?costedSales/sales.length:0,products:[...grouped.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,8),daily:[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([date,total])=>({date,total})),sales,refunds,purchases,expenses};
}
export function csvCell(value){const str=String(value??'');const safe=/^[=+@\-\t\r]/.test(str)?'\''+str:str;return '"'+safe.replaceAll('"','""')+'"';}
export function reportCsv(report,lang='pt'){
 const header=lang==='en'?['Date (UTC)','Record','Reference','Description','Amount MT']:['Data (UTC)','Tipo','Referência','Descrição','Valor MT'];
 const entries=[
 ...report.sales.map(s=>[s.createdAt,'Venda',s.id,(s.lines||[]).map(x=>x.name).join('; '),(s.total/100).toFixed(2)]),
 ...report.refunds.map(r=>[r.createdAt,'Devolução',r.saleId,r.reason,(-r.total/100).toFixed(2)]),
 ...report.purchases.map(p=>[p.createdAt,'Compra',p.id,p.productName+' - '+p.supplier,(-p.total/100).toFixed(2)]),
 ...report.expenses.map(e=>[e.createdAt,'Despesa',e.id,e.category+' - '+e.note,(-e.amount/100).toFixed(2)])
 ];
 return '\uFEFF'+[header,...entries].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

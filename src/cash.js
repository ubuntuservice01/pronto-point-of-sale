import {debtBalance} from './debts.js';
import {afterBatchRefund} from './batches.js';
export const paymentMethods=['cash','mpesa','emola','transfer','bank'];
export function activeCash(state,{tenantId,userId,deviceId}){return (state.cashSessions||[]).find(s=>s.tenantId===tenantId&&s.userId===userId&&s.deviceId===deviceId&&s.status==='open');}
function allocations(sale){return Array.isArray(sale.payments)&&sale.payments.length?sale.payments:[{method:sale.method,amount:sale.total}];}
export function cashSummary(state,session){
 const sales=(state.sales||[]).filter(s=>s.tenantId===session.tenantId&&s.cashSessionId===session.id);
 const refunds=(state.refunds||[]).filter(r=>r.tenantId===session.tenantId&&r.cashSessionId===session.id);
 const debtReceipts=(state.debtPayments||[]).filter(p=>p.tenantId===session.tenantId&&p.cashSessionId===session.id);
 const payments=Object.fromEntries(paymentMethods.map(method=>[method,sales.reduce((n,s)=>n+allocations(s).filter(p=>p.method===method).reduce((a,p)=>a+p.amount,0),0)-refunds.reduce((n,r)=>n+allocations(r).filter(p=>p.method===method).reduce((a,p)=>a+p.amount,0),0)+debtReceipts.filter(p=>p.method===method).reduce((n,p)=>n+p.amount,0)]));
 const incoming=session.movements.filter(m=>m.type==='in').reduce((n,m)=>n+m.amount,0);
 const outgoing=session.movements.filter(m=>m.type==='out').reduce((n,m)=>n+m.amount,0);
 const gross=sales.reduce((n,s)=>n+s.total,0),creditIssued=sales.filter(s=>s.method==='credit').reduce((n,s)=>n+s.total,0),refundTotal=refunds.reduce((n,r)=>n+r.total,0);
 return {sales,refunds,creditIssued,payments,debtReceipts,debtReceived:debtReceipts.reduce((n,p)=>n+p.amount,0),incoming,outgoing,refundTotal,expected:{...payments,cash:session.opening+payments.cash+incoming-outgoing},total:gross-refundTotal};
}
function cents(value){if(!Number.isSafeInteger(value)||value<0)throw Error('cash_amount');}
export function openCash(state,context,opening){
 cents(opening);if(activeCash(state,context))throw Error('cash_already_open');
 const session={...context,id:crypto.randomUUID(),status:'open',opening,openedAt:new Date().toISOString(),movements:[]};
 return {...state,cashSessions:[session,...(state.cashSessions||[])]};
}
export function moveCash(state,context,{type,amount,reason}){
 cents(amount);if(!amount||!['in','out'].includes(type)||typeof reason!=='string'||!reason.trim()||reason.length>200)throw Error('cash_movement');
 const session=activeCash(state,context);if(!session)throw Error('cash_not_open');
 if(type==='out'&&amount>cashSummary(state,session).expected.cash)throw Error('cash_insufficient');
 const movement={id:crypto.randomUUID(),type,amount,reason:reason.trim(),createdAt:new Date().toISOString()};
 return {...state,cashSessions:state.cashSessions.map(s=>s.id===session.id?{...s,movements:[...s.movements,movement]}:s)};
}
export function attachCashSale(state,context,id){
 const session=activeCash(state,context);if(!session)throw Error('cash_not_open');
 return {...state,sales:state.sales.map(s=>s.id===id&&s.tenantId===context.tenantId?{...s,cashSessionId:session.id}:s)};
}
export function closeCash(state,context,counted,note=''){
 const session=activeCash(state,context);if(!session)throw Error('cash_not_open');
 // Old open shifts may come from a client version without the Banco field.
 const confirmed={...counted,bank:counted.bank??0};
 for(const method of paymentMethods)cents(confirmed[method]);
 if(typeof note!=='string'||note.length>400)throw Error('cash_note');
 const summary=cashSummary(state,session);
 const differences=Object.fromEntries(paymentMethods.map(m=>[m,confirmed[m]-summary.expected[m]]));
 if(Object.values(differences).some(v=>v!==0)&&!note.trim())throw Error('cash_difference_note');
 return {...state,cashSessions:state.cashSessions.map(s=>s.id===session.id?{...s,status:'closed',closedAt:new Date().toISOString(),counted:confirmed,differences,note:note.trim(),closingSummary:summary}:s)};
}
export function refundSale(state,context,{saleId,id,reason}){
 if(!['owner','manager'].includes(context.role))throw Error('permission');
 if(typeof reason!=='string'||!reason.trim()||reason.length>300)throw Error('refund_reason');
 const existing=(state.refunds||[]).find(r=>r.id===id);
 if(existing){if(existing.saleId===saleId&&existing.tenantId===context.tenantId)return state;throw Error('refund_conflict');}
 const sale=state.sales.find(s=>s.id===saleId&&s.tenantId===context.tenantId);
 if(!sale)throw Error('sale_not_found');
 if(sale.refundId||(state.refunds||[]).some(r=>r.saleId===saleId))throw Error('already_refunded');
 const debt=(state.debts||[]).find(d=>d.tenantId===context.tenantId&&d.saleId===saleId);
 if(debt&&debtBalance(state,debt)<debt.amount)throw Error('debt_has_payments');
 const session=activeCash(state,context);if(!session)throw Error('cash_not_open');
 const methods=allocations(sale);
 const cashRefund=methods.find(p=>p.method==='cash')?.amount||0;
 if(cashRefund>cashSummary(state,session).expected.cash)throw Error('cash_insufficient');
 const refund={id,saleId,tenantId:context.tenantId,userId:context.userId,deviceId:context.deviceId,cashSessionId:session.id,createdAt:new Date().toISOString(),total:sale.total,payments:methods.map(p=>({...p})),reason:reason.trim(),manualConfirmed:true};
 const stockEvents=sale.lines.map(line=>{
  const p=state.products.find(p=>p.id===line.productId&&p.tenantId===context.tenantId);
  if(!p)return null;
  return {id:crypto.randomUUID(),tenantId:context.tenantId,productId:p.id,productName:p.name,unit:p.unit,action:'refund',type:'refund',actorId:context.userId,referenceId:saleId,reason:'Devolução: '+reason.trim(),createdAt:refund.createdAt,before:p.stock,after:Math.round((p.stock+line.quantity)*1000)/1000,delta:line.quantity};
 }).filter(Boolean);
 return {...state,products:state.products.map(p=>{
  const line=sale.lines.find(l=>l.productId===p.id);
  return line?{...p,stock:Math.round((p.stock+line.quantity)*1000)/1000}:p;
 }),sales:state.sales.map(s=>s.id===sale.id?{...s,refundId:id}:s),refunds:[refund,...(state.refunds||[])],stockBatches:afterBatchRefund(state,sale),inventoryEvents:[...stockEvents,...(state.inventoryEvents||[])],stockMovements:[...stockEvents,...(state.stockMovements||[])]};
}

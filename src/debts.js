// Gestão de Dívidas — currency in integer centavos; dates are local Mozambique calendar dates.
import {normalizeExpiryDate} from './expiry.js';
const money=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000000;
export const collectionMethods=['cash','mpesa','emola','transfer'];
export function mozambiqueDate(at=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function dueDate(date,at=new Date()){
 const value=normalizeExpiryDate(date);
 if(!value||value<mozambiqueDate(at))throw Error('debt_due_date');
 return value;
}
export function debtBalance(state,debt){
 if(!debt)return 0;
 if((state.refunds||[]).some(r=>r.tenantId===debt.tenantId&&r.saleId===debt.saleId))return 0;
 const paid=(state.debtPayments||[]).filter(p=>p.tenantId===debt.tenantId&&p.debtId===debt.id).reduce((n,p)=>n+p.amount,0);
 return Math.max(0,debt.amount-paid);
}
export function customerOutstanding(state,tenantId,customerId){
 return (state.debts||[]).filter(d=>d.tenantId===tenantId&&d.customerId===customerId).reduce((n,d)=>n+debtBalance(state,d),0);
}
export function debtStatus(state,debt,at=new Date()){
 const balance=debtBalance(state,debt);
 if((state.refunds||[]).some(r=>r.tenantId===debt.tenantId&&r.saleId===debt.saleId))return 'cancelled';
 if(!balance)return 'settled';
 return debt.dueDate<mozambiqueDate(at)?'overdue':'open';
}
export function checkNewDebt(state,tenantId,customerId,amount,date,at=new Date()){
 const customer=(state.customers||[]).find(c=>c.tenantId===tenantId&&c.id===customerId);
 if(!customer)throw Error('debt_customer_required');
 if(customer.creditBlocked===true)throw Error('debt_blocked');
 if(!money(amount)||amount<=0)throw Error('debt_amount');
 const limit=customer.creditLimit??0;
 if(!money(limit)||limit<amount+customerOutstanding(state,tenantId,customerId))throw Error('debt_limit');
 if((state.debts||[]).some(d=>d.tenantId===tenantId&&d.customerId===customerId&&debtStatus(state,d,at)==='overdue'))throw Error('debt_overdue');
 return dueDate(date,at);
}
export function addSaleDebt(state,sale,date,at=new Date()){
 const due=checkNewDebt(state,sale.tenantId,sale.customerId,sale.total,date,at);
 const debt={id:sale.id,tenantId:sale.tenantId,saleId:sale.id,customerId:sale.customerId,amount:sale.total,dueDate:due,createdAt:sale.createdAt,userId:sale.userId};
 return {...state,debts:[debt,...(state.debts||[])]};
}
export function saveCreditPolicy(state,tenantId,input,actorId){
 if(!['owner','manager'].includes(input.actorRole))throw Error('permission');
 const customer=(state.customers||[]).find(c=>c.id===input.customerId&&c.tenantId===tenantId);
 if(!customer)throw Error('customer_not_found');
 if(!money(input.creditLimit)||typeof input.creditBlocked!=='boolean'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>250)throw Error('credit_policy');
 if(input.expectedRevision!==(customer.creditRevision||0))throw Error('revision_conflict');
 if(input.creditLimit===(customer.creditLimit||0)&&input.creditBlocked===(customer.creditBlocked===true))throw Error('no_change');
 const event={id:crypto.randomUUID(),tenantId,customerId:customer.id,actorId,action:'credit_policy',createdAt:new Date().toISOString(),reason:input.reason.trim(),before:{creditLimit:customer.creditLimit||0,creditBlocked:customer.creditBlocked===true},after:{creditLimit:input.creditLimit,creditBlocked:input.creditBlocked}};
 return {...state,customers:state.customers.map(c=>c===customer?{...c,creditLimit:input.creditLimit,creditBlocked:input.creditBlocked,creditRevision:(c.creditRevision||0)+1}:c),debtEvents:[event,...(state.debtEvents||[])]};
}
export function registerDebtPayment(state,tenantId,input,context){
 if(typeof input.id!=='string'||!input.id||input.id.length>80||typeof input.debtId!=='string'||!input.debtId||input.debtId.length>80)throw Error('debt_payment');
 const previous=(state.debtPayments||[]).find(p=>p.id===input.id);
 if(previous){
  if(previous.tenantId===tenantId&&previous.userId===context.userId&&previous.debtId===input.debtId&&previous.amount===input.amount&&previous.method===input.method&&previous.reference===(input.reference||''))return state;
  throw Error('payment_conflict');
 }
 const debt=(state.debts||[]).find(d=>d.tenantId===tenantId&&d.id===input.debtId);
 if(!debt)throw Error('debt_not_found');
 if(debtStatus(state,debt)==='cancelled')throw Error('debt_cancelled');
 if(!money(input.amount)||input.amount<=0||input.amount>debtBalance(state,debt))throw Error('debt_amount');
 if(!collectionMethods.includes(input.method)||typeof (input.reference??'')!=='string'||(input.reference||'').length>120||input.manualConfirmed!==true)throw Error('debt_payment');
 const session=(state.cashSessions||[]).find(s=>s.tenantId===tenantId&&s.userId===context.userId&&s.deviceId===context.deviceId&&s.status==='open');
 if(!session)throw Error('cash_not_open');
 const payment={id:input.id,tenantId,debtId:debt.id,customerId:debt.customerId,amount:input.amount,method:input.method,reference:(input.reference||'').trim(),cashSessionId:session.id,userId:context.userId,deviceId:context.deviceId,createdAt:new Date().toISOString(),manualConfirmed:true};
 return {...state,debtPayments:[payment,...(state.debtPayments||[])]};
}
export function debtOverview(state,tenantId,at=new Date()){
 const rows=(state.debts||[]).filter(d=>d.tenantId===tenantId).map(d=>({...d,balance:debtBalance(state,d),status:debtStatus(state,d,at)}));
 const open=rows.filter(d=>d.balance>0);
 return {rows,openAmount:open.reduce((n,d)=>n+d.balance,0),overdueAmount:open.filter(d=>d.status==='overdue').reduce((n,d)=>n+d.balance,0),openCount:open.length,overdueCount:open.filter(d=>d.status==='overdue').length,received:(state.debtPayments||[]).filter(p=>p.tenantId===tenantId).reduce((n,p)=>n+p.amount,0)};
}
export function whatsAppDebtUrl(phone,message){
 let digits=String(phone||'').replace(/[^0-9]/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(/^8[24657][0-9]{7}$/.test(digits))digits='258'+digits;
 if(!/^2588[24657][0-9]{7}$/.test(digits))return '';
 return 'https://wa.me/'+digits+'?text='+encodeURIComponent(message);
}

// Client helpers for Supabase customers/credit. The database remains the authority.
import {PAYMENT_METHODS,toCents} from './supabase-shop-core.js';
export const DEBT_STATES={em_dia:'Em dia',parcial:'Parcial',vencido:'Vencido',liquidado:'Liquidado',cancelado:'Cancelado'};
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();
export const digits=v=>String(v??'').replace(/[^0-9]/g,'');
export function searchCustomers(list,q){const t=norm(q),d=digits(q);if(!t)return list;return list.filter(c=>norm(c.name).includes(t)||(d.length>=3&&digits(c.phone).includes(d)));}
export function makeCreditSaleRequest({businessId,branchId,sessionId,cart,customer,dueOn,today,outstanding,total,discount='0',idempotencyKey}){
 if(!customer)throw Error('debt_customer_required');
 if(customer.creditBlocked)throw Error('debt_blocked');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dueOn||'')||dueOn<today)throw Error('debt_due_date');
 if(outstanding+total>customer.creditLimit)throw Error('debt_limit');
 return {business_id:businessId,branch_id:branchId,session_id:sessionId,idempotency_key:idempotencyKey,customer_id:customer.id,due_on:dueOn,
  items:cart.map(i=>({product_id:i.productId,quantity:i.quantity})),discount_cents:toCents(discount)};
}
export function makeDebtPaymentRequest({businessId,branchId,sessionId,debt,amount,method,reference='',confirmed,idempotencyKey}){
 const cents=toCents(amount);
 if(cents<=0||cents>debt.balance)throw Error('debt_amount');
 if(!PAYMENT_METHODS.includes(method))throw Error('debt_payment');
 if(confirmed!==true)throw Error('debt_payment');
 if(method!=='cash'&&!String(reference).trim())throw Error('reference_required');
 return {business_id:businessId,branch_id:branchId,session_id:sessionId,idempotency_key:idempotencyKey,debt_id:debt.id,amount_cents:cents,method,reference:String(reference).trim().slice(0,128),manual_confirmed:true};
}
export function overdueAlerts(debts,role){return ['owner','manager','finance'].includes(role)?debts.filter(d=>d.state==='vencido'):[];}

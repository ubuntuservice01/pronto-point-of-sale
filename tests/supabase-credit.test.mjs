import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {searchCustomers,makeCreditSaleRequest,makeDebtPaymentRequest,overdueAlerts} from '../src/supabase-credit-core.js';
const c={id:'c1',name:'Maria João',phone:'84 123 4567',creditLimit:50000,creditBlocked:false};
const base={businessId:'b',branchId:'r',sessionId:'s',cart:[{productId:'p',quantity:1}],customer:c,dueOn:'2099-01-01',today:'2026-10-15',outstanding:0,total:10000,idempotencyKey:'k'};
test('Pesquisa por nome sem acentos e telefone',()=>{assert.equal(searchCustomers([c],'joao').length,1);assert.equal(searchCustomers([c],'1234').length,1);assert.equal(searchCustomers([c],'zzz').length,0);});
test('Crédito exige cliente, limite, desbloqueio e vencimento',()=>{
 assert.throws(()=>makeCreditSaleRequest({...base,customer:null}),/debt_customer_required/);
 assert.throws(()=>makeCreditSaleRequest({...base,customer:{...c,creditBlocked:true}}),/debt_blocked/);
 assert.throws(()=>makeCreditSaleRequest({...base,outstanding:45000}),/debt_limit/);
 assert.throws(()=>makeCreditSaleRequest({...base,dueOn:'2020-01-01'}),/debt_due_date/);
 assert.equal(makeCreditSaleRequest(base).customer_id,'c1');});
test('Cobrança limitada ao saldo, confirmação manual e referência digital',()=>{
 const p={businessId:'b',branchId:'r',sessionId:'s',debt:{id:'d',balance:5000},amount:'30',method:'cash',confirmed:true,idempotencyKey:'k'};
 assert.equal(makeDebtPaymentRequest(p).amount_cents,3000);
 assert.throws(()=>makeDebtPaymentRequest({...p,amount:'60'}),/debt_amount/);
 assert.throws(()=>makeDebtPaymentRequest({...p,confirmed:false}),/debt_payment/);
 assert.throws(()=>makeDebtPaymentRequest({...p,method:'mpesa'}),/reference_required/);});
test('Alertas vencidos só para proprietário/gerente/financeiro',()=>{const d=[{state:'vencido'},{state:'em_dia'}];assert.equal(overdueAlerts(d,'owner').length,1);assert.equal(overdueAlerts(d,'cashier').length,0);});
test('Migração pendente: atómica, FEFO, idempotente, bloqueios e sem escrita directa',()=>{
 const sql=readFileSync(new URL('../supabase/pending/20261015180000_pronto_customer_credit.sql',import.meta.url),'utf8');
 for(const r of [/security definer/,/pg_advisory_xact_lock/,/for update/,/order by b\.expires_on asc nulls last/,/debt_limit/,/debt_overdue/,/payment_conflict/,/pronto_debt_ledger/,/revoke insert,update,delete,truncate/,/auth\.uid\(\)/,/dp\.method='cash'/])assert.match(sql,r);
 assert.doesNotMatch(sql,/insert into public\.pronto_customers\(business_id,branch_id,name,phone,phone_normalized,note\)\s+values\('/);});

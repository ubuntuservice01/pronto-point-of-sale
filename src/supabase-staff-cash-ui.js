import {esc,MONEY} from './supabase-shop-core.js';
const integerCents=(value,allowNegative=false)=>typeof value==='number'&&Number.isSafeInteger(value)&&(allowNegative||value>=0);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function normalizeSuspendedCash(raw){
 if(!raw||!Array.isArray(raw.sessions))throw Error('suspended_cash_snapshot_invalid');
 if(!raw.sessions.every(s=>s&&uuid(s.id)&&uuid(s.branch_id)&&uuid(s.operator_id)&&
   integerCents(s.opening_cash_cents)&&integerCents(s.expected_cash_cents,true)))
  throw Error('suspended_cash_snapshot_invalid');
 return {sessions:raw.sessions.map(s=>({
  id:s.id,branchId:s.branch_id,branch:String(s.branch_name||'Filial'),
  operatorId:s.operator_id,operator:String(s.operator_name||'Colaborador'),
  openedAt:s.opened_at,opening:s.opening_cash_cents,
  expected:s.expected_cash_cents
 }))};
}
export function renderSuspendedCash(cash){
 if(!cash)return '<section class="shop-box"><h3>Caixas suspensos</h3><p>A consultar sessões em aberto…</p></section>';
 const sessions=cash.sessions;
 return '<section class="shop-box"><h3>Caixas de colaboradores suspensos</h3>'+
 '<p class="shop-help">O proprietário pode encerrar um caixa que ficou aberto após a suspensão de um funcionário. Conte fisicamente o dinheiro antes de confirmar. As vendas e movimentos originais não são modificados; a diferença será registada para auditoria.</p>'+
 (sessions.length?sessions.map(s=>'<article class="credit-debt-item">'+
  '<strong>'+esc(s.operator)+'</strong><small> · '+esc(s.branch)+'</small>'+
  '<p>Caixa inicial: '+MONEY(s.opening)+' · Esperado: '+MONEY(s.expected)+'</p>'+
  '<form data-shop-form="suspended_cash_close" class="shop-form">'+
  '<input type="hidden" name="session_id" value="'+esc(s.id)+'">'+
  '<label>Dinheiro contado (MT)<input name="counted_cash" type="number" min="0" step="0.01" required></label>'+
  '<label>Motivo da reconciliação excepcional<input name="reason" minlength="12" maxlength="250" required placeholder="Ex.: Operador suspenso com caixa aberto"></label>'+
  '<label><input type="checkbox" name="confirmed" required> Confirmei a contagem física e autorizo o encerramento auditado</label>'+
  '<button class="shop-submit" type="submit">Encerrar caixa do colaborador suspenso</button></form></article>').join(''):
  '<p class="shop-help">Não existem caixas em aberto pertencentes a colaboradores suspensos.</p>')+
 '</section>';
}

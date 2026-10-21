import {esc,MONEY} from './supabase-shop-core.js';
const cents=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(x);
const stateLabels={open:'Aberto',blocked:'Bloqueado',pending:'Pendente de fecho',closed:'Encerrado'};
const statusClass={open:'cash-open',blocked:'cash-blocked',pending:'cash-pending',closed:'cash-closed'};
const money=value=>cents(value)?MONEY(value):'—';
export function normalizeCashControl(raw){
 if(!raw||!raw.policy||!Array.isArray(raw.sessions)||
  typeof raw.policy.opening_required!=='boolean'||typeof raw.policy.blind_close!=='boolean')
  throw Error('cash_snapshot_invalid');
 const sessions=raw.sessions.map(s=>{
  if(!s||!uuid(s.id)||!uuid(s.operator_id)||!['open','blocked','pending','closed'].includes(s.status)||
   !cents(s.opening_cash_cents)||s.expected_cash_cents!==null&&
   s.expected_cash_cents!==undefined&&!Number.isSafeInteger(s.expected_cash_cents))
   throw Error('cash_snapshot_invalid');
  return {id:s.id,operatorId:s.operator_id,operator:String(s.operator_name||'Colaborador'),
   branchId:s.branch_id,terminal:String(s.terminal||''),openedAt:s.opened_at,
   closedAt:s.closed_at,status:s.status,closeType:s.close_type||null,
   closedBy:s.closed_by||null,closeReason:String(s.close_reason||''),
   opening:s.opening_cash_cents,counted:s.counted_cash_cents,
   expected:s.expected_cash_cents,difference:s.difference_cents,
   methods:s.payments_by_method||null};
 });
 return {policy:{openingRequired:raw.policy.opening_required,blindClose:raw.policy.blind_close},sessions};
}
export function ownOpenSession(snapshot,userId){
 return snapshot?.sessions.find(s=>s.operatorId===userId&&s.status==='open')||null;
}
export function cashSessionsCSV(snapshot){
 if(!snapshot||!Array.isArray(snapshot.sessions))throw Error('cash_snapshot_invalid');
 const safe=s=>{const v=String(s??'').replace(/"/g,'""');
  return '"'+(/^[\s]*[=+@\-\t\r]/.test(v)?"'"+v:v)+'"';};
 const header=['Sessão','Funcionário','Terminal','Estado','Tipo de fecho','Abertura','Encerramento',
  'Fundo inicial (MT)','Esperado (MT)','Contado (MT)','Diferença (MT)','Dinheiro recebido (MT)',
  'M-Pesa (MT)','e-Mola (MT)','Transferência (MT)'];
 const lines=snapshot.sessions.map(s=>[s.id,s.operator,s.terminal,stateLabels[s.status],
  s.closeType==='administrative_unchecked'?'Fecho administrativo sem conferência':s.closeType||'',s.openedAt||'',s.closedAt||'',s.opening/100,
  s.expected===null?'':s.expected/100,s.counted===null?'':s.counted/100,
  s.difference===null?'':s.difference/100,
  s.methods?.cash===undefined?'':s.methods.cash/100,
  s.methods?.mpesa===undefined?'':s.methods.mpesa/100,
  s.methods?.emola===undefined?'':s.methods.emola/100,
  s.methods?.transfer===undefined?'':s.methods.transfer/100].map(safe).join(';'));
 return '\ufeff'+[header.map(safe).join(';'),...lines].join('\r\n');
}
const fmtTime=value=>{
 if(!value)return '—';
 const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('pt-MZ',{timeZone:'Africa/Maputo'}):'—';
};
function sessionCard(s,{owner,blind,userId}){
 const canOperate=s.status!=='closed',isMine=s.operatorId===userId;
 return '<article class="cash-session-card">'+
  '<div class="cash-session-heading"><strong>'+esc(s.operator)+'</strong>'+
  '<span class="cash-state '+statusClass[s.status]+'">'+stateLabels[s.status]+'</span></div>'+
  '<p class="shop-help">Terminal: '+esc(s.terminal)+' · Abertura: '+esc(fmtTime(s.openedAt))+'</p>'+
  '<p>Fundo inicial: <strong>'+money(s.opening)+'</strong></p>'+
  ((owner||!blind||s.status==='closed')&&s.expected!==null&&s.expected!==undefined?
    '<p>Dinheiro esperado: <strong>'+MONEY(s.expected)+'</strong></p>':
    '<p class="shop-help">Fecho cego: o valor esperado só aparece após declarar a contagem.</p>')+
  (s.status==='closed'?
   '<p>Encerrado: '+esc(fmtTime(s.closedAt))+'</p>'+
   (s.closeType==='administrative_unchecked'?
    '<p class="cash-warning">Fecho administrativo sem conferência física — diferença não apurada.</p>':
    '<p>Dinheiro contado: '+money(s.counted)+'</p>'+
     (typeof s.difference==='number'?'<p class="'+(s.difference<0?'cash-short':s.difference>0?'cash-extra':'cash-match')+'">'+
     (s.difference<0?'FALTA de ':s.difference>0?'SOBRA de ':'Caixa certo: ')+MONEY(Math.abs(s.difference))+'</p>':'')):
   '')+
  (s.status==='closed'&&typeof s.difference==='number'&&s.difference!==0&&(isMine||owner)?
   '<form data-shop-form="cash_note_difference" class="shop-form">'+
   '<input type="hidden" name="session_id" value="'+esc(s.id)+'">'+
   '<label>Justificar a diferença sem alterar a contagem<input name="reason" minlength="8" maxlength="500" required placeholder="Descreva o motivo da falta ou sobra"></label>'+
   '<button class="shop-submit" type="submit">Guardar justificação auditada</button></form>':'')+
  (s.status==='pending'&&isMine?
   '<form data-shop-form="cash_close" class="shop-form">'+
   '<label>Dinheiro contado (MT)<input type="number" name="counted_cash" min="0" step="0.01" required></label>'+
   '<button class="shop-submit" type="submit">Confirmar contagem e encerrar</button></form>':'')+
  (s.status==='open'&&isMine?
   '<form data-shop-form="cash_request_close" class="shop-form">'+
   '<button class="shop-submit" type="submit">Solicitar fecho de caixa</button></form>'+
   '<form data-shop-form="cash_move" class="shop-form"><h4>Reforço / retirada</h4>'+
   '<label>Operação<select name="direction"><option value="in">Reforço de caixa</option><option value="out">Retirada de caixa</option></select></label>'+
   '<label>Valor (MT)<input type="number" name="amount" min="0.01" step="0.01" required></label>'+
   '<label>Motivo<input name="reason" minlength="3" maxlength="180" required></label>'+
   '<label>Frase de protecção (para guardar offline)<input type="password" name="offline_passphrase" minlength="12" maxlength="128" autocomplete="off" placeholder="Obrigatória apenas sem Internet"></label>'+
   '<button type="submit" class="shop-submit">Registar movimento</button></form>':'')+
  (owner&&canOperate?
   '<form data-shop-form="cash_remote" class="shop-form">'+
   '<input type="hidden" name="session_id" value="'+esc(s.id)+'">'+
   '<label>Intervenção<select name="remote_action">'+
   (s.status==='blocked'?'<option value="unblock">Desbloquear sessão</option>':'<option value="block">Bloquear sessão</option>')+
   '<option value="admin_close">Fecho administrativo sem conferência</option></select></label>'+
   '<label>Motivo<input name="reason" minlength="12" maxlength="250" required></label>'+
   '<button type="submit" class="shop-submit">Confirmar intervenção</button></form>':'')+
  '</article>';
}
export function renderCashManagement({cash,account,role='cashier',pendingOffline=0}){
 if(!cash)return '<section class="shop-box"><h3>Gestão de caixa</h3><p>A actualizar sessões…</p></section>';
 const owner=role==='owner',canReview=role==='owner'||role==='manager',canOperate=['owner','manager','cashier'].includes(role);
 const ownOpen=ownOpenSession(cash,account.userId);
 const mine=cash.sessions.filter(s=>s.operatorId===account.userId);
 const activeMine=mine.find(s=>['pending','blocked'].includes(s.status));
 const selected=cash.sessions.filter(s=>canReview||s.operatorId===account.userId);
 return '<div class="cash-control">'+
  (pendingOffline?'<section class="shop-box"><h3>Movimentos offline por confirmar ('+pendingOffline+')</h3>'+
   '<p class="cash-warning">Estes movimentos foram guardados de forma encriptada. Ainda não alteraram o saldo. Não feche o caixa antes de os enviar e confirmar.</p>'+
   '<form data-shop-form="cash_offline_sync" class="shop-form">'+
   '<label>Frase utilizada para proteger o(s) registo(s)<input type="password" name="offline_passphrase" minlength="12" maxlength="128" autocomplete="off" required></label>'+
   '<button class="shop-submit" type="submit">Sincronizar movimentos com Internet</button></form></section>':'')+
  (owner?'<section class="shop-box"><h3>Definições do caixa nesta filial</h3>'+
   '<form data-shop-form="cash_configure" class="shop-form">'+
   '<label><input type="checkbox" name="opening_required" '+(cash.policy.openingRequired?'checked':'')+'> Abertura de caixa obrigatória para vender</label>'+
   '<label><input type="checkbox" name="blind_close" '+(cash.policy.blindClose?'checked':'')+'> Activar fecho cego de caixa</label>'+
   '<p class="shop-help">Com a abertura opcional, as vendas continuam registadas, mas não são atribuídas a uma gaveta sem sessão. O fecho cego oculta o valor esperado antes da contagem.</p>'+
   '<button class="shop-submit" type="submit">Guardar definições</button></form></section>':'')+
  (canOperate&&!ownOpen&&!activeMine?'<section class="shop-box"><h3>Abrir caixa</h3>'+
   '<form data-shop-form="cash_open" class="shop-form">'+
   '<label>Terminal físico<input name="device_id" value="CAIXA-01" minlength="2" maxlength="100" required></label>'+
   '<label>Fundo inicial de caixa (MT)<input name="opening_cash" type="number" value="0" min="0" step="0.01" required></label>'+
   '<p class="shop-help">O fundo inicial não é venda nem lucro. Pode abrir com 0,00 MT.</p>'+
   '<button class="shop-submit" type="submit">Confirmar abertura</button></form></section>':'')+
  (!cash.policy.openingRequired?'<p class="shop-help">Abertura opcional: pode vender sem caixa aberto; os pagamentos ficam no histórico financeiro da loja.</p>':'')+
  '<section class="shop-box"><h3>'+(owner?'Supervisão e histórico de sessões':'As minhas sessões')+'</h3>'+
  (canReview?'<button type="button" data-cash-export class="secondary">Exportar histórico CSV</button>':'')+
  (selected.length?selected.map(s=>sessionCard(s,{owner,blind:cash.policy.blindClose,userId:account.userId})).join(''):
   '<p class="shop-help">Ainda não existem sessões de caixa nesta filial.</p>')+
  '</section></div>';
}

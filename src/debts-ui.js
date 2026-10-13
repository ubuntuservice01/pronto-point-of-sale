import {debtOverview,debtBalance,customerOutstanding,debtStatus,whatsAppDebtUrl,mozambiqueDate} from './debts.js';
import {activeCash} from './cash.js';
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const date=d=>d?d.split('-').reverse().join('/'):'—';
const translated=(status,en)=>({overdue:en?'Overdue':'Vencida',open:en?'Open':'Pendente',settled:en?'Paid':'Liquidada',cancelled:en?'Cancelled':'Anulada'})[status]||'—';
let debtFilter='open';
export function debtsPage({state,tenantId,lang,money,role}){
 const en=lang==='en',summary=debtOverview(state,tenantId),customers=(state.customers||[]).filter(c=>c.tenantId===tenantId);
 const rows=summary.rows.filter(d=>debtFilter==='all'||(debtFilter==='open'?d.balance>0:debtFilter==='overdue'?d.status==='overdue':d.status===debtFilter)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
 const canChangePolicy=['owner','manager'].includes(role),canCollect=['owner','manager','cashier'].includes(role);
 return `<div class="page-heading"><div><p class="eyebrow">PRONTO POS · ${en?'CREDIT':'CONTAS A RECEBER'}</p><h1 tabindex="-1">${en?'Debt management':'Gestão de Dívidas'}</h1><p>${en?'Track credit sales, due dates and payments.':'Controle vendas a crédito, prazos e pagamentos dos clientes.'}</p></div><button class="secondary" data-page="customers">${en?'Customers':'Clientes'} →</button></div>
 <section class="management-stats debt-stats">${[[en?'Total outstanding':'Total em dívida',money(summary.openAmount)],[en?'Overdue':'Dívidas vencidas',money(summary.overdueAmount)],[en?'Open debts':'Dívidas pendentes',summary.openCount],[en?'Total collected':'Total recebido',money(summary.received)]].map(([label,value])=>`<article><small>${label}</small><strong>${value}</strong></article>`).join('')}</section>
 <section class="panel debt-policy-panel"><h2>${en?'Customer credit limits':'Limites de crédito dos clientes'}</h2><p class="info-note">${en?'New clients start with a limit of 0. Only the owner or manager can authorise credit.':'Os novos clientes começam com limite de 0 MT. Só o proprietário ou gerente pode autorizar crédito.'}</p>
 <div class="debt-customers">${customers.length?customers.map(c=>`<article class="debt-customer"><div><strong>${safe(c.name)}</strong><small>${en?'Outstanding':'Saldo em dívida'}: ${money(customerOutstanding(state,tenantId,c.id))} · ${en?'Limit':'Limite'}: ${money(c.creditLimit||0)}</small><small>${c.creditBlocked?(en?'Credit blocked':'Crédito bloqueado'):(en?'Credit authorised within limit':'Crédito sujeito ao limite')}</small></div>${canChangePolicy?`<button type="button" class="secondary" data-credit-policy="${safe(c.id)}">${en?'Configure':'Configurar'}</button>`:''}</article>`).join(''):`<p class="empty">${en?'Register a customer first.':'Registe primeiro um cliente.'}</p>`}</div></section>
 <section class="panel debt-ledger"><div class="panel-title"><h2>${en?'Accounts receivable':'Dívidas registadas'}</h2><select id="debt-status" aria-label="${en?'Filter status':'Filtrar por estado'}">${[['open',en?'Outstanding':'Pendentes'],['overdue',en?'Overdue':'Vencidas'],['settled',en?'Paid':'Liquidadas'],['cancelled',en?'Cancelled':'Anuladas'],['all',en?'All':'Todas']].map(([id,title])=>`<option value="${id}" ${debtFilter===id?'selected':''}>${title}</option>`).join('')}</select></div>
 ${rows.length?rows.map(d=>{
  const customer=customers.find(c=>c.id===d.customerId);
  const payments=(state.debtPayments||[]).filter(p=>p.tenantId===tenantId&&p.debtId===d.id);
  const whatsapp=customer?.phone&&d.balance>0?whatsAppDebtUrl(customer.phone,en?`Hello ${customer.name}. This is a reminder from ${state.tenants.find(t=>t.id===tenantId)?.name||'our shop'}: outstanding balance ${money(d.balance)}, due ${date(d.dueDate)}. If already paid, please disregard.`:`Olá, ${customer.name}. Lembramos que existe um saldo em dívida de ${money(d.balance)} na ${state.tenants.find(t=>t.id===tenantId)?.name||'nossa loja'}, com vencimento em ${date(d.dueDate)}. Se já efectuou o pagamento, agradecemos que desconsidere esta mensagem.`):'';
  return `<article class="debt-row"><div class="debt-row-head"><div><strong>${safe(customer?.name||'—')}</strong><small>${en?'Sale':'Venda'} #${safe(d.saleId.slice(0,8))} · ${en?'Due':'Vencimento'}: ${date(d.dueDate)}</small></div><span class="debt-badge debt-${d.status}">${translated(d.status,en)}</span></div>
  <div class="debt-amounts"><div><small>${en?'Original':'Valor original'}</small><strong>${money(d.amount)}</strong></div><div><small>${en?'Paid':'Pago'}</small><strong>${money(d.amount-d.balance)}</strong></div><div><small>${en?'Outstanding':'Por pagar'}</small><strong>${money(d.balance)}</strong></div></div>
  ${payments.length?`<details><summary>${en?'Payment history':'Histórico de pagamentos'} (${payments.length})</summary>${payments.map(p=>`<div class="debt-payment-line"><small>${new Date(p.createdAt).toLocaleString(en?'en-GB':'pt-MZ')} · ${safe(p.method)} · ${safe(p.reference||'—')}</small><strong>${money(p.amount)}</strong></div>`).join('')}</details>`:''}
  <div class="debt-actions">${d.balance>0&&canCollect?`<button class="primary" data-debt-payment="${safe(d.id)}">${en?'Record payment':'Registar pagamento'}</button>`:''}${whatsapp?`<a class="secondary debt-whatsapp" href="${safe(whatsapp)}" target="_blank" rel="noopener noreferrer">${en?'WhatsApp reminder':'Lembrar pelo WhatsApp'} ↗</a>`:''}</div></article>`;
 }).join(''):`<p class="empty">${en?'No debts match this filter.':'Não existem dívidas neste filtro.'}</p>`}
 </section><p class="info-note">${en?'M-Pesa/e-Mola receipts are manually confirmed. WhatsApp reminders only open a prepared message; nothing is sent automatically.':'Os recebimentos M-Pesa/e-Mola são confirmados manualmente. O WhatsApp apenas abre uma mensagem preparada; nada é enviado automaticamente.'}</p>`;
}
const parseMoney=v=>{const s=String(v??'').trim(),n=Number(s);if(!s||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('amount');return Math.round(n*100);};
export function bindDebtActions({getState,getTenantId,getRole,lang,money,remote,submit,apply,render,modal,toast,cashContext}){
 const en=lang==='en',msg=en?{invalid:'Check the information entered.',noCash:'Open your cash register first to record a payment.',saved:'Changes saved.',failed:'Unable to complete. The balance or limit may have changed.',policy:'Customer credit authorisation',limit:'Maximum debt (MT)',blocked:'Block new credit sales',reason:'Reason',payment:'Record debt payment',amount:'Amount received (MT)',method:'Payment method (confirmed manually)',reference:'Reference (optional)',confirm:'I confirm the payment has been received',submit:'Save payment',noAuto:'This is a manual collection record. No automatic M-Pesa or e-Mola charge will be made.'}:{invalid:'Confira os dados introduzidos.',noCash:'Abra primeiro o seu caixa para registar um pagamento.',saved:'Alterações guardadas.',failed:'Não foi possível concluir. O saldo ou limite poderá ter mudado.',policy:'Autorização de crédito do cliente',limit:'Limite máximo de dívidas (MT)',blocked:'Bloquear novas vendas a crédito',reason:'Motivo da autorização',payment:'Registar pagamento da dívida',amount:'Valor recebido (MT)',method:'Meio de pagamento (confirmado manualmente)',reference:'Referência (opcional)',confirm:'Confirmo que o pagamento foi recebido',submit:'Guardar pagamento',noAuto:'Este é um registo manual. Não será efectuada uma cobrança automática pelo M-Pesa ou e-Mola.'};
 const process=async(d,route,body,mutator,button)=>{
  button.disabled=true;
  try{if(remote)await submit(route,body);else await apply(current=>mutator(current));d.close();render();toast(msg.saved);}
  catch(error){button.disabled=false;toast(msg.failed);}
 };
 document.querySelector('#debt-status')?.addEventListener('change',e=>{debtFilter=e.target.value;render();});
 document.querySelectorAll('[data-credit-policy]').forEach(button=>button.onclick=()=>{
  if(!['owner','manager'].includes(getRole()))return;
  const c=(getState().customers||[]).find(x=>x.id===button.dataset.creditPolicy&&x.tenantId===getTenantId());if(!c)return;
  const d=modal(`<h2>${msg.policy}</h2><p>${safe(c.name)}</p><form><label>${msg.limit}<input name="limit" type="number" min="0" step="0.01" value="${((c.creditLimit||0)/100).toFixed(2)}" required></label><label class="debt-checkbox"><input name="blocked" type="checkbox" ${c.creditBlocked?'checked':''}>${msg.blocked}</label><label>${msg.reason}<textarea name="reason" maxlength="250" required></textarea></label><button class="primary full">${msg.submit}</button></form>`);
  d.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);let limit;try{limit=parseMoney(f.get('limit'));}catch{return toast(msg.invalid);}
   const body={customerId:c.id,creditLimit:limit,creditBlocked:f.get('blocked')==='on',expectedRevision:c.creditRevision||0,reason:String(f.get('reason')||'').trim(),actorRole:getRole()};
   if(!body.reason)return toast(msg.invalid);
   process(d,'customers/credit',body,s=>saveCreditPolicy(s,getTenantId(),body,'demo'),e.target.querySelector('button'));
  };
 });
 document.querySelectorAll('[data-debt-payment]').forEach(button=>button.onclick=()=>{
  const debt=(getState().debts||[]).find(x=>x.id===button.dataset.debtPayment&&x.tenantId===getTenantId());if(!debt)return;
  if(!cashContext||!activeCash(getState(),cashContext()))return toast(msg.noCash);
  const outstanding=debtBalance(getState(),debt),c=(getState().customers||[]).find(x=>x.id===debt.customerId),id=crypto.randomUUID();
  const d=modal(`<h2>${msg.payment}</h2><p><strong>${safe(c?.name||'—')}</strong> · ${money(outstanding)}</p><form><label>${msg.amount}<input name="amount" type="number" min="0.01" max="${(outstanding/100).toFixed(2)}" value="${(outstanding/100).toFixed(2)}" step="0.01" required></label><label>${msg.method}<select name="method"><option value="cash">${en?'Cash':'Dinheiro'}</option><option value="mpesa">M-Pesa</option><option value="emola">e-Mola</option><option value="transfer">${en?'Bank transfer':'Transferência'}</option></select></label><label>${msg.reference}<input name="reference" maxlength="120"></label><label class="debt-checkbox"><input type="checkbox" name="confirmed" required>${msg.confirm}</label><p class="info-note">${msg.noAuto}</p><button class="primary full">${msg.submit}</button></form>`);
  d.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);let amount;try{amount=parseMoney(f.get('amount'));}catch{return toast(msg.invalid);}
   if(amount<=0||amount>outstanding||f.get('confirmed')!=='on')return toast(msg.invalid);
   const body={id,debtId:debt.id,amount,method:String(f.get('method')),reference:String(f.get('reference')||'').trim(),manualConfirmed:true};
   process(d,'debts/payments',body,s=>registerDebtPayment(s,getTenantId(),body,cashContext()),e.target.querySelector('button'));
  };
 });
}
import {saveCreditPolicy,registerDebtPayment} from './debts.js';

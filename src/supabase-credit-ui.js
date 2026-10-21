// Supabase customer/credit screens. All user values escaped before interpolation.
// Data is read only through the authorised RPC; mutations are submitted separately.
import {esc,MONEY} from './supabase-shop-core.js';
import {DEBT_STATES,searchCustomers} from './supabase-credit-core.js';
import {brandedDocumentHTML} from './supabase-document-branding.js';
const input=(name,label,type='text',extra='')=>'<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+type+'" '+extra+' required></label>';
const select=(name,label,options,first='Seleccione')=>'<label>'+esc(label)+'<select name="'+esc(name)+'" required><option value="">'+esc(first)+'</option>'+options.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label>';
const blank=s=>s===null||s===undefined?'':String(s);
const date=s=>{if(!s)return '—';const d=new Date(s);return Number.isFinite(d.valueOf())?d.toLocaleDateString('pt-PT',{timeZone:'Africa/Maputo'}):'—';};
const prettyPayment={cash:'Dinheiro',mpesa:'M-Pesa',emola:'e-Mola',transfer:'Transferência'};
const money=c=>MONEY(Number(c)||0);
const allIds=list=>list.map(item=>({id:item.id,name:item.name}));
const panel=(title,body,description='')=>'<section class="shop-box credit-panel"><h3>'+esc(title)+'</h3>'+(description?'<p class="shop-help">'+esc(description)+'</p>':'')+body+'</section>';
export function normalizeCreditSnapshot(raw){
 if(!raw||!Array.isArray(raw.customers)||!Array.isArray(raw.debts)||!Array.isArray(raw.payments)||!Array.isArray(raw.customer_sales))throw Error('credit_snapshot_invalid');
 return {
  customers:raw.customers.filter(x=>x?.id&&typeof x.name==='string').map(x=>({
   id:x.id,name:x.name,phone:blank(x.phone),note:blank(x.note),active:x.active===true,
   creditLimit:Number(x.credit_limit_cents)||0,creditBlocked:x.credit_blocked===true,
   creditRevision:Number(x.credit_revision)||0,createdAt:x.created_at
  })),
  debts:raw.debts.filter(x=>x?.id).map(x=>({
   id:x.id,saleId:x.sale_id,customerId:x.customer_id,original:Number(x.original_cents)||0,
   balance:Number(x.balance_cents)||0,dueOn:x.due_on,state:x.state||'em_dia',
   status:x.status,createdAt:x.created_at,
   items:Array.isArray(x.items)?x.items.map(p=>({name:blank(p.name),qty:Number(p.qty),
    price:Number(p.unit_price_cents),total:Number(p.line_total_cents)})):[]
  })),
  payments:raw.payments.filter(x=>x?.id).map(x=>({
   id:x.id,debtId:x.debt_id,amount:Number(x.amount_cents)||0,method:x.method,
   reference:blank(x.reference),balanceAfter:Number(x.balance_after_cents)||0,createdAt:x.created_at
  })),
  sales:raw.customer_sales.filter(x=>x?.id).map(x=>({
   id:x.id,customerId:x.customer_id,method:x.method,amount:Number(x.total_cents)||0,
   createdAt:x.created_at,customerName:blank(x.customer_name)
  })),
  today:String(raw.today||''),
  generatedAt:raw.generated_at||null
 };
}
export function customerPicker(credit,selected=''){
 const list=credit?.customers.filter(c=>c.active)||[];
 return '<label>Cliente (opcional em venda paga)<select id="shop-sale-customer" name="customer_id">'+
  '<option value="">Consumidor não identificado</option>'+
  list.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===selected?' selected':'')+'>'+esc(c.name)+(c.phone?' · '+esc(c.phone):'')+'</option>').join('')+'</select></label>';
}
export function creditCheckoutFields({credit,selected='',today='',method='cash'}={}){
 if(!credit)return '<p class="shop-help"></p>';
 const customer=credit.customers.find(c=>c.id===selected);
 const outstanding=customer?credit.debts.filter(d=>d.customerId===selected&&d.balance>0)
  .reduce((n,d)=>n+d.balance,0):0;
 const credits=customer?'<p class="shop-help">Limite: '+money(customer.creditLimit)+
  ' · Em dívida: '+money(outstanding)+(customer.creditBlocked?' · Crédito bloqueado':'')+'</p>':'';
 return customerPicker(credit,selected)+credits+
  (method==='credit'?'<p class="shop-help">A venda a crédito cria uma dívida no servidor, sujeita ao limite do cliente e à disponibilidade do stock.</p>':'');
}
export function renderCreditView({view,credit,role,query='',filter='open',session=null,selectedCustomerId=''}){
 if(!credit)return panel('Clientes e dívidas','<p></p>');
 const customers=searchCustomers(credit.customers,query);
 const active=credit.customers.filter(x=>x.active);
 if(view==='customers'){
  const chosen=credit.customers.find(c=>c.id===selectedCustomerId);
  const history=chosen?credit.sales.filter(s=>s.customerId===chosen.id):[];
  const debts=chosen?credit.debts.filter(d=>d.customerId===chosen.id):[];
  return '<div class="shop-two">'+panel('Clientes',
   '<label>Pesquisar cliente<input type="search" id="shop-customer-search" value="'+esc(query)+'" placeholder="Nome ou contacto"></label>'+
   '<div class="credit-list">'+(customers.length?customers.map(c=>
    '<button type="button" class="credit-list-item" data-credit-customer="'+esc(c.id)+'"><strong>'+esc(c.name)+'</strong><small>'+esc(c.phone||'Sem contacto')+
    ' · '+(c.active?'Activo':'Inactivo')+'</small></button>').join(''):'<p class="shop-help">Nenhum cliente encontrado.</p>')+'</div>',
   'Até 1.000 clientes por consulta; pesquisa local por nome ou contacto.')+
   panel(chosen?'Editar cliente':'Novo cliente',
   '<form data-shop-form="customer_save" class="shop-form">'+
   (chosen?'<input name="customer_id" type="hidden" value="'+esc(chosen.id)+'">':'')+
   '<label>Nome completo<input name="name" required maxlength="200" value="'+esc(chosen?.name||'')+'"></label>'+
   '<label>Telefone<input name="phone" type="tel" maxlength="40" value="'+esc(chosen?.phone||'')+'"></label>'+
   '<label>Observações<input name="note" maxlength="500" value="'+esc(chosen?.note||'')+'"></label>'+
   (chosen?'<label><input name="active" type="checkbox" '+(chosen.active?'checked':'')+'> Cliente activo</label>':'')+
   '<button class="shop-submit" type="submit">'+(chosen?'Guardar alterações':'Registar cliente')+'</button></form>'+
   (chosen&&['owner','manager'].includes(role)?
    '<form data-shop-form="credit_policy" class="shop-form">'+
    '<input name="customer_id" type="hidden" value="'+esc(chosen.id)+'">'+
    '<input name="expected_revision" type="hidden" value="'+esc(chosen.creditRevision)+'">'+
    '<h4>Limite e bloqueio de crédito</h4>'+
    '<label>Limite máximo (MT)<input name="credit_limit" type="number" min="0" step="0.01" required value="'+esc((chosen.creditLimit/100).toFixed(2))+'"></label>'+
    '<label><input name="credit_blocked" type="checkbox" '+(chosen.creditBlocked?'checked':'')+'> Bloquear novas vendas a crédito</label>'+
    '<label>Motivo da alteração<input name="reason" minlength="3" maxlength="250" required></label>'+
    '<button class="shop-submit" type="submit">Guardar política de crédito</button></form>':'')+
   (chosen?'<h4>Histórico de compras</h4>'+history.map(s=>'<div class="credit-line">'+date(s.createdAt)+' · '+money(s.amount)+' · '+esc(s.method)+'</div>').join('')+
    '<h4>Contas correntes</h4>'+debts.map(d=>'<div class="credit-line">'+esc(DEBT_STATES[d.state]||d.state)+' · '+money(d.balance)+'</div>').join('')+
    '<button type="button" data-credit-statement="'+esc(chosen.id)+'">Imprimir extracto não fiscal</button>':''),
   'Alterações de crédito são auditadas e exigem proprietário ou gerente.')+'</div>';
 }
 const debts=credit.debts.filter(d=>filter==='all'||(filter==='open'&&d.balance>0)||d.state===filter);
 const due=credit.debts.filter(d=>d.state==='vencido');
 return '<div class="shop-two">'+panel('Gestão de dívidas',
  (['owner','manager','finance'].includes(role)&&due.length?
   '<p class="credit-warning">'+due.length+' dívida(s) vencida(s) exigem acompanhamento.</p>':'')+
  '<label>Filtrar dívidas<select id="shop-debt-filter">'+
  [['open','Em aberto'],['vencido','Vencidas'],['parcial','Parciais'],['liquidado','Liquidadas'],['all','Todas']].map(([id,label])=>
   '<option value="'+id+'"'+(filter===id?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
  '<div class="credit-list">'+(debts.length?debts.map(d=>{
   const customer=credit.customers.find(x=>x.id===d.customerId);
   return '<article class="credit-debt-item"><strong>'+esc(customer?.name||'Cliente')+'</strong>'+
    '<span class="credit-tag">'+esc(DEBT_STATES[d.state]||d.state)+'</span>'+
    '<p>Saldo: <strong>'+money(d.balance)+'</strong> de '+money(d.original)+'</p>'+
    '<small>Vencimento: '+date(d.dueOn)+' · Venda '+esc(String(d.saleId||'').slice(0,8))+'</small>'+
    '<div class="credit-debt-actions"><button type="button" data-credit-receipt="'+esc(d.id)+'">Extrato / recibo</button>'+
    (customer?.phone?'<button type="button" data-credit-whatsapp="'+esc(d.id)+'">WhatsApp</button>':'')+'</div></article>';
  }).join(''):'<p class="shop-help">Sem dívidas nesta categoria.</p>')+'</div>',
  'Não elimina dívidas ou altera vendas já concluídas.')+
  panel('Registar pagamento parcial',
   '<form data-shop-form="debt_payment" class="shop-form">'+
   select('debt_id','Dívida em aberto',credit.debts.filter(x=>x.balance>0).map(d=>({
    id:d.id,name:(credit.customers.find(c=>c.id===d.customerId)?.name||'Cliente')+' · '+money(d.balance)
   })))+
   input('amount','Valor recebido (MT)','number','min="0.01" step="0.01"')+
   '<label>Meio de pagamento<select name="method">'+
   Object.entries(prettyPayment).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></label>'+
   '<label>Referência digital (obrigatória excepto dinheiro)<input name="reference" maxlength="128" placeholder="Transacção ou comprovativo"></label>'+
   '<label><input name="confirmed" type="checkbox" required> Confirmei o recebimento real do pagamento</label>'+
   '<button class="shop-submit" type="submit" '+(!session?'disabled':'')+'>Registar cobrança</button></form>'+
   '<h4>Últimas cobranças</h4>'+
   credit.payments.slice(0,15).map(p=>'<div class="credit-line">'+date(p.createdAt)+' · '+money(p.amount)+' · '+
    esc(prettyPayment[p.method]||p.method)+'</div>').join(''),
   'Requer caixa aberto pelo próprio operador. Pagamentos digitais são confirmados manualmente.')+'</div>';
}
export function creditStatementHTML(credit,customerId,{debtId,branding,logoUrl=''}={}){
 const c=credit.customers.find(x=>x.id===customerId);
 if(!c)throw Error('customer_not_found');
 const debts=credit.debts.filter(d=>d.customerId===c.id&&(debtId?d.id===debtId:true));
 const payments=credit.payments.filter(p=>debts.some(d=>d.id===p.debtId));
 const sales=credit.sales.filter(s=>s.customerId===c.id);
 const sections=[
  {title:'Dívidas',columns:['Vencimento','Valor original','Saldo','Estado'],
   rows:debts.map(d=>[date(d.dueOn),money(d.original),money(d.balance),DEBT_STATES[d.state]||d.state])},
  {title:'Cobranças',columns:['Data','Meio','Valor','Referência'],
   rows:payments.map(p=>[date(p.createdAt),prettyPayment[p.method]||p.method,money(p.amount),p.reference])}
 ];
 if(!debtId)sections.push({title:'Compras associadas',columns:['Data','Pagamento','Valor'],
  rows:sales.map(s=>[date(s.createdAt),s.method,money(s.amount)])});
 return brandedDocumentHTML({branding,logoUrl,title:debtId?'Extracto de dívida':'Extracto de conta corrente',
  subtitle:'Extracto não fiscal, apenas informativo. Não constitui factura ou recibo fiscal.',
  meta:[['Cliente',c.name],['Contacto do cliente',c.phone||'Não informado']],sections,
  summary:[['Saldo em dívida',money(debts.reduce((sum,d)=>sum+d.balance,0))]]});
}
export function creditWhatsAppURL(credit,debtId){
 const d=credit.debts.find(x=>x.id===debtId);
 const c=credit.customers.find(x=>x.id===d?.customerId);
 if(!d||!c)throw Error('customer_not_found');
 let phone=String(c.phone||'').replace(/\D/g,'');
 if(/^8[24567]\d{7}$/.test(phone))phone='258'+phone;
 if(!/^\d{9,15}$/.test(phone))throw Error('customer_phone');
 const message='Olá '+c.name+'. Da sua conta no Pronto POS consta o saldo de '+money(d.balance)+
  ', com vencimento em '+date(d.dueOn)+'. Contacte a loja para confirmar os dados. Obrigado.';
 return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message);
}

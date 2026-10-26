import {catalogControls} from './ui/pronto-catalog-controls.js';
// Protected purchase and expenditure screens for the Supabase merchant pilot.
// Financial operations always use authenticated RPCs and audit on server.
import {esc,MONEY} from './supabase-shop-core.js';
const fmt=c=>MONEY(Number(c)||0);
const f=(name,label,type='text',extra='',value='')=>'<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+type+'" '+extra+' value="'+esc(value)+'" required></label>';
const section=(title,desc,body)=>'<section class="shop-box"><h3>'+esc(title)+'</h3><p class="shop-help">'+esc(desc)+'</p>'+body+'</section>';
const options=(rows,prompt='Seleccione')=>'<option value="">'+esc(prompt)+'</option>'+rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
const mzDate=date=>{
 const parsed=new Date(date);
 return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('en-CA',{
  timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'
 }).format(parsed):'';
};
const expenseMethods={cash:'Dinheiro',mpesa:'M-Pesa',emola:'e-Mola',transfer:'Transferência',bank:'Banco'};
const expenseRow=e=>'<div class="expense-history-row"><div><strong>'+esc(e.label)+'</strong><small>'+
 esc(e.category)+' · '+esc(expenseMethods[e.method]||e.method||'Não indicado')+
 (mzDate(e.date)?' · '+esc(mzDate(e.date)):'')+'</small></div><strong>'+fmt(e.amount)+'</strong></div>';
export const FINANCE_TABS=['suppliers','purchases','expenses'];
export function normalizeFinanceSnapshot(raw){
 if(!raw||!['suppliers','purchases','expenses','schedules'].every(key=>Array.isArray(raw[key])))throw Error('finance_snapshot_invalid');
 return {
  suppliers:raw.suppliers.map(s=>({id:s.id,name:String(s.name||''),phone:String(s.phone||''),address:String(s.address||''),active:s.active===true})),
  purchases:raw.purchases.map(p=>({id:p.id,supplier:String(p.supplier||''),total:Number(p.total_cents)||0,balance:Number(p.balance_cents)||0,items:Array.isArray(p.items)?p.items:[],date:p.created_at})),
  expenses:raw.expenses.map(e=>({id:e.id,label:String(e.label||''),category:String(e.category||''),amount:Number(e.amount_cents)||0,method:e.method,date:e.created_at})),
  schedules:raw.schedules.map(s=>({id:s.id,label:String(s.label||''),amount:Number(s.amount_cents)||0,nextDue:s.next_due_on,category:s.category,repeatMonths:s.repeat_months,active:s.active===true})),
  generatedAt:raw.generated_at
 };
}
const payMethods='<option value="cash">Dinheiro</option><option value="mpesa">M-Pesa</option><option value="emola">e-Mola</option><option value="transfer">Transferência</option><option value="bank">Banco</option>';
export function renderFinanceView({view,finance,products=[],supplierId='',lines=1,role='',session=null,today=mzDate(new Date())}){
 if(!finance)return section('Compras e despesas','','');
 if(view==='suppliers'){
  const chosen=finance.suppliers.find(x=>x.id===supplierId);
  return '<div class="shop-two">'+section('Fornecedores','Consulte os fornecedores registados no seu negócio.',
   '<div class="credit-list">'+(finance.suppliers.length?finance.suppliers.map(s=>
    '<button type="button" data-finance-supplier="'+esc(s.id)+'" class="credit-list-item">'+esc(s.name)+
    '<small>'+esc(s.phone)+' · '+(s.active?'Activo':'Inactivo')+'</small></button>').join(''):
    '<p class="shop-help">Sem fornecedores registados.</p>')+'</div>')+
   section(chosen?'Editar fornecedor':'Novo fornecedor',
    'Dados acessíveis apenas aos membros autorizados da empresa.',
    '<form data-shop-form="supplier_save" class="shop-form">'+
    (chosen?'<input type="hidden" name="supplier_id" value="'+esc(chosen.id)+'">':'')+
    f('name','Nome','text','maxlength="160"',chosen?.name||'')+
    f('phone','Contacto','tel','maxlength="60"',chosen?.phone||'').replace(' required>','>')+
    f('address','Localização','text','maxlength="250"',chosen?.address||'').replace(' required>','>')+
    (chosen?'<label><input name="active" type="checkbox" '+(chosen.active?'checked':'')+'> Activo</label>':'')+
    '<button type="submit" class="shop-submit">Guardar fornecedor</button></form>'+
    (chosen&&['owner','manager'].includes(role)?catalogControls({kind:'supplier',id:chosen.id,active:chosen.active}):''))+'</div>';
 }
 if(view==='purchases'){
  const productRows=Array.from({length:Math.max(1,Math.min(15,lines))},(_,i)=>
   '<div class="finance-purchase-line"><strong>Artigo '+(i+1)+'</strong>'+
   '<label>Produto<select name="product_id_'+i+'" required>'+options(products)+'</select></label>'+
   f('quantity_'+i,'Quantidade','number','min="0.001" step="0.001"')+
   f('cost_'+i,'Custo unitário (MT)','number','min="0" step="0.01"')+
   f('lot_'+i,'Lote','text','maxlength="100"').replace(' required>','>')+
   '<label>Validade (opcional)<input name="expiry_'+i+'" type="date"></label></div>').join('');
  const purchases=finance.purchases.slice(0,30);
  return '<div class="shop-two">'+section('Registar compra e entrada de stock',
   'A compra cria lotes, movimentos de stock e dívida ao fornecedor numa única transacção. É necessário cadastrar o fornecedor e os artigos primeiro.',
   '<form data-shop-form="purchase_receive" class="shop-form">'+
   '<label>Fornecedor<select name="supplier_id" required>'+options(finance.suppliers.filter(x=>x.active))+'</select></label>'+
   f('invoice_ref','Referência da factura','text','maxlength="120"').replace(' required>','>')+
   '<label>Vencimento da conta a pagar (opcional)<input name="due_on" type="date"></label>'+
   '<div class="finance-purchase-lines">'+productRows+'</div>'+
   '<button type="button" data-finance-add-line>+ Adicionar artigo</button>'+
   '<button class="shop-submit" type="submit">Registar compra e receber stock</button></form>')+
   section('Contas a fornecedores',
   'Pagamentos registados manualmente, com valores em meticais. Não se efectuam transferências automáticas.',
   '<form data-shop-form="purchase_payment" class="shop-form">'+
   '<label>Compra em aberto<select name="purchase_id" required>'+
   options(finance.purchases.filter(p=>p.balance>0).map(p=>({id:p.id,name:p.supplier+' · '+fmt(p.balance)})))+'</select></label>'+
   f('amount','Montante a pagar (MT)','number','min="0.01" step="0.01"')+
   '<label>Pagamento<select name="method">'+payMethods+'</select></label>'+
   f('reference','Referência digital','text','maxlength="128"').replace(' required>','>')+
   '<label><input type="checkbox" name="confirmed" required> Confirmo que efectuei o pagamento</label>'+
   '<button type="submit" class="shop-submit">Registar pagamento</button></form>'+
   '<h4>Últimas compras</h4>'+purchases.map(p=>
    '<div class="credit-line">'+esc(p.supplier)+' · '+fmt(p.total)+' · Por pagar: '+fmt(p.balance)+'</div>').join(''))+'</div>';
 }
 const expenses=finance.expenses.slice(0,300);
 const todayExpenses=expenses.filter(e=>mzDate(e.date)===today);
 const earlierExpenses=expenses.filter(e=>mzDate(e.date)!==today).slice(0,40);
 const todayTotal=todayExpenses.reduce((sum,e)=>sum+e.amount,0);
 const due=finance.schedules.filter(x=>x.active&&x.nextDue<=today);
 return '<div class="shop-two">'+section('Registar despesa diária',
  'Registe despesas do funcionamento da loja, como sabão para limpar o balcão, transporte, embalagens ou energia. A data é registada automaticamente.',
  '<form class="shop-form" data-shop-form="expense_add">'+
  f('label','O que foi comprado / motivo','text','maxlength="180" placeholder="Ex.: Sabão para limpar o balcão"')+
  f('category','Categoria','text','maxlength="80" list="expense-category-suggestions" placeholder="Seleccione ou escreva"')+
  '<datalist id="expense-category-suggestions">'+
  ['Limpeza e higiene','Transporte','Água e energia','Embalagens','Manutenção','Renda','Salários','Internet e comunicações','Alimentação','Outras'].map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist>'+
  f('amount','Valor (MT)','number','min="0.01" step="0.01"')+
  '<label>Meio de pagamento<select name="method">'+payMethods+'</select></label>'+
  f('reference','Referência (se não for em dinheiro)','text','maxlength="128"').replace(' required>','>')+
  '<p class="shop-help">Pagamentos em dinheiro são debitados no caixa aberto do operador; os restantes meios devem ser confirmados manualmente.</p>'+
  '<label><input type="checkbox" name="confirmed" required> Confirmo que a despesa foi paga</label>'+
  '<button class="shop-submit" type="submit">Registar despesa</button></form>'+
  '<h4>Despesas de hoje</h4><div class="expense-daily-summary"><small>'+esc(today)+'</small><strong>'+fmt(todayTotal)+'</strong><span>'+todayExpenses.length+' registo(s) entre as despesas carregadas</span></div>'+
  (todayExpenses.length?todayExpenses.map(expenseRow).join(''):'<p class="shop-help">Ainda não há despesas registadas hoje.</p>')+
  '<h4>Despesas anteriores</h4>'+
  (earlierExpenses.length?earlierExpenses.map(expenseRow).join(''):'<p class="shop-help">Sem despesas anteriores neste histórico.</p>')+
  (expenses.length>=300?'<p class="shop-help">Histórico limitado às 300 despesas mais recentes. Consulte os relatórios para períodos anteriores.</p>':''))+
  section('Despesas recorrentes',
   'Registe lembretes de despesas periódicas. Os pagamentos NÃO são efectuados automaticamente; precisam de confirmação.',
   (due.length?'<p class="credit-warning">'+due.length+' despesa(s) recorrente(s) vencida(s) para confirmar.</p>':'')+
   '<form data-shop-form="expense_schedule_save" class="shop-form">'+
   f('label','Descrição da despesa','text','maxlength="180"')+
   f('category','Categoria','text','maxlength="80"','Outras')+
   f('amount','Valor previsto (MT)','number','min="0.01" step="0.01"')+
   '<label>Repetir de quantos em quantos meses<input name="repeat_months" type="number" min="1" max="12" value="1" required></label>'+
   f('next_due_on','Próxima data prevista','date')+
   '<button class="shop-submit" type="submit">Guardar lembrete recorrente</button></form>'+
   '<h4>Próximos lembretes</h4>'+finance.schedules.map(x=>
    '<div class="credit-line">'+esc(x.label)+' · '+fmt(x.amount)+' · '+esc(x.nextDue)+'</div>').join(''))+'</div>';
}

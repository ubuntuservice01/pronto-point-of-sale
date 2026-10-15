import {esc,MONEY,UNIT_OPTIONS,PAYMENT_METHODS,cartTotal,toCents} from './supabase-shop-core.js';
import {renderCreditView,creditCheckoutFields} from './supabase-credit-ui.js';
import {renderFinanceView} from './supabase-finance-ui.js';
import {renderReturnView} from './supabase-returns-ui.js';
import {renderInventoryView} from './supabase-inventory-ui.js';
import {renderReportsView} from './supabase-reports-ui.js';

const methodLabels={cash:'Dinheiro',mpesa:'M-Pesa',emola:'e-Mola',transfer:'Transferência',mixed:'Repartido'};
const safeDate=value=>{
 const d=new Date(value);
 return Number.isFinite(d.getTime())?d.toLocaleString('pt-PT',{dateStyle:'short',timeStyle:'short',timeZone:'Africa/Maputo'}):'—';
};
const options=items=>items.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
const field=(name,label,value='',extra='')=>'<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'" '+extra+'></label>';
const section=(title,content,sub='')=>'<section class="shop-box"><h3>'+esc(title)+'</h3>'+(sub?'<p class="shop-help">'+esc(sub)+'</p>':'')+content+'</section>';
const cartRow=(item,products)=>{
 const p=products.find(x=>x.id===item.productId);
 if(!p)return '<p class="shop-error">Produto indisponível. Retire-o do carrinho.</p>';
 return '<div class="shop-cart-row"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+' · '+MONEY(p.priceCents)+' / '+esc(p.unit)+'</small></div>'+
  '<div class="shop-cart-qty"><button type="button" data-qty="-1" data-id="'+esc(p.id)+'" aria-label="Reduzir quantidade">−</button>'+
  '<input type="number" data-cart-qty="'+esc(p.id)+'" value="'+esc(item.quantity)+'" min="0.001" step="0.001" aria-label="Quantidade de '+esc(p.name)+'"><button type="button" data-qty="1" data-id="'+esc(p.id)+'" aria-label="Aumentar quantidade">+</button>'+
  '<button type="button" class="shop-clear-row" data-remove="'+esc(p.id)+'" aria-label="Remover produto">×</button></div></div>';
};
export function shopPaymentPanel({method,cart,products,discount='0',session,role='owner',credit=null,selectedCustomerId='',creditDue=''}){
 let subtotal=0,total=0,err='';
 try{({subtotal,total}=cartTotal(cart,products,toCents(discount)))}catch(e){err=e.message;}
 const methods=['cash','mpesa','emola','transfer','mixed'];
 const buttons='<div class="shop-methods" role="group" aria-label="Forma de pagamento">'+methods.map(m=>
  '<button type="button" data-shop-method="'+m+'" aria-pressed="'+(method===m)+'" class="'+(method===m?'selected':'')+'">'+methodLabels[m]+'</button>').join('')+'</div>';
 const amounts=method==='credit'?'<p class="shop-help">Venda a crédito: não recebe dinheiro neste momento; cria uma dívida e baixa o stock após confirmação.</p>':method==='mixed'?'<div class="shop-payment-grid">'+PAYMENT_METHODS.map(m=>
  field('pay_'+m,methodLabels[m]+' (MT)','0.00','type="number" min="0" step="0.01" inputmode="decimal"')).join('')+'</div>':
  '<p class="shop-help">Pagamento único: '+esc(methodLabels[method])+' · '+MONEY(total)+'.</p>';
 const cash=method==='cash'||method==='mixed'?
  field('cash_received','Dinheiro recebido (MT)',method==='cash'?(total/100).toFixed(2):'0.00','type="number" min="0" step="0.01" inputmode="decimal" required'):'';
 return '<div id="shop-checkout-panel">'+
  section('A sua venda','<div class="shop-cart-list">'+(cart.length?cart.map(x=>cartRow(x,products)).join(''):'<p class="shop-help">Seleccione um produto à esquerda.</p>')+'</div>'+
  '<div class="shop-totals"><span>Subtotal</span><strong>'+MONEY(subtotal)+'</strong></div>'+
  field('discount',role==='cashier'?'Desconto (requer gerente)':'Desconto (MT)',discount,'type="number" min="0" step="0.01" inputmode="decimal"'+(role==='cashier'?' disabled':''))+
  '<div class="shop-totals shop-total"><span>Total</span><strong>'+MONEY(total)+'</strong></div>'+
  (err?'<p class="shop-error">'+esc(err)+'</p>':'')+
  '<h4>Forma de pagamento</h4>'+buttons+
  '<form id="shop-sale-form">'+creditCheckoutFields({credit,selected:selectedCustomerId,method})+amounts+cash+
  (method==='credit'?'<label>Prazo de pagamento<input type="date" id="shop-credit-due" name="credit_due" min="'+esc(credit?.today||'')+'" value="'+esc(creditDue)+'" required></label>':'')+
  (method!=='credit'?'<label class="shop-confirm"><input type="checkbox" name="confirmed" value="yes"> Confirmei os pagamentos digitais na conta da loja, quando aplicável</label>':'')+
  '<p class="shop-help">Os pagamentos M-Pesa, e-Mola e transferência não são verificados automaticamente pela operadora.</p>'+
  (['owner','manager','cashier'].includes(role)?'<button type="button" class="shop-credit-toggle" data-shop-credit aria-pressed="'+(method==='credit')+'">'+(method==='credit'?'Voltar a pagamento imediato':'Vender a crédito')+'</button>':'')+
  '<button class="shop-submit" type="submit" '+(!session||!cart.length||err||(method==='credit'&&!credit)?'disabled':'')+'>'+(method==='credit'?'Registar dívida':'Concluir venda')+' · '+MONEY(total)+'</button></form>',
  'Só conclua após confirmar o recebimento.')+'</div>';
}
export function renderShopScreen({account,grants,grant,branches,branchId,data,cart,view,method,discount,query,feedback,pending,draftAvailable=false,credit=null,customerQuery='',debtFilter='open',selectedCustomerId='',creditDue='',finance=null,supplierId='',purchaseLines=1,pendingFinance=null,heldSales=[],returns=null,selectedReturnSaleId='',inventory=null,selectedProductId='',alertDays=30,inventoryQuery='',report=null,reportFrom='',reportTo='',reportScope='branch',branchManagement=null}){
 const products=data?.products||[];
 const session=data?.sessions.find(s=>s.operatorId===account.userId)||null;
 const branch=branches.find(b=>b.id===branchId);
 const nav=[['sell','Vender'],['products','Produtos e stock'],['cash','Caixa'],['history','Vendas recentes'],['customers','Clientes'],['debts','Gestão de dívidas'],['suppliers','Fornecedores'],['purchases','Compras'],['expenses','Despesas'],['held','Vendas em espera'],['returns','Devoluções'],['inventory','Inventário'],['alerts','Alertas'],['shopping_list','Lista de compras'],['reports','Relatórios'],['team','Colaboradores'],['branches','Filiais']].filter(([key])=>({sell:['owner','manager','cashier'],products:['owner','manager','stock'],cash:['owner','manager','cashier'],history:['owner','manager','cashier','finance'],customers:['owner','manager','cashier','finance'],debts:['owner','manager','cashier','finance'],suppliers:['owner','manager','stock','finance'],purchases:['owner','manager','stock','finance'],expenses:['owner','manager','finance'],held:['owner','manager','cashier'],returns:['owner','manager'],inventory:['owner','manager','stock','finance'],alerts:['owner','manager','stock','finance'],shopping_list:['owner','manager','stock','finance'],reports:['owner','manager','cashier','finance'],team:['owner'],branches:['owner']})[key].includes(grant.role));
 const menu=nav.map(([key,name])=>'<button type="button" data-shop-view="'+key+'" '+(view===key?'aria-current="page"':'')+'>'+name+'</button>').join('');
 const prodCards=products.filter(p=>(p.name+' '+p.code).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  .map(p=>'<article class="shop-product">'+(p.photoPath?'<img class="shop-product-photo" data-shop-product-photo="'+esc(p.photoPath)+'" alt="Fotografia de '+esc(p.name)+'" loading="lazy">':'')+'<div><small>'+esc(p.code)+' · '+esc(p.category)+'</small><strong>'+esc(p.name)+'</strong><span>'+MONEY(p.priceCents)+' / '+esc(p.unit)+'</span><small class="'+(p.stock<=p.minStock?'shop-low':'')+'">Disponível: '+p.stock+'</small></div><button type="button" data-shop-add="'+esc(p.id)+'" '+(p.stock<=0?'disabled':'')+' aria-label="Adicionar '+esc(p.name)+'">+</button></article>').join('');
 let body='';
 if(view==='sell'){
  body='<div class="shop-sales-grid"><section class="shop-box"><h3>Produtos</h3><label class="shop-search"><span>Pesquisar por nome ou código</span>'+
   '<input id="shop-search" type="search" value="'+esc(query)+'" autocomplete="off" placeholder="Pesquisar ou ler o código"></label>'+
   '<div id="shop-product-results" class="shop-products">'+(prodCards||'<p class="shop-help">Não há produtos encontrados.</p>')+'</div></section>'+
   shopPaymentPanel({method,cart,products,discount,session,role:grant.role,credit,selectedCustomerId,creditDue})+'</div>'+   (cart.length?'<div class="shop-hold-actions"><button type="button" data-shop-hold>Suspender esta venda</button><small>A venda em espera não reserva stock nem confirma pagamentos.</small></div>':'');
  if(pending)body+='<div class="shop-pending"><strong>Venda com confirmação pendente</strong><p>Não crie outra venda antes de verificar se esta foi concluída. Pode repetir o mesmo pedido sem duplicar o registo ou descartá-lo após conferência.</p><button type="button" data-shop-retry>Repetir o mesmo pedido</button><button type="button" data-shop-discard>Descartar pedido pendente</button></div>';
 }else if(view==='customers'||view==='debts'){
  body=renderCreditView({view,credit,role:grant.role,query:customerQuery,filter:debtFilter,session,selectedCustomerId});
 }else if(['suppliers','purchases','expenses'].includes(view)){
  body=renderFinanceView({view,finance,products,supplierId,lines:purchaseLines,role:grant.role,session});
 }else if(view==='held'){
  body='<section class="shop-box"><h3>Vendas em espera</h3><p class="shop-help">Os carrinhos ficam guardados na filial. Ao recuperar, o stock e os preços são revalidados no servidor.</p>'+
   (heldSales.length?heldSales.map(h=>'<article class="credit-debt-item"><strong>'+esc(h.cart.length)+' artigo(s)</strong><small> · '+esc(String(h.createdAt||''))+'</small><div class="credit-debt-actions"><button type="button" data-shop-hold-resume="'+esc(h.id)+'">Retomar</button><button type="button" data-shop-hold-delete="'+esc(h.id)+'">Eliminar</button></div></article>').join(''):'<p class="shop-help">Não existem vendas suspensas nesta filial.</p>')+'</section>';
 }else if(view==='returns'){
  body=renderReturnView({returns,selectedSaleId:selectedReturnSaleId,session});
 }else if(['inventory','alerts','shopping_list'].includes(view)){
  body=renderInventoryView({view,inventory,role:grant.role,selectedProductId,alertDays,query:inventoryQuery});
 }else if(view==='reports'){
  body=renderReportsView({report,from:reportFrom,to:reportTo,scope:reportScope,
   allAllowed:['owner','manager','finance'].includes(grant.role)});
 }else if(view==='branches'&&grant.role==='owner'){
  const items=branchManagement?.branches||[];
  body=section('Gestão de filiais',
   '<form data-shop-form="branch_create" class="shop-form">'+
   field('name','Nome da nova filial','','required minlength="2" maxlength="120"')+
   '<button class="shop-submit" type="submit">Criar filial</button></form>'+
   '<div class="credit-list">'+items.map(b=>'<div class="credit-debt-item">'+
    '<strong>'+esc(b.name)+'</strong><small> · '+(b.active?'Activa':'Inactiva')+
    ' · '+esc(b.products)+' produto(s) · '+esc(b.open_cash)+' caixa(s) abertos</small>'+
    '<form data-shop-form="branch_rename" class="shop-form">'+
    '<input type="hidden" name="branch_id" value="'+esc(b.id)+'">'+
    field('name','Novo nome',b.name,'required minlength="2" maxlength="120"')+
    '<button type="submit">Renomear</button></form>'+
    '<button type="button" data-branch-toggle="'+esc(b.id)+'" data-branch-active="'+b.active+'">'+
    (b.active?'Desactivar':'Reactivar')+'</button></div>').join('')+'</div>',
   'Só o proprietário altera filiais. Não é possível desactivar a última filial, uma filial com caixa aberto, stock ou vendas em espera.');
 }else if(view==='products'){
  body='<div class="shop-two">'+section('Novo produto','<form data-shop-form="product_create" class="shop-form">'+
   field('name','Nome do produto','','required maxlength="200"')+
   field('category','Categoria','Geral','maxlength="100"')+
   '<label>Unidade<select name="unit">'+UNIT_OPTIONS.map(u=>'<option value="'+esc(u)+'">'+esc(u)+'</option>').join('')+'</select></label>'+
   field('price','Preço de venda (MT)','','required type="number" min="0.01" step="0.01"')+
   field('code','Código de fábrica (opcional)','','maxlength="80" placeholder="Será gerado se vazio"')+
   field('min_stock','Stock mínimo','0','type="number" min="0" step="0.001"')+
   '<button type="submit" class="shop-submit">Cadastrar produto</button></form>','Código interno único, gerado automaticamente quando não houver código de fábrica.')+
   section('Importar produtos por CSV','Até 100 artigos por ficheiro. Colunas obrigatórias: nome;categoria;preco. O stock inicial é opcional. Reveja os dados antes de confirmar.',
   '<form data-shop-form="csv_import" class="shop-form">'+
   '<label>Ficheiro CSV (até 100 produtos)<input type="file" name="csv_file" accept=".csv,text/csv,text/plain" required></label>'+
   '<label><input type="checkbox" name="confirm_import" required> Confirmei os preços, códigos e quantidades do ficheiro</label>'+
   '<button class="shop-submit" type="submit">Validar e importar produtos</button></form>')+
   section('Receber stock','<form data-shop-form="stock_receive" class="shop-form">'+
   '<label>Produto<select name="product_id" required><option value="">Seleccione o artigo</option>'+options(products)+'</select></label>'+
   field('quantity','Quantidade','','required type="number" min="0.001" step="0.001"')+
   field('lot_number','Número do lote (opcional)','','maxlength="100"')+
   field('expires_on','Data de validade (opcional)','','type="date"')+
   field('unit_cost','Custo por unidade (MT, opcional)','','type="number" min="0" step="0.01"')+
   '<button class="shop-submit" type="submit">Registar entrada de stock</button></form>','Cria um lote e um movimento de entrada, sem alterar vendas anteriores.')+'</div>';
 }else if(view==='cash'){
  body=section('Sessão de caixa',
   session?'<p>Caixa aberto em '+esc(safeDate(session.openedAt))+'. Fundo inicial: <strong>'+MONEY(session.openingCash)+'</strong>.</p>'+
   '<form data-shop-form="cash_close" class="shop-form">'+field('counted_cash','Dinheiro contado no caixa (MT)','','required type="number" min="0" step="0.01"')+
   '<button class="shop-submit" type="submit">Fechar e reconciliar caixa</button></form>'+ 
   '<form data-shop-form="cash_move" class="shop-form"><h4>Entrada / retirada de dinheiro</h4><label>Movimento<select name="direction"><option value="in">Entrada</option><option value="out">Retirada</option></select></label>'+
   field('amount','Valor (MT)','','type="number" min="0.01" step="0.01" required')+
   field('reason','Motivo','','minlength="3" maxlength="180" required')+
   '<button class="shop-submit" type="submit">Registar movimento no caixa</button></form>':
   '<p>Não existe uma sessão de caixa aberta nesta filial para esta conta.</p>'+
   '<form data-shop-form="cash_open" class="shop-form">'+field('device_id','Identificação do terminal','CAIXA-01','required minlength="2" maxlength="100"')+
   field('opening_cash','Fundo inicial (MT)','0','required type="number" min="0" step="0.01"')+
   '<button class="shop-submit" type="submit">Abrir caixa</button></form>',
   'Cada operador abre e fecha a sua própria sessão. O fecho compara o dinheiro contado com o dinheiro esperado.');
 }else if(view==='team'&&grant.role==='owner'){
  body=section('Convidar colaboradores',
   '<form data-shop-form="team_invite" class="shop-form">'+
   field('name','Nome completo','','required minlength="2" maxlength="120"')+
   field('email','Email do colaborador','','type="email" required maxlength="254"')+
   '<label>Função<select name="role" required>'+
   '<option value="cashier">Caixa / Vendedor</option><option value="manager">Gerente</option>'+
   '<option value="stock">Stock</option><option value="finance">Financeiro</option></select></label>'+
   '<button type="submit" class="shop-submit">Enviar convite ao colaborador</button></form>'+
   '<p class="shop-help">Cada colaborador aceita o convite, inicia sessão na sua conta e define o próprio PIN de cinco dígitos. O proprietário não recebe nem conhece esse PIN.</p>',
   'Apenas o proprietário pode convidar funcionários; esta página não cria novos proprietários.');
 }else{
  body=section('Vendas registadas nesta filial',
   '<div class="shop-history">'+(data?.sales.length?data.sales.map(s=>
    '<div><strong>'+MONEY(s.amount)+'</strong><small>'+esc(s.method)+' · '+esc(safeDate(s.date))+'</small><span>Ref. '+esc(s.id.slice(0,8))+'</span></div>').join(''):
    '<p class="shop-help">Ainda não existem vendas registadas no Supabase.</p>')+'</div>',
   'Apresentação limitada às últimas 20 vendas autorizadas. Não substitui os relatórios fiscais.');
 }
 return '<div class="shop-shell"><header class="shop-header"><div class="shop-brand"><img src="/icon.svg" alt=""><span><strong>Pronto POS</strong><small>Operação Supabase · Piloto</small></span></div>'+
 '<div class="shop-account"><strong>'+esc(grant.name)+'</strong><small>'+esc(account.email)+' · '+esc(grant.role)+'</small></div>'+
 '<button type="button" data-shop-logout class="shop-logout">Sair</button></header>'+
 '<div class="shop-toolbar"><label>Empresa<select id="shop-business-select">'+grants.map(b=>'<option value="'+esc(b.id)+'" '+(b.id===grant.id?'selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select></label>'+
 '<label>Filial<select id="shop-branch-select">'+branches.map(b=>'<option value="'+esc(b.id)+'" '+(b.id===branchId?'selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select></label>'+
 '<button type="button" data-shop-refresh>Actualizar dados</button><span class="shop-cash-indicator">'+(session?'Caixa aberto':'Caixa fechado')+'</span></div>'+
 '<nav class="shop-nav">'+menu+'</nav>'+
 '<main class="shop-main"><div id="shop-message" role="status" aria-live="polite">'+esc(feedback||'')+'</div>'+
 '<h2>'+esc(branch?.name||'Loja')+'</h2>'+body+
 '<section class="shop-box shop-draft-section"><h3>Recuperação de carrinhos</h3><p class="shop-help">Pode guardar o carrinho encriptado neste dispositivo. Sem internet, não é possível finalizar nem cobrar uma venda pelo Supabase. Não há sincronização automática.</p>'+
 (cart.length||pending?'<form data-shop-form="draft_save" class="shop-form"><label>Frase de recuperação (mínimo 12 caracteres)<input type="password" name="passphrase" minlength="12" maxlength="128" autocomplete="off" required></label><button class="shop-submit" type="submit">Guardar rascunho encriptado</button></form>':'')+
 (draftAvailable?'<form data-shop-form="draft_restore" class="shop-form"><label>Frase do rascunho guardado<input type="password" name="passphrase" minlength="12" maxlength="128" autocomplete="off" required></label><button class="shop-submit" type="submit">Recuperar rascunho</button></form><button type="button" data-shop-draft-clear class="shop-logout">Apagar rascunho do dispositivo</button>':'')+
 '<p class="shop-help">Se uma venda foi enviada e a resposta falhou, recupere o mesmo pedido e a mesma referência antes de reenviar. Não crie uma venda nova sem conferir os registos.</p></section>'+
 (pendingFinance?'<div class="shop-pending"><strong>Operação financeira por confirmar</strong><p>Verifique o histórico no Supabase antes de tentar outra operação. Repetir o mesmo formulário reutiliza a chave original.</p><button type="button" data-finance-discard>Descartar referência local após conferir</button></div>':'')+
 '<p class="shop-footer">Piloto PostgreSQL: clientes, vendas a crédito e cobrança manual integrados. Devoluções, vendas offline sincronizadas e documentos fiscais ainda não estão homologados.</p></main></div>';
}

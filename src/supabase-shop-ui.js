import {renderCashManagement,ownOpenSession} from './supabase-cash-ui.js';
import {esc,MONEY,UNIT_OPTIONS,PAYMENT_METHODS,cartTotal,toCents,allowsFractionalSale,saleQuantityLabel} from './supabase-shop-core.js';
import {renderCreditView,creditCheckoutFields} from './supabase-credit-ui.js';
import {renderFinanceView} from './supabase-finance-ui.js';
import {renderReturnView} from './supabase-returns-ui.js';
import {renderInventoryView,inventoryNotificationSummary} from './supabase-inventory-ui.js';
import {icon} from './icons.js';
import {renderReportsView} from './supabase-reports-ui.js';
import {renderDocumentBrandingSettings} from './supabase-document-branding.js';
import {renderTransfersView} from './supabase-transfers-ui.js';
import {renderStaffManagement} from './supabase-team-management-ui.js';
import {renderSuspendedCash} from './supabase-staff-cash-ui.js';
import {renderAuditView} from './supabase-audit-ui.js';
import {renderMedicineFields,renderPharmacyCategory,businessTypeLabel} from './pharmacy.js';
import {maputoToday} from './pharmacy-batches.js';
import {renderPharmacyReviews} from './pharmacy-review-ui.js';
import {renderPharmacyTrace} from './pharmacy-trace-ui.js';

const methodLabels={cash:'Dinheiro',mpesa:'M-Pesa',emola:'e-Mola',transfer:'Transferência',bank:'Banco',mixed:'Repartido'};
const paymentMethodButtons=(method,extraClass='',label='Forma de pagamento')=>
 '<div class="shop-methods'+(extraClass?' '+extraClass:'')+'" role="group" aria-label="'+esc(label)+'">'+
 [...PAYMENT_METHODS,'mixed'].map(m=>'<button type="button" data-shop-method="'+m+'" aria-pressed="'+(method===m)+'" class="'+(method===m?'selected':'')+'">'+methodLabels[m]+'</button>').join('')+'</div>';
const safeDate=value=>{
 const d=new Date(value);
 return Number.isFinite(d.getTime())?d.toLocaleString('pt-PT',{dateStyle:'short',timeStyle:'short',timeZone:'Africa/Maputo'}):'—';
};
const options=items=>items.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
const field=(name,label,value='',extra='')=>'<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'" '+extra+'></label>';
const section=(title,content,sub='')=>'<section class="shop-box"><h3>'+esc(title)+'</h3>'+(sub?'<p class="shop-help">'+esc(sub)+'</p>':'')+content+'</section>';
const cartRow=(item,products,valueModeProducts=[])=>{
 const p=products.find(x=>x.id===item.productId);
 if(!p)return '<p class="shop-error">Produto indisponível. Retire-o do carrinho.</p>';
 const byValue=valueModeProducts.includes(p.id),amount=Math.round(p.priceCents*item.quantity);
 return '<div class="shop-cart-row"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+' · '+MONEY(p.priceCents)+' / '+esc(p.unit)+'</small>'+
  '<button type="button" class="sale-value-toggle" data-shop-value-toggle="'+esc(p.id)+'" aria-pressed="'+byValue+'">'+(byValue?'⇄ Por quantidade':'⇄ Por valor (MT)')+'</button>'+
  (byValue?'<small class="sale-value-equivalent">'+esc(saleQuantityLabel(item.quantity,p.unit))+' · '+MONEY(amount)+'</small>':'')+'</div>'+
  '<div class="shop-cart-qty">'+(byValue?'<label class="sale-value-label">Valor (MT)<input type="number" data-shop-cart-value="'+esc(p.id)+'" value="'+(amount/100).toFixed(2)+'" min="0.01" step="0.01" inputmode="decimal" aria-label="Valor para '+esc(p.name)+'"></label>':
  '<button type="button" data-qty="-1" data-id="'+esc(p.id)+'" aria-label="Reduzir quantidade">−</button>'+
  '<input type="number" data-cart-qty="'+esc(p.id)+'" value="'+esc(item.quantity)+'" min="'+(allowsFractionalSale(p)?'0.001':'1')+'" step="'+(allowsFractionalSale(p)?'0.001':'1')+'" aria-label="Quantidade de '+esc(p.name)+'"><button type="button" data-qty="1" data-id="'+esc(p.id)+'" aria-label="Aumentar quantidade">+</button>')+
  '<button type="button" class="shop-clear-row" data-remove="'+esc(p.id)+'" aria-label="Remover produto">×</button></div></div>';
};
export function shopPaymentPanel({method,cart,products,discount='0',session,role='owner',credit=null,selectedCustomerId='',creditDue='',allowNoSession=false,valueModeProducts=[]}){
 let subtotal=0,total=0,err='';
 try{({subtotal,total}=cartTotal(cart,products,toCents(discount)))}catch(e){err=e.message;}
 const creditCustomer=credit?.customers.find(c=>c.id===selectedCustomerId&&c.active);
 const outstanding=creditCustomer?credit.debts.filter(d=>d.customerId===creditCustomer.id&&d.balance>0)
  .reduce((sum,d)=>sum+d.balance,0):0;
 const available=creditCustomer?Math.max(0,creditCustomer.creditLimit-outstanding):0;
 const creditWarning=method==='credit'&&creditCustomer&&total>available?
  '<p class="shop-error" role="alert" data-credit-limit-warning>Não é possível registar esta dívida: crédito disponível de '+MONEY(available)+
  ' para uma venda de '+MONEY(total)+'. Peça ao proprietário ou gerente para actualizar o limite na opção Clientes.</p>':'';
 const buttons=paymentMethodButtons(method);
 const amounts=method==='credit'?'<p class="shop-help">Venda a crédito: não recebe dinheiro neste momento; cria uma dívida e baixa o stock após confirmação.</p>':method==='mixed'?'<div class="shop-payment-grid">'+PAYMENT_METHODS.map(m=>
  field('pay_'+m,methodLabels[m]+' (MT)','0.00','type="number" min="0" step="0.01" inputmode="decimal"')).join('')+'</div>':
  '<p class="shop-help">Pagamento único: '+esc(methodLabels[method])+' · '+MONEY(total)+'.</p>';
 const cash=method==='cash'||method==='mixed'?
  field('cash_received','Dinheiro recebido (MT)','','type="number" min="0" step="0.01" inputmode="decimal" placeholder="Introduza o valor entregue" autocomplete="off"'+(method==='cash'?' required':'')):'';
 return '<div id="shop-checkout-panel">'+
  section('A sua venda','<div class="shop-cart-list">'+(cart.length?cart.map(x=>cartRow(x,products,valueModeProducts)).join(''):'<p class="shop-help">Seleccione um produto à esquerda.</p>')+'</div>'+
  '<div class="shop-totals"><span>Subtotal</span><strong>'+MONEY(subtotal)+'</strong></div>'+
  field('discount',role==='cashier'?'Desconto (requer gerente)':'Desconto (MT)',discount,'type="number" min="0" step="0.01" inputmode="decimal"'+(role==='cashier'?' disabled':''))+
  '<div class="shop-totals shop-total"><span>Total</span><strong>'+MONEY(total)+'</strong></div>'+
  (err?'<p class="shop-error">'+esc(err)+'</p>':'')+
  '<h4>Forma de pagamento</h4>'+buttons+
  '<form id="shop-sale-form" data-shop-total-cents="'+total+'">'+creditCheckoutFields({credit,selected:selectedCustomerId,method})+amounts+cash+
  ((method==='cash'||method==='mixed')?'<div class="shop-change-preview" data-shop-change-preview data-state="waiting" role="status" aria-live="polite" aria-atomic="true">'+
   '<span class="shop-change-caption">Troco a entregar</span>'+
   '<strong data-shop-change-amount>—</strong>'+
   '<small data-shop-change-note>Introduza o valor recebido para calcular o troco.</small></div>':'')+
  (method==='credit'?'<label>Prazo de pagamento<input type="date" id="shop-credit-due" name="credit_due" min="'+esc(credit?.today||'')+'" value="'+esc(creditDue)+'" required></label>':'')+
  (method!=='credit'?'<label class="shop-confirm"><input type="checkbox" name="confirmed" value="yes"> Confirmei os pagamentos digitais na conta da loja, quando aplicável</label>':'')+
  '<p class="shop-help">Os pagamentos M-Pesa, e-Mola, transferência e Banco devem ser confirmados manualmente.</p>'+
  (['owner','manager','cashier'].includes(role)?'<button type="button" class="shop-credit-toggle" data-shop-credit aria-pressed="'+(method==='credit')+'">'+(method==='credit'?'Voltar a pagamento imediato':'Vender a crédito')+'</button>':'')+
  (cart.some(i=>products.some(p=>p.id===i.productId&&p.requiresPrescription))?'<p class="shop-help">💊 Medicamentos sujeitos a receita: ao confirmar, será preparado um pedido de validação profissional. O pagamento só deve ser recebido após autorização.</p>':'')+
  creditWarning+(method==='credit'?'<p id="shop-checkout-feedback" class="shop-error" role="alert" hidden></p>':'')+
  '<button class="shop-submit" type="submit" '+((!session&&!allowNoSession)||!cart.length||err||(method==='credit'&&!credit)?'disabled':'')+'>'+(method==='credit'?'Registar dívida':'Concluir venda')+' · '+MONEY(total)+'</button></form>',
  'Só conclua após confirmar o recebimento.')+'</div>';
}

// Centralised, owner-only settings. Actions reuse the existing audited forms and routes.
export const OWNER_SETTINGS_TABS=Object.freeze([
 ['personalizacao','Personalização','Identidade e marca'],
 ['documentos','Documentos','PDF e Excel'],
 ['caixa','Caixa e pagamentos','Regras da filial'],
 ['equipa','Equipa e acessos','Utilizadores'],
 ['filiais','Filiais','Estabelecimentos'],
 ['stock','Stock e alertas','Monitorização'],
 ['seguranca','Segurança e conta','PIN e sessões'],
 ['dados','Dados e backup','Histórico e exportações']
]);
export function renderOwnerSettings({selected='personalizacao',branding=null,logoUrl='',businessName='',businessType='general',email='',branchName='',cashState=null,staffManagement=null,branches=[],alertDays=30,pendingOffline=0}={}){
 const active=OWNER_SETTINGS_TABS.some(([key])=>key===selected)?selected:'personalizacao';
 const choose=(key,label)=>'<button type="button" data-shop-settings-section="'+key+'">'+esc(label)+' →</button>';
 const linked=(title,description,target,label)=>'<div class="owner-settings-link"><div><strong>'+esc(title)+'</strong><p>'+esc(description)+'</p></div>'+
  '<button type="button" data-shop-view="'+target+'">'+esc(label)+' →</button></div>';
 const textLine=(label,value)=>'<div class="owner-settings-fact"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>';
 const tabButtons=OWNER_SETTINGS_TABS.map(([key,label,description])=>
  '<button type="button" role="tab" id="owner-settings-tab-'+key+'" aria-controls="owner-settings-panel" aria-selected="'+(active===key)+'" data-shop-settings-section="'+key+'" class="'+(active===key?'selected':'')+'">'+
  '<strong>'+esc(label)+'</strong><small>'+esc(description)+'</small></button>').join('');
 let body='';
 if(active==='personalizacao'){
  body='<div class="owner-settings-intro"><h3>Identidade do seu negócio</h3><p>Defina uma vez o nome, endereço, contacto, e-mail, logótipo e cores. Os dados são guardados por negócio e utilizados nos documentos suportados.</p></div>'+
   '<p class="shop-help">Actividade registada: <strong>'+esc(businessTypeLabel(businessType))+'</strong></p>'+
   renderDocumentBrandingSettings({branding,logoUrl,businessName})+
   '<div class="owner-settings-next">'+choose('documentos','Configuração dos documentos')+'</div>';
 }else if(active==='documentos'){
  body='<section class="shop-box"><h3>Modelos, cabeçalhos e rodapés</h3>'+
   '<p class="shop-help">Os documentos usam a identidade guardada em Personalização. Os modelos disponíveis são Moderno, Clássico e Compacto, com logótipo, endereço, contactos, cores e mensagem de rodapé.</p>'+
   textLine('Modelo escolhido',({modern:'Moderno',classic:'Clássico',compact:'Compacto'})[branding?.template]||'Moderno')+
   textLine('Nome usado nos documentos',branding?.displayName||businessName)+
   '<div class="owner-settings-actions">'+choose('personalizacao','Alterar modelo e pré-visualizar')+'</div></section>'+
   '<section class="shop-box"><h3>Exportações</h3><p class="shop-help">Relatórios PDF (através de Imprimir/Guardar como PDF) e Excel aplicam os dados visuais do negócio. CSV é um formato simples de dados e não contém formatação nem logótipo.</p>'+
   linked('Relatórios e históricos','Escolha o mês, ano ou intervalo pretendido. Os registos existentes não são substituídos ao mudar de período.','reports','Abrir relatórios')+'</section>';
 }else if(active==='caixa'){
  body='<section class="shop-box"><h3>Configuração do caixa</h3><p class="shop-help">Estas regras aplicam-se à filial '+esc(branchName||'seleccionada')+'. Outros operadores só podem gerir as sessões permitidas pelo seu perfil.</p>'+
   (cashState?.policy?'<form data-shop-form="cash_configure" class="shop-form">'+
    '<label><input type="checkbox" name="opening_required"'+(cashState.policy.openingRequired?' checked':'')+'> Exigir abertura de caixa antes das vendas</label>'+
    '<label><input type="checkbox" name="blind_close"'+(cashState.policy.blindClose?' checked':'')+'> Fecho cego: ocultar valor esperado antes da contagem</label>'+
    '<p class="shop-help">As vendas sem sessão, quando autorizadas, continuam no histórico; não são atribuídas a uma gaveta. Alterações ficam sujeitas às permissões de proprietário.</p>'+
    '<button type="submit" class="shop-submit">Guardar regras do caixa</button></form>':
    '<p class="shop-help">Não foi possível carregar as regras do caixa. Actualize os dados quando tiver ligação.</p>')+
   linked('Sessões e movimentos','Abertura, fecho, reforços, retiradas e supervisão de vendedores.','cash','Gerir caixa')+'</section>'+
   '<section class="shop-box"><h3>Meios de pagamento</h3><p class="shop-help">Dinheiro, M-Pesa, e-Mola, transferência e Banco são meios registados no POS. A confirmação dos pagamentos digitais e bancários é manual.</p></section>';
 }else if(active==='equipa'){
  const staff=staffManagement?.staff||[];
  body='<section class="shop-box"><h3>Colaboradores e permissões</h3>'+
   '<p class="shop-help">Apenas o proprietário pode criar, suspender ou configurar colaboradores e respectivos horários. O acesso é limitado às funções autorizadas para este negócio.</p>'+
   textLine('Colaboradores registados',String(staff.length))+
   textLine('Colaboradores activos',String(staff.filter(p=>p.active).length))+
   linked('Gestão da equipa','Criar acessos, definir funções, activar ou suspender contas, e programar horários.','team','Gerir colaboradores')+
   linked('Histórico de alterações','Consultar quem realizou as operações registadas no sistema.','audit','Ver auditoria')+'</section>';
 }else if(active==='filiais'){
  body='<section class="shop-box"><h3>Filiais e estabelecimentos</h3><p class="shop-help">Os produtos, caixas e registos respeitam a filial e as permissões do negócio. Escolha a filial na barra superior antes de alterar regras específicas do caixa.</p>'+
   textLine('Filiais disponíveis',String(branches.length))+
   linked('Gestão de filiais','Criar, renomear, activar ou desactivar uma filial sujeita às verificações do sistema.','branches','Gerir filiais')+
   linked('Transferências de stock','Movimentar produtos entre filiais com o procedimento de aceite.','transfers','Abrir transferências')+'</section>';
 }else if(active==='stock'){
  body='<section class="shop-box"><h3>Stock, validade e alertas</h3>'+
   '<p class="shop-help">Acompanhe stocks mínimos, artigos perto da validade e sugestões de reposição. O número de dias abaixo é um filtro deste navegador; não altera os lotes nem as regras de acesso.</p>'+
   '<label class="owner-settings-days">Avisar sobre validade nos próximos dias<select id="shop-alert-days">'+
   [7,15,30,60,90,180,365].map(days=>'<option value="'+days+'"'+(alertDays===days?' selected':'')+'>'+days+' dias</option>').join('')+
   '</select></label><p class="shop-help">A escolha é guardada neste dispositivo para este negócio.</p>'+
   linked('Alertas de inventário','Ver avisos e produtos que precisam de atenção.','alerts','Consultar alertas')+
   linked('Inventário','Contar, corrigir e acompanhar o stock e os lotes autorizados.','inventory','Gerir inventário')+
   linked('Lista de compras','Gerar sugestões e exportar para Excel.','shopping_list','Abrir lista de compras')+'</section>';
 }else if(active==='seguranca'){
  body='<section class="shop-box"><h3>Segurança da conta</h3>'+
   textLine('Conta de acesso',email)+textLine('Perfil','Proprietário')+
   '<p class="shop-help">O PIN de cinco dígitos protege a sessão neste dispositivo; não substitui a autenticação da conta. Nunca partilhe o seu PIN com colaboradores.</p>'+
   '<div class="owner-settings-actions"><button type="button" data-shop-pin-change>Alterar o meu PIN</button>'+
   '<button type="button" data-shop-pin-lock>Bloquear agora</button></div>'+
   linked('Auditoria e controlo','Ver operações, autorizações e alterações efectuadas no negócio.','audit','Abrir auditoria')+
   '<div class="owner-settings-actions"><button type="button" data-shop-logout class="owner-settings-danger">Terminar sessão</button></div></section>';
 }else if(active==='dados'){
  body='<section class="shop-box"><h3>Dados na nuvem e cópias de segurança</h3>'+
   '<p class="shop-help">As vendas confirmadas são registadas na base de dados do negócio, não apenas no telemóvel. A consulta do mês passado, do ano ou de outro período é feita pelos relatórios com filtros de datas.</p>'+
   linked('Histórico e exportação','Consultar períodos e exportar resumos para CSV, Excel ou PDF.','reports','Consultar relatórios')+
   linked('Rastreabilidade','Conferir operações e responsáveis através dos registos disponíveis.','audit','Ver auditoria')+
   '<div class="owner-settings-caution"><strong>Sobre o backup</strong><p>As cópias de segurança da infraestrutura são administradas pela equipa técnica. O proprietário não pode restaurar a base completa a partir desta página. A cópia externa independente e um ensaio de restauração ainda requerem validação; uma exportação Excel/CSV não é um backup integral.</p></div>'+
   (pendingOffline?'<p class="owner-settings-caution">Existem '+esc(String(pendingOffline))+' movimentos de caixa offline por sincronizar. Verifique-os antes de fechar o caixa.</p>':'')+'</section>';
 }
 return '<div class="owner-settings"><div class="owner-settings-heading"><span class="owner-settings-eyebrow">ADMINISTRAÇÃO DO NEGÓCIO</span><h2>Definições</h2>'+
  '<p>Um único lugar para configurar e controlar o seu estabelecimento.</p></div>'+
  '<div class="owner-settings-layout"><nav class="owner-settings-tabs" role="tablist" aria-label="Secções das definições">'+tabButtons+'</nav>'+
  '<div class="owner-settings-body" id="owner-settings-panel" role="tabpanel" aria-labelledby="owner-settings-tab-'+active+'">'+body+'</div></div></div>';
}

// Render only a small window of the matching catalog, not thousands of image
// elements and buttons. Search still considers the complete product collection.
export function renderShopProductResults(products=[],query='',{fast=false,cart=[]}={}){
 const search=String(query||'').trim().toLocaleLowerCase();
 const matching=products.filter(p=>(p.name+' '+p.code).toLocaleLowerCase().includes(search));
 const visible=matching.slice(0,80);
 const cards=visible.map(p=>{
  const qty=cart.find(row=>row.productId===p.id)?.quantity||0;
  return '<article class="shop-product'+(fast?' shop-product-fast':'')+'">'+
   (p.photoPath?'<img class="shop-product-photo" data-shop-product-photo="'+esc(p.photoPath)+'" alt="Fotografia de '+esc(p.name)+'" loading="lazy">':
    (fast?'<span class="shop-cashier-product-placeholder" aria-hidden="true">▦</span>':''))+
   '<div class="shop-product-details"><small>'+esc(p.code)+' · '+esc(p.category)+'</small><strong>'+esc(p.name)+'</strong>'+
   '<span>'+MONEY(p.priceCents)+' / '+esc(p.unit)+'</span><small class="'+(p.stock<=p.minStock?'shop-low':'')+'">Disponível: '+esc(p.stock)+'</small></div>'+
   (fast?'<div class="shop-fast-product-actions">'+
    (qty>0?'<button type="button" data-shop-fast-minus="'+esc(p.id)+'" aria-label="Retirar uma unidade de '+esc(p.name)+'">−</button>'+
     '<span class="shop-fast-product-qty" aria-label="'+esc(qty)+' no carrinho">'+esc(qty)+'</span>':'')+
    '<button type="button" data-shop-add="'+esc(p.id)+'"'+(p.stock<=qty?' disabled':'')+' aria-label="Adicionar '+esc(p.name)+'">+</button></div>':
    '<button type="button" data-shop-add="'+esc(p.id)+'" '+(p.stock<=0?'disabled':'')+' aria-label="Adicionar '+esc(p.name)+'">+</button>')+
   '</article>';
 }).join('');
 if(!matching.length)return '<p class="shop-help" role="status">Não há produtos encontrados.</p>';
 return cards+(matching.length>80?'<p class="shop-help" role="status">A mostrar 80 de '+matching.length+' produtos. Pesquise pelo nome ou código para encontrar os restantes.</p>':'');
}

export function renderShopScreen({trialStatus=null,account,grants,grant,branches,branchId,data,cart,valueModeProducts=[],view,method,discount,query,feedback,pending,draftAvailable=false,credit=null,customerQuery='',debtFilter='open',selectedCustomerId='',creditDue='',finance=null,supplierId='',purchaseLines=1,pendingFinance=null,heldSales=[],returns=null,selectedReturnSaleId='',inventory=null,selectedProductId='',alertDays=30,inventoryQuery='',report=null,reportFrom='',reportTo='',reportScope='branch',branchManagement=null,transfers=null,transferLineCount=1,pendingTransfer=null,staffManagement=null,audit=null,auditSearch='',staffCash=null,pharmacy=null,pharmacyTrace=null,traceFrom='',traceTo='',cashState=null,pendingOffline=0,menuOpen=false,sidebarCollapsed=false,notificationsOpen=false,cashierMode=false,branding=null,logoUrl='',settingsSection='personalizacao'}){
 const products=data?.products||[];
 const session=cashState?ownOpenSession(cashState,account.userId):data?.sessions.find(s=>s.operatorId===account.userId)||null;
 const branch=branches.find(b=>b.id===branchId);
 const nav=[['sell','Vender'],['products','Produtos e stock'],['cash','Caixa'],['history','Vendas recentes'],['customers','Clientes'],['debts','Gestão de dívidas'],['suppliers','Fornecedores'],['purchases','Compras'],['expenses','Despesas'],['held','Vendas em espera'],['returns','Devoluções'],['pharmacy','Receitas médicas'],['trace','Rastreabilidade'],['inventory','Inventário'],['alerts','Alertas'],['shopping_list','Lista de compras'],['reports','Relatórios'],['team','Colaboradores'],['settings','Definições'],['audit','Auditoria'],['branches','Filiais'],['transfers','Transferências']].filter(([key])=>({sell:['owner','manager','cashier'],products:['owner','manager','stock'],cash:['owner','manager','cashier'],history:['owner','manager','cashier','finance'],customers:['owner','manager','cashier','finance'],debts:['owner','manager','cashier','finance'],suppliers:['owner','manager','stock','finance'],purchases:['owner','manager','stock','finance'],expenses:['owner','manager','finance'],held:['owner','manager','cashier'],returns:['owner','manager'],pharmacy:grant.businessType==='pharmacy'?['owner','manager','cashier']:[],trace:grant.businessType==='pharmacy'?['owner','manager','stock','finance']:[],inventory:['owner','manager','stock','finance'],alerts:['owner','manager','stock','finance'],shopping_list:['owner','manager','stock','finance'],reports:['owner','manager','cashier','finance'],team:['owner'],settings:['owner'],audit:['owner'],branches:['owner'],transfers:['owner','manager','stock','finance']})[key].includes(grant.role));
 const canViewAlerts=nav.some(([key])=>key==='alerts');
 const notificationData=canViewAlerts?inventoryNotificationSummary(inventory,grant.businessType==='pharmacy'?90:alertDays):{total:0,items:[]};
 const notificationCount=notificationData.total;
 const badgeText=count=>count>99?'99+':String(count);
 const alertLabel='Alertas'+(notificationCount?' ('+notificationCount+')':'');
 const badge=()=>'<span class="shop-alert-count" data-shop-alert-count aria-label="'+notificationCount+' alerta(s)"'+(notificationCount?'':' hidden')+'>'+badgeText(notificationCount)+'</span>';
 const menu=nav.map(([key,name])=>'<button type="button" data-shop-view="'+key+'" aria-label="'+esc(key==='alerts'?alertLabel:name)+'" title="'+esc(name)+'" '+(view===key?'aria-current="page"':'')+'><span class="shop-nav-icon" aria-hidden="true">'+icon(key==='trace'?'inventory':key)+'</span><span class="shop-nav-label">'+esc(name)+'</span>'+(key==='alerts'?badge():key==='held'&&heldSales.length?'<span class="shop-held-menu-count">'+heldSales.length+'</span>':'')+'</button>').join('');
 const quickKeys=['sell','products','cash','reports','inventory','history','alerts','customers','team','purchases'];
 // Five mobile slots: two secondary actions, central primary sale, one secondary action, More.
 // Roles without sale permission keep four authorised shortcuts; no forbidden action is introduced.
 const allowedQuick=quickKeys.filter(key=>nav.some(item=>item[0]===key));
 const leading=['products','cash','history','inventory','alerts','customers','reports'].filter(key=>allowedQuick.includes(key)).slice(0,2);
 const trailing=['reports','history','inventory','alerts','customers','products','cash'].filter(key=>allowedQuick.includes(key)&&!leading.includes(key)).slice(0,1);
 const mobileKeys=allowedQuick.includes('sell')?[...leading,'sell',...trailing]:allowedQuick.slice(0,4);
 const bottomNav=mobileKeys.map(key=>{
  const name={sell:'Vender',products:'Produtos',cash:'Caixa',reports:'Relatórios',inventory:'Inventário',history:'Vendas',
   alerts:'Alertas',customers:'Clientes',team:'Equipa',purchases:'Compras'}[key];
  return '<button type="button" data-shop-view="'+key+'"'+(key==='sell'?' class="shop-bottom-sell"':'')+
   (view===key?' aria-current="page"':'')+' aria-label="'+name+'"><span class="shop-bottom-icon" aria-hidden="true">'+
   icon(key)+'</span><small>'+name+'</small></button>';
 }).join('');
 const notificationRows=notificationData.items.slice(0,5).map(item=>
  '<li class="shop-notification-item shop-notification-'+item.kind+'"><strong>'+esc(item.title)+'</strong><span>'+esc(item.detail)+'</span></li>').join('');
 const notificationPopover=notificationsOpen?
  '<div class="shop-notification-popover" id="shop-notification-panel" role="region" aria-label="Alertas da loja">'+
   '<div class="shop-notification-heading"><strong>Notificações</strong><small>'+notificationCount+' alerta(s)</small></div>'+
   (notificationCount?'<ul class="shop-notification-list">'+notificationRows+'</ul>':
    '<p class="shop-notification-empty">'+(canViewAlerts?'Não existem alertas de stock ou validade neste momento.':'Alertas de inventário disponíveis apenas para perfis autorizados.')+'</p>')+
   (canViewAlerts?'<button type="button" data-shop-notifications-all class="shop-notification-all">Ver todos os alertas'+(notificationCount>5?' ('+notificationCount+')':'')+'</button>':'')+
  '</div>':'';
 const prodCards=view==='sell'?renderShopProductResults(products,query,{fast:cashierMode,cart}):'';
 const holdLabel=cart.length+' artigo'+(cart.length===1?'':'s');
 const holdEnabled=cart.length>0&&!pending;
 let body='';
 if(view==='sell'){
  const cashierQty=cart.reduce((n,row)=>n+Number(row.quantity||0),0);
  const cashierSubtotal=cart.reduce((n,row)=>n+Math.round((products.find(p=>p.id===row.productId)?.priceCents||0)*Number(row.quantity||0)),0);
  const shortcuts=cashierMode?'<div class="shop-cashier-workspace">'+
   '<header class="shop-cashier-intro"><div><span>PRONTO POS · VENDA RÁPIDA</span><h2>Nova venda</h2>'+
   '<p>Leia o código ou toque num produto para adicionar.</p></div>'+
   '<div class="shop-cashier-cart-pill"><span>'+esc(cashierQty)+' artigo(s)</span><strong>'+MONEY(cashierSubtotal)+'</strong></div></header>'+
   '<div class="shop-cashier-quick-actions" role="group" aria-label="Acções rápidas do modo caixa">'+
    '<button type="button" class="shop-cashier-scan-primary" data-shop-scan aria-label="Abrir a câmara para ler códigos de barras e QR code">▣ Ler código</button>'+
    '<button type="button" data-shop-hold'+(holdEnabled?'':' disabled')+'>⏸ Em espera</button>'+
    '<button type="button" data-shop-held-tab>↩ Retomar ('+heldSales.length+')</button>'+
    '<button type="button" data-shop-go-checkout class="shop-cashier-charge"'+(cart.length?'':' disabled')+'>Cobrar · '+MONEY(cashierSubtotal)+'</button>'+
    '</div></div>':'';
  // No duplicated checkout, held-cart or payment controls above the catalog.
  body=shortcuts+
   '<div class="shop-sales-grid"><section class="shop-box"><h3>Produtos</h3><div class="shop-search"><label for="shop-search">Pesquisar por nome ou código</label>'+
   '<div class="shop-search-control"><input id="shop-search" type="search" value="'+esc(query)+'" autocomplete="off" placeholder="Nome, código ou referência">'+
   (cashierMode?'':'<button class="shop-scan-launch" data-shop-scan type="button" title="Ler QR code ou código de barras" aria-label="Abrir câmara para ler QR code ou código de barras">'+
   '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3M3 12h18M8 9h1v6H8zm4 0h1v6h-1zm3 0h2v6h-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
   '<span>Ler código</span></button>')+'</div></div>'+
   '<div id="shop-product-results" class="shop-products">'+(prodCards||'<p class="shop-help">Não há produtos encontrados.</p>')+'</div></section>'+
   shopPaymentPanel({method,cart,products,discount,session,role:grant.role,credit,selectedCustomerId,creditDue,valueModeProducts,allowNoSession:cashState?.policy.openingRequired===false})+'</div>'+
   (cashierMode?'':'<section class="shop-box shop-held-in-sales"><div class="shop-held-heading"><h3>Vendas em espera <span>'+heldSales.length+'</span></h3>'+
   '<button type="button" data-shop-held-tab>Ver todas</button></div>'+
   (heldSales.length?heldSales.slice(0,3).map(h=>'<div class="shop-held-mini-item"><div><strong>'+
     esc(h.cart.map(i=>products.find(p=>p.id===i.productId)?.name||'Artigo').join(', '))+
     '</strong><small>'+esc(h.cart.length)+' artigo(s) · '+esc(safeDate(h.createdAt))+'</small></div>'+
     '<button type="button" data-shop-hold-resume="'+esc(h.id)+'">Retomar</button></div>').join(''):
     '<p class="shop-help">Ainda não há vendas suspensas. Pode guardar o carrinho para atender outro cliente.</p>')+
   '</section>');
  if(pending)body+='<div class="shop-pending"><strong>Venda com confirmação pendente</strong>'+
   (grant.businessType==='pharmacy'?'<p>Referência da venda: <strong>'+esc(pending.idempotency_key||'')+'</strong>. Caso tenha medicamentos sujeitos a receita, abra Receitas médicas numa conta de profissional habilitado para autorizar a dispensação. Depois utilize «Repetir o mesmo pedido».</p>':'')+
   '<p>Não crie outra venda antes de verificar se esta foi concluída. Pode repetir o mesmo pedido sem duplicar o registo ou descartá-lo após conferência.</p><button type="button" data-shop-retry>Repetir o mesmo pedido</button><button type="button" data-shop-discard>Descartar pedido pendente</button></div>';
 }else if(view==='customers'||view==='debts'){
  body=renderCreditView({view,credit,role:grant.role,query:customerQuery,filter:debtFilter,session,selectedCustomerId});
 }else if(['suppliers','purchases','expenses'].includes(view)){
  body=renderFinanceView({view,finance,products,supplierId,lines:purchaseLines,role:grant.role,session});
 }else if(view==='held'){
  body='<div class="shop-sales-tabs" role="group" aria-label="Vendas e carrinhos em espera">'+
   '<button type="button" class="shop-sales-tab" data-shop-sell-tab>Venda actual</button>'+
   '<button type="button" class="shop-sales-tab selected" aria-current="page">Em espera <span>'+heldSales.length+'</span></button></div>'+
   '<section class="shop-box"><h3>Vendas em espera</h3><p class="shop-help">Os carrinhos ficam guardados na filial. Ao recuperar, o stock e os preços são revalidados no servidor.</p>'+
   (heldSales.length?heldSales.map(h=>'<article class="credit-debt-item"><strong>'+esc(h.cart.length)+' artigo(s)</strong><small> · '+esc(safeDate(h.createdAt))+'</small>'+
    '<p>'+esc(h.cart.map(i=>products.find(p=>p.id===i.productId)?.name||'Artigo').join(', '))+'</p>'+
    '<div class="credit-debt-actions"><button type="button" data-shop-hold-resume="'+esc(h.id)+'">Retomar</button><button type="button" data-shop-hold-delete="'+esc(h.id)+'">Eliminar</button></div></article>').join(''):'<p class="shop-help">Não existem vendas suspensas nesta filial.</p>')+'</section>';
 }else if(view==='returns'){
  body=renderReturnView({returns,selectedSaleId:selectedReturnSaleId,session,businessType:grant.businessType});
 }else if(view==='pharmacy'&&grant.businessType==='pharmacy'){
  body=renderPharmacyReviews(pharmacy);
 }else if(view==='trace'&&grant.businessType==='pharmacy'){
  body=renderPharmacyTrace(pharmacyTrace,{from:traceFrom,to:traceTo,role:grant.role});
 }else if(['inventory','alerts','shopping_list'].includes(view)){
  body=renderInventoryView({view,inventory,role:grant.role,selectedProductId,alertDays,query:inventoryQuery,businessType:grant.businessType});
 }else if(view==='reports'){
  body=renderReportsView({report,from:reportFrom,to:reportTo,scope:reportScope,
   allAllowed:['owner','manager','finance'].includes(grant.role)});
 }else if(view==='settings'&&grant.role==='owner'){
  body=renderOwnerSettings({selected:settingsSection,branding,logoUrl,businessName:grant.name,businessType:grant.businessType,email:account.email,branchName:branch?.name,cashState,staffManagement,branches,alertDays,pendingOffline});
 }else if(view==='branding'&&grant.role==='owner'){
  body=renderDocumentBrandingSettings({branding,logoUrl,businessName:grant.name});
 }else if(view==='transfers'){
  body=renderTransfersView({snapshot:transfers,branches,branchId,products,
   role:grant.role,lineCount:transferLineCount,pendingTransfer});
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
  body='<div class="shop-two">'+section('Gerir produtos existentes',
   '<button type="button" class="shop-submit" data-shop-open-inventory>Gerir produtos cadastrados</button>',
   'Editar, desactivar, reactivar ou eliminar produtos com segurança.')+
   section(grant.businessType==='pharmacy'?'Novo medicamento':'Novo produto','<form data-shop-form="product_create" class="shop-form">'+
   field('name',grant.businessType==='pharmacy'?'Nome comercial':'Nome do produto','',grant.businessType==='pharmacy'?'required maxlength="200" list="pronto-medicine-names" placeholder="Nome conforme a embalagem"':'required maxlength="200"')+
   (grant.businessType==='pharmacy'?'<datalist id="pronto-medicine-names">'+[...new Set(products.map(p=>p.name))].slice(0,40).map(name=>'<option value="'+esc(name)+'"></option>').join('')+'</datalist>'+renderPharmacyCategory():
    field('category','Categoria','Geral','maxlength="100"'))+
   (grant.businessType==='pharmacy'?renderMedicineFields():'')+
   '<label>Unidade<select name="unit">'+UNIT_OPTIONS.map(u=>'<option value="'+esc(u)+'">'+esc(u)+'</option>').join('')+'</select></label>'+
   '<label class="fractional-control"><input type="checkbox" name="allow_fractional" disabled> Permite venda fraccionada</label>'+
   '<p class="shop-help">Active para vender por valor (MT) partes de kg, litro ou metro. Não se aplica a artigos por unidade.</p>'+
   field('price','Preço de venda (MT)','','required type="number" min="0.01" step="0.01"')+
   '<div class="shop-product-code-entry"><label>Código de barras ou referência<input name="code" maxlength="80" autocomplete="off" placeholder="Digitalize ou escreva o código"></label>'+
    '<button type="button" data-shop-product-scan class="shop-product-scan-button">▣ Ler código com a câmara</button>'+
    '<label class="shop-generate-code"><input type="checkbox" name="generate_code"> Produto sem código de fábrica — gerar código interno</label></div>'+
    '<fieldset class="shop-create-photo"><legend>Fotografia obrigatória do produto</legend>'+
    '<div class="shop-create-photo-choices"><label>📷 Tirar foto<input name="product_camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>'+
    '<label>🖼 Escolher da galeria<input name="product_photo" type="file" accept="image/jpeg,image/png,image/webp"></label></div>'+
    '<img data-shop-create-photo-preview alt="Pré-visualização da fotografia do produto" hidden>'+
    '<p class="shop-help" data-shop-create-photo-status>Escolha uma fotografia JPEG, PNG ou WebP (até 3 MB). A imagem é obrigatória antes de guardar.</p></fieldset>'+
   field('min_stock','Stock mínimo','0','type="number" min="0" step="0.001"')+
   '<button type="submit" class="shop-submit">Cadastrar produto</button></form>','Código de barras obrigatório ou código interno gerado. A fotografia é obrigatória: o produto só fica à venda após o envio da imagem.')+
   (grant.businessType==='pharmacy'?'':section('Importar produtos por CSV','<form data-shop-form="csv_import" class="shop-form">'+
   '<label>Ficheiro CSV (até 100 produtos)<input type="file" name="csv_file" accept=".csv,text/csv,text/plain" required></label>'+
   '<label><input type="checkbox" name="confirm_import" required> Confirmei os preços, códigos e quantidades do ficheiro</label>'+
   '<button class="shop-submit" type="submit">Validar e importar produtos</button></form>',
   'Até 100 artigos por ficheiro. Colunas obrigatórias: nome;categoria;preco. O stock inicial é opcional. Reveja os dados antes de confirmar.'))+
   section('Receber stock','<form data-shop-form="stock_receive" class="shop-form">'+
   '<label>Produto<select name="product_id" required><option value="">Seleccione o artigo</option>'+options(products)+'</select></label>'+
   field('quantity','Quantidade','','required type="number" min="0.001" step="0.001"')+
   field('lot_number',grant.businessType==='pharmacy'?'Número do lote (obrigatório)':'Número do lote (opcional)','','maxlength="100"'+(grant.businessType==='pharmacy'?' required':''))+
   field('expires_on',grant.businessType==='pharmacy'?'Data de validade (obrigatória)':'Data de validade (opcional)','','type="date"'+(grant.businessType==='pharmacy'?' required min="'+esc(new Date(Date.parse(maputoToday()+'T00:00:00Z')+86400000).toISOString().slice(0,10))+'"':''))+
   field('unit_cost','Custo por unidade (MT, opcional)','','type="number" min="0" step="0.01"')+
   '<button class="shop-submit" type="submit">Registar entrada de stock</button></form>',grant.businessType==='pharmacy'?'Lote e validade são obrigatórios. Não é permitido receber medicamentos vencidos; o servidor valida os dados.':'Cria um lote e um movimento de entrada, sem alterar vendas anteriores.')+'</div>';
 }else if(view==='cash'){
  body=renderCashManagement({cash:cashState,account,role:grant.role,pendingOffline});
 }else if(view==='audit'&&grant.role==='owner'){
  body=renderAuditView({audit,search:auditSearch});
 }else if(view==='team'&&grant.role==='owner'){
  body=section('Criar acesso de colaborador',
   '<form data-shop-form="team_invite" class="shop-form">'+
   field('name','Nome completo','','required minlength="2" maxlength="120"')+
   field('email','Email do colaborador','','type="email" required maxlength="254"')+
   '<label>Função<select name="role" required>'+
   '<option value="cashier">Caixa / Vendedor</option><option value="manager">Gerente</option>'+
   '<option value="stock">Stock</option><option value="finance">Financeiro</option></select></label>'+
   '<button type="submit" class="shop-submit">Criar conta e mostrar senha</button></form>'+
   '<p class="shop-help">Após criar a conta, copie o email e a palavra-passe inicial e envie-os por mensagem privada. No primeiro acesso, o colaborador altera a palavra-passe provisória e depois cria o seu PIN de cinco dígitos. Não é enviado email.</p>',
   'Apenas o proprietário pode criar acessos de funcionários; só o administrador geral pode registar novos proprietários.')+
   renderStaffManagement(staffManagement)+renderSuspendedCash(staffCash);
 }else{
  body=section('Vendas registadas nesta filial',
   '<div class="shop-history">'+(data?.sales.length?data.sales.map(s=>
    '<div><strong>'+MONEY(s.amount)+'</strong><small>'+esc(s.method)+' · '+esc(safeDate(s.date))+'</small><span>Ref. '+esc(s.id.slice(0,8))+'</span></div>').join(''):
    '<p class="shop-help">Ainda não existem vendas registadas nesta loja.</p>')+'</div>',
   'Apresentação limitada às últimas 20 vendas autorizadas. Não substitui os relatórios fiscais.');
 }
 return '<div class="shop-shell shop-layout'+(menuOpen?' shop-menu-open':'')+(sidebarCollapsed?' shop-menu-collapsed':'')+(cashierMode&&view==='sell'?' shop-fast-cashier':'')+'">'+
 '<button type="button" class="shop-sidebar-shade" data-shop-menu-toggle aria-label="Fechar menu" tabindex="-1"></button>'+
 '<aside id="shop-sidebar" class="shop-sidebar" aria-label="Menu principal">'+
 '<div class="shop-sidebar-top"><div class="shop-sidebar-title shop-nav-label">MENU DO NEGÓCIO</div>'+
 '<button type="button" class="shop-sidebar-collapse" data-shop-sidebar-collapse aria-label="Recolher ou expandir menu" title="Recolher ou expandir menu">⇤</button></div>'+
 '<nav class="shop-nav" aria-label="Áreas da loja">'+menu+'</nav>'+
 '<div class="shop-sidebar-footer shop-nav-label">Ubuntu Service, Lda.</div></aside>'+
 '<div class="shop-workspace"><header class="shop-header"><div class="shop-brand"><button type="button" class="shop-mobile-menu-trigger" data-shop-menu-toggle aria-label="Abrir menu" aria-expanded="'+menuOpen+'">☰</button><img src="/icon.svg" alt=""><span><strong>Pronto POS</strong><small>O seu negócio na palma da mão</small></span></div>'+
 '<div class="shop-account"><strong>'+esc(grant.name)+'</strong><small>'+esc(account.email)+' · '+esc(grant.role)+'</small></div>'+
 '<div class="shop-header-actions">'+
 (nav.some(([key])=>key==='sell')?'<button type="button" class="shop-cashier-toggle" data-shop-cashier-toggle aria-pressed="'+(cashierMode&&view==='sell')+'" aria-label="'+(cashierMode&&view==='sell'?'Desactivar Modo Caixa':'Activar Modo Caixa')+'"><span aria-hidden="true">▦</span><span>'+(cashierMode&&view==='sell'?'Modo normal':'Modo Caixa')+'</span></button>':'')+
 '<div class="shop-notification-area">'+
 '<button type="button" class="shop-notification-trigger" data-shop-notifications aria-controls="shop-notification-panel" aria-expanded="'+notificationsOpen+'" aria-label="Notificações: '+notificationCount+' alerta(s)" title="Notificações">'+icon('alerts')+badge()+'</button>'+
 notificationPopover+'</div><details class="shop-profile-menu"><summary aria-label="Perfil do utilizador" title="Perfil do utilizador"><span aria-hidden="true">●</span><span aria-hidden="true">⌄</span></summary><div class="shop-profile-popover"><strong>'+esc(account.email)+'</strong><small>'+esc(grant.role)+'</small><button type="button" data-shop-logout>Terminar sessão</button></div></details></div></header>'+
 '<div class="shop-toolbar"><label>Empresa<select id="shop-business-select">'+grants.map(b=>'<option value="'+esc(b.id)+'" '+(b.id===grant.id?'selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select></label>'+
 '<label>Filial<select id="shop-branch-select">'+branches.map(b=>'<option value="'+esc(b.id)+'" '+(b.id===branchId?'selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select></label>'+
 '<button type="button" data-shop-refresh aria-label="Sincronizar dados" title="Sincronizar dados">⟳</button><span class="shop-cash-indicator">'+(session?'Caixa aberto':cashState?.policy.openingRequired===false?'Abertura opcional':'Caixa fechado')+'</span></div>'+
 // Preserve the desktop Modo Caixa button in the header. The compact mobile
 // header deliberately hides it, so provide a mobile-only, equally authorised
 // action directly below the unchanged business and branch selectors.
 (nav.some(([key])=>key==='sell')?
  '<button type="button" class="shop-mobile-cashier-entry" data-shop-cashier-toggle aria-pressed="'+(cashierMode&&view==='sell')+
  '" aria-label="'+(cashierMode&&view==='sell'?'Voltar ao modo normal':'Activar Modo Caixa')+'">'+
  '<span class="shop-mobile-cashier-icon" aria-hidden="true">▦</span>'+
  '<span class="shop-mobile-cashier-copy"><strong>'+(cashierMode&&view==='sell'?'Modo Caixa activo':'Modo Caixa')+'</strong>'+
  '<small>'+(cashierMode&&view==='sell'?'Voltar ao modo normal':'Abrir venda rápida com leitor de códigos')+'</small></span>'+
  '<span class="shop-mobile-cashier-arrow" aria-hidden="true">›</span></button>':'')+

 (trialStatus?.is_trial===true?'<div class="pronto-trial-banner" role="status"><strong>🎁 Teste gratuito</strong><span>'+(
  trialStatus.expired?'O seu teste terminou. Escolha um plano para continuar.':
  'Faltam '+Math.max(0,Math.ceil((Date.parse(trialStatus.expires_at)-Date.now())/86400000))+' dia(s) para terminar os 10 dias gratuitos.'
 )+'</span><span class="pronto-trial-contact">Contacte a Ubuntu Service para activar a assinatura.</span></div>':'')+
 '<main class="shop-main'+(view==='sell'&&holdEnabled&&!cashierMode?' shop-main-hold-active':'')+'"><div id="shop-message" role="status" aria-live="polite">'+esc(feedback||'')+'</div>'+
 (view==='sell'?'':'<h2>'+esc(branch?.name||'Loja')+'</h2>')+body+
 (view==='sell'||view==='held'?'<section class="shop-box shop-draft-section"><h3>Recuperação de carrinhos</h3><p class="shop-help">Pode guardar o carrinho encriptado neste dispositivo. Sem Internet, pode guardar o carrinho para recuperar mais tarde. A venda só é concluída com ligação. Os carrinhos guardados só podem ser finalizados com Internet.</p>'+
 (cart.length||pending?'<form data-shop-form="draft_save" class="shop-form"><label>Frase de recuperação (mínimo 12 caracteres)<input type="password" name="passphrase" minlength="12" maxlength="128" autocomplete="off" required></label><button class="shop-submit" type="submit">Guardar rascunho encriptado</button></form>':'')+
 (draftAvailable?'<form data-shop-form="draft_restore" class="shop-form"><label>Frase do rascunho guardado<input type="password" name="passphrase" minlength="12" maxlength="128" autocomplete="off" required></label><button class="shop-submit" type="submit">Recuperar rascunho</button></form><button type="button" data-shop-draft-clear class="shop-logout">Apagar rascunho do dispositivo</button>':'')+
 '<p class="shop-help">Se uma venda foi enviada e a resposta falhou, recupere o mesmo pedido e a mesma referência antes de reenviar. Não crie uma venda nova sem conferir os registos.</p></section>':'')+
 (pendingFinance?'<div class="shop-pending"><strong>Operação financeira por confirmar</strong><p>Confira o histórico da loja antes de tentar outra operação. Repetir o mesmo formulário reutiliza a chave original.</p><button type="button" data-finance-discard>Descartar referência local após conferir</button></div>':'')+
 '<p class="shop-footer">Pronto POS — Menos complicações, mais negócio. © Ubuntu Service, Lda.</p></main></div>'+
 (view==='sell'&&holdEnabled&&!cashierMode?'<div class="shop-hold-mobile-bar" role="group" aria-label="Acções da venda actual">'+
  '<div><small>Venda actual</small><strong>'+holdLabel+'</strong></div>'+
  '<button type="button" data-shop-hold aria-label="Colocar venda actual em espera">⏸ Pôr em espera</button></div>':'')+
 '<nav class="shop-mobile-bottom" aria-label="Navegação rápida">'+bottomNav+
 '<button type="button" data-shop-menu-toggle aria-label="Mais funcionalidades" aria-expanded="'+menuOpen+'"><span aria-hidden="true">☰</span><small>Mais</small></button></nav></div>';
}

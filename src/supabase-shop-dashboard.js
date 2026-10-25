import {normalizeCashControl,ownOpenSession,cashSessionsCSV} from './supabase-cash-ui.js';
import {showConfirmModal} from './ui/pronto-modal.js';
import {startProntoLoading} from './ui/pronto-loading.js';
import {customerMessage} from './customer-copy.js';
import {confirmedSaleReceipt,showSaleCompleteModal,printSaleReceipt} from './ui/pronto-sale-success.js';
import {saveOfflineCash,restoreOfflineCash,clearOfflineCash,offlineCashKeys} from './supabase-cash-offline.js';
import {showProntoCredentials} from './pronto-credentials-ui.js';
import {renderShopScreen,renderShopProductResults,shopPaymentPanel} from './supabase-shop-ui.js';
import {findScannedShopProduct,openShopCodeScanner} from './shop-mobile-scanner.js';
import {PAYMENT_METHODS,toCents,toQuantity,makeSaleRequest,cartTotal,esc,MONEY} from './supabase-shop-core.js';
import {quantityFromValueCents,validateSaleQuantity,allowsFractionalSale} from './sale-by-value.js';
import {checkoutCashPreview} from './supabase-checkout-change.js';
import {getPinKPIs,setPinKPIs,clearPinKPIs} from './pin-city-ui.js';
import {makeCreditSaleRequest,makeDebtPaymentRequest,searchCustomers} from './supabase-credit-core.js';
import {creditStatementHTML,creditWhatsAppURL} from './supabase-credit-ui.js';
import {shoppingListCSV,inventoryNotificationSummary,inventoryAlerts} from './supabase-inventory-ui.js';
import {reportsCSV,reportDocumentData} from './supabase-reports-ui.js';
import {normalizeDocumentBranding,serializeDocumentBranding,brandedDocumentHTML} from './supabase-document-branding.js';
import {buildBrandedXLSX} from './supabase-document-xlsx.js';
import {auditCSV} from './supabase-audit-ui.js';
const maputoDate=(time=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
import {makeShopDraft,saveShopDraft,restoreShopDraft,hasShopDraft,clearShopDraft} from './supabase-shop-draft.js';
import {parseProductCSV} from './product-import.js';

const confirmShop=message=>{
 const danger=/suspender|bloquear|desactiv|cancelar|eliminar|apagar|descartar|retirada|encerramento excepcional|fechar sem conferência/i.test(String(message));
 return showConfirmModal({title:danger?'Confirmar intervenção':'Confirmar operação',message:String(message),
  danger,confirmText:danger?'Sim, continuar':'Confirmar',cancelText:'Voltar'});
};
// Explicit, isolated PostgreSQL checkout pilot. The existing SQLite POS is untouched.
export async function mountSupabaseMerchantPilot({root,client,account,onLogout}){
 if(!account?.grants?.length||account.ubuntuAdmin)throw Error('shop_access_required');
 const aborter=new AbortController(),signal=aborter.signal;
 let grant=account.grants[0],branches=[],branchId='',data=null,cart=[],
  view=['owner','manager','cashier'].includes(account.grants[0].role)?'sell':
   account.grants[0].role==='stock'?'products':'history',
  method='cash',discount='0',query='',notice='',busy=false,pending=null,pendingCSV=null,
  credit=null,selectedCustomerId='',customerQuery='',debtFilter='open',creditDue='',pendingPayment=null,
  finance=null,supplierId='',purchaseLines=1,pendingFinance=null,heldSales=[],resumedHoldId=null,holdIdToSave=null,returns=null,selectedReturnSaleId='',pendingReturn=null,pendingCashMove=null,inventory=null,selectedProductId='',alertDays=30,inventoryQuery='',report=null,reportFrom=maputoDate(new Date(Date.now()-29*86400000)),reportTo=maputoDate(),reportScope='branch',branchManagement=null,
  transfers=null,transferLineCount=1,pendingTransfer=null,staffManagement=null,audit=null,auditPage=0,auditSearch='',staffCash=null,cashState=null,pendingCashOffline=0,branding=null,brandLogoUrl='',settingsSection='personalizacao',menuOpen=false,sidebarCollapsed=false,notificationsOpen=false,cashierMode=false,accessBlocked=false,accessCheckBusy=false,closeScanner=null;
 const valueModeProducts=new Set();
 const scope=()=>({userId:account.userId,businessId:grant.id,branchId});
 const alertDaysKey=()=> 'pronto-alert-days:'+grant.id;
 const readAlertDays=()=>{
  try{
   const value=Number(localStorage.getItem(alertDaysKey()));
   return [7,15,30,60,90,180,365].includes(value)?value:30;
  }catch{return 30;}
 };
 alertDays=readAlertDays();
 // The same identity, colours and logo are reused by each formatted workbook.
 const downloadBrandedExcel=async({title,period,summary=[],sections=[],filename})=>{
  let logoPng=null;
  if(branding?.logoPath){
   try{
    const signed=await client.documentLogoUrl(branding.logoPath);
    const response=await fetch(signed,{cache:'no-store'});
    if(!response.ok)throw Error('logo_fetch_failed');
    const image=await createImageBitmap(await response.blob());
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,300/image.width,160/image.height);
    canvas.width=Math.max(1,Math.round(image.width*scale));
    canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    image.close?.();
    const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('logo_conversion_failed')),'image/png'));
    logoPng=new Uint8Array(await png.arrayBuffer());
   }catch{/* The report remains available if the private logo is temporarily unavailable. */}
  }
  const bytes=buildBrandedXLSX({branding,title,period,summary,sections,logoPng});
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');
  link.href=url;link.download=filename;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
 };
 let pinMetricCheckedAt=0,pinMetricBusy=false;
 // Read only the branch and business currently authorised for this signed-in user.
 // PIN KPIs are aggregates retrieved AFTER PIN unlock; never query while locked.
 const refreshPinMetrics=async(force=false)=>{
  if(signal.aborted||pinMetricBusy||accessBlocked||disconnected()||!branchId||
   !['owner','manager','cashier','finance'].includes(grant.role)||
   typeof client.reportsSnapshot!=='function'||client.isScreenLocked?.())return;
  if(!force&&Date.now()-pinMetricCheckedAt<120000)return;
  pinMetricBusy=true;pinMetricCheckedAt=Date.now();
  const initialUser=account.userId,initialBusiness=grant.id,initialBranch=branchId;
  const today=maputoDate(),firstDay=today.slice(0,8)+'01';
  try{
   const [dayReport,monthReport]=await Promise.all([
    client.reportsSnapshot(initialBusiness,initialBranch,today,today),
    client.reportsSnapshot(initialBusiness,initialBranch,firstDay,today)
   ]);
   if(signal.aborted||accessBlocked||client.isScreenLocked?.()||
      account.userId!==initialUser||grant.id!==initialBusiness||branchId!==initialBranch)return;
   setPinKPIs(getPinKPIs({today:dayReport,month:monthReport,
     userId:initialUser,businessId:initialBusiness,branchId:initialBranch,
     shopName:grant.name,role:grant.role}));
  }catch{/* Hide figures rather than fabricating metrics on an unauthorised/offline request. */}
  finally{pinMetricBusy=false;}
 };

 const authorizedView=target=>({sell:['owner','manager','cashier'],products:['owner','manager','stock'],cash:['owner','manager','cashier'],history:['owner','manager','cashier','finance'],customers:['owner','manager','cashier','finance'],debts:['owner','manager','cashier','finance'],suppliers:['owner','manager','stock','finance'],purchases:['owner','manager','stock','finance'],expenses:['owner','manager','finance'],held:['owner','manager','cashier'],returns:['owner','manager'],inventory:['owner','manager','stock','finance'],alerts:['owner','manager','stock','finance'],shopping_list:['owner','manager','stock','finance'],reports:['owner','manager','cashier','finance'],branding:['owner'],settings:['owner'],team:['owner'],audit:['owner'],branches:['owner'],transfers:['owner','manager','stock','finance']})[target]?.includes(grant.role)===true;
 const disconnected=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
 const leave=async()=>{
  closeScanner?.();clearPinKPIs(account.userId);
  aborter.abort();root.innerHTML='';
  try{await client.signOut();}finally{onLogout();}
 };
 const showMessage=(text,warning=false)=>{
  const safe=customerMessage(text,{warning});
  notice=safe;
  const el=root.querySelector('#shop-message');
  if(el){el.textContent=safe;el.classList.toggle('shop-error',warning);}
  const inline=root.querySelector('#shop-checkout-feedback');
  if(inline){inline.textContent=warning?safe:'';inline.hidden=!warning;}
 };
 const session=()=>cashState?ownOpenSession(cashState,account.userId):data?.sessions.find(s=>s.operatorId===account.userId)||null;
 const offlineCount=()=>offlineCashKeys(localStorage,scope()).length;
 const photoCache=new Map();
 const hydrateProductPhotos=(element=root)=>{
  for(const img of element.querySelectorAll('[data-shop-product-photo]')){
   const path=img.dataset.shopProductPhoto;
   if(!path||!client.productPhotoUrl)continue;
   const cached=photoCache.get(path);
   if(cached&&cached.expiresAt>Date.now()&&cached.url){img.src=cached.url;continue;}
   // Reuse in-flight signed URL requests when a quick tap triggers a re-render.
   const pending=cached&&cached.expiresAt>Date.now()?cached.pending:client.productPhotoUrl(path);
   if(!cached||cached.expiresAt<=Date.now())photoCache.set(path,{pending,expiresAt:Date.now()+230000});
   void pending.then(url=>{
    if(photoCache.get(path)?.pending===pending)photoCache.set(path,{url,expiresAt:Date.now()+230000});
    if(img.isConnected&&!signal.aborted)img.src=url;
   }).catch(()=>{
    if(photoCache.get(path)?.pending===pending)photoCache.delete(path);
    if(img.isConnected)img.alt='Fotografia indisponível';
   });
  }
 };
 const render=()=>{
  if(!data||accessBlocked)return;
  root.innerHTML=renderShopScreen({account,grants:account.grants,grant,branches,branchId,data,cart,valueModeProducts:[...valueModeProducts],view,method,discount,query,feedback:notice,pending,
   draftAvailable:hasShopDraft(localStorage,scope()),credit,selectedCustomerId,customerQuery,debtFilter,creditDue,finance,supplierId,purchaseLines,pendingFinance,heldSales,returns,selectedReturnSaleId,inventory,selectedProductId,alertDays,inventoryQuery,report,reportFrom,reportTo,reportScope,branchManagement,transfers,transferLineCount,pendingTransfer,staffManagement,audit,auditSearch,staffCash,cashState,pendingOffline:pendingCashOffline,menuOpen,sidebarCollapsed,notificationsOpen,cashierMode,branding,logoUrl:brandLogoUrl,settingsSection});
  hydrateProductPhotos();
 };
 const refresh=async(selectFirst=false)=>{
  if(selectFirst){
   notificationsOpen=false;
   branches=await client.merchantBranches(grant.id);
   if(!branches.length)throw Error('shop_no_branch');
   branchId=branches[0].id;cart=[];pending=null;method='cash';discount='0';query='';credit=null;selectedCustomerId='';customerQuery='';debtFilter='open';creditDue='';finance=null;supplierId='';purchaseLines=1;heldSales=[];resumedHoldId=null;holdIdToSave=null;returns=null;selectedReturnSaleId='';inventory=null;selectedProductId='';inventoryQuery='';report=null;reportScope='branch';audit=null;auditPage=0;auditSearch='';
   view=['owner','manager','cashier'].includes(grant.role)?'sell':grant.role==='stock'?'products':'history';
  }
  data=await client.merchantSnapshot(grant.id,branchId);
  // Independent snapshots run in parallel so a slow secondary screen does not
  // force 10+ sequential network round-trips on a mobile connection.
  const loadBranding=async()=>{
   let settings;
   try{settings=typeof client.documentSettings==='function'?await client.documentSettings(grant.id):normalizeDocumentBranding({},grant.name);}
   catch{settings=normalizeDocumentBranding({},grant.name);}
   let logoUrl='';
   if(settings.logoPath&&typeof client.documentLogoUrl==='function'){
    try{logoUrl=await client.documentLogoUrl(settings.logoPath);}catch{/* Only the logo is unavailable. */}
   }
   return {settings,logoUrl};
  };
  const [nextBrand,nextCash,nextBranches,nextStaff,nextStaffCash,nextAudit,
   nextTransfers,nextCredit,nextFinance,nextHolds,nextReturns,nextInventory]=await Promise.all([
    loadBranding(),
    typeof client.cashControl==='function'?client.cashControl('snapshot',cashData({})):null,
    grant.role==='owner'?client.manageBranch('list',{business_id:grant.id}):null,
    grant.role==='owner'?client.ownerStaffSnapshot(grant.id):null,
    grant.role==='owner'?client.ownerSuspendedCash(grant.id):null,
    view==='audit'&&grant.role==='owner'?client.ownerAuditSnapshot(grant.id,auditPage):audit,
    ['owner','manager','stock','finance'].includes(grant.role)?client.transferSnapshot(grant.id):null,
    typeof client.creditSnapshot==='function'?client.creditSnapshot(grant.id,branchId):null,
    typeof client.financeSnapshot==='function'?client.financeSnapshot(grant.id,branchId):null,
    typeof client.holdList==='function'&&['owner','manager','cashier'].includes(grant.role)?client.holdList(grant.id,branchId):[],
    typeof client.returnSnapshot==='function'&&['owner','manager'].includes(grant.role)?client.returnSnapshot(grant.id,branchId):null,
    typeof client.inventorySnapshot==='function'&&['owner','manager','stock','finance'].includes(grant.role)?client.inventorySnapshot(grant.id,branchId):null
   ]);
  branding=nextBrand.settings;brandLogoUrl=nextBrand.logoUrl;
  cashState=nextCash?normalizeCashControl(nextCash):null;
  pendingCashOffline=offlineCount();
  branchManagement=nextBranches;staffManagement=nextStaff;staffCash=nextStaffCash;
  audit=nextAudit;transfers=nextTransfers;credit=nextCredit;finance=nextFinance;
  heldSales=nextHolds;returns=nextReturns;inventory=nextInventory;
  if(credit&&selectedCustomerId&&!credit.customers.some(c=>c.id===selectedCustomerId&&c.active))selectedCustomerId='';
  render();
  void refreshPinMetrics();
 };
 const safeLoad=async(first=false,fullScreen=false)=>{
  if(busy)return;busy=true;
  const loading=fullScreen?startProntoLoading():null;
  let succeeded=false;
  try{
   await refresh(first);showMessage('');
   succeeded=true;
  }catch(e){
   if(e.message==='supabase_unauthorized'||e.message==='shop_access_required'){
    loading?.cancel();await leave();return;
   }
   showMessage('Não foi possível abrir os dados da loja. Confirme a licença e a ligação à internet.',true);
  }finally{
   busy=false;
   if(loading){if(succeeded)void loading.finish();else loading.cancel();}
  }
 };
 const lockedScreen=(reason)=>{
  closeScanner?.();
  const message={
   blocked:'O seu acesso foi bloqueado pelo proprietário. Contacte o responsável.',
   outside_schedule:'Fora do horário de trabalho. Aguarde a abertura programada ou contacte o responsável.',
   suspended:'A sua conta está suspensa. Contacte o responsável.',
   business_unavailable:'A loja não está disponível. Contacte o responsável.',
   not_associated:'A sua conta já não está associada a esta loja.'
  }[reason]||'Não é possível confirmar o acesso. Aguarde a ligação à internet.';
  clearPinKPIs(account.userId);
  accessBlocked=true;notificationsOpen=false;data=null;cart=[];pending=null;credit=null;finance=null;returns=null;inventory=null;branding=null;brandLogoUrl='';photoCache.clear();
  root.innerHTML='<section class="login-shell pronto-auth-test"><div class="panel login-panel">'+
   '<h2>Acesso ao Pronto POS encerrado</h2><p role="alert">'+esc(message)+'</p>'+
   '<p class="form-hint">A verificação é automática. Nenhum dado comercial fica disponível enquanto o acesso estiver bloqueado.</p>'+
   '<button type="button" data-shop-logout class="secondary full">Terminar sessão</button></div></section>';
 };
 const checkStaffAccess=async()=>{
  if(signal.aborted||grant.role==='owner'||accessCheckBusy)return !accessBlocked;
  if(disconnected())return !accessBlocked;
  accessCheckBusy=true;
  try{
   const state=await client.myAccessStatus(grant.id);
   if(!state.allowed){
    if(!accessBlocked)lockedScreen(state.reason);
    return false;
   }
   if(accessBlocked){
    if(busy)return false;
    const latest=await client.account();
    const permitted=latest.grants.find(g=>g.id===grant.id);
    if(!permitted){lockedScreen('not_associated');return false;}
    account=latest;grant=permitted;accessBlocked=false;
    await safeLoad(true);
   }
   return true;
  }catch(error){
   if(error.message==='supabase_unauthorized'){await leave();return false;}
   if(!signal.aborted&&!accessBlocked)lockedScreen('connection_lost');
   return false;
  }finally{accessCheckBusy=false;}
 };
 // Refresh only protected inventory data so the bell and menu counts follow real changes
 // in the current branch. Updating badges in place preserves open forms and drafts.
 let alertRefreshBusy=false;
 const refreshAlertBadges=()=>{
  const count=authorizedView('alerts')?inventoryNotificationSummary(inventory,alertDays).total:0;
  root.querySelectorAll('[data-shop-alert-count]').forEach(badge=>{
   badge.hidden=count===0;badge.textContent=count>99?'99+':String(count);
   badge.setAttribute('aria-label',count+' alerta(s)');
  });
  root.querySelector('[data-shop-view="alerts"]')?.setAttribute('aria-label','Alertas'+(count?' ('+count+')':''));
  root.querySelector('[data-shop-notifications]')?.setAttribute('aria-label','Notificações: '+count+' alerta(s)');
 };
 const refreshAlerts=async()=>{
  if(signal.aborted||accessBlocked||busy||alertRefreshBusy||disconnected()||document.hidden||
   client.isScreenLocked?.()||!authorizedView('alerts')||!branchId||typeof client.inventorySnapshot!=='function')return;
  alertRefreshBusy=true;
  const business=grant.id,branch=branchId,user=account.userId;
  try{
   const next=await client.inventorySnapshot(business,branch);
   if(signal.aborted||accessBlocked||grant.id!==business||branchId!==branch||account.userId!==user||client.isScreenLocked?.())return;
   inventory=next;
   refreshAlertBadges();
   if(notificationsOpen||(view==='alerts'&&!root.querySelector('input:focus,textarea:focus,select:focus')))render();
  }catch{/* Keep the existing view; do not manufacture alerts on network failure. */}
  finally{alertRefreshBusy=false;}
 };
 const alertTimer=setInterval(()=>{void refreshAlerts();},120000);
 signal.addEventListener('abort',()=>clearInterval(alertTimer),{once:true});
 const accessTimer=setInterval(()=>{void checkStaffAccess();},5000);
 signal.addEventListener('abort',()=>clearInterval(accessTimer),{once:true});
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){closeScanner?.();return;}
  void checkStaffAccess().then(ok=>{if(ok)void refreshAlerts();});
 },{signal});
 window.addEventListener('focus',()=>{void checkStaffAccess().then(ok=>{if(ok)void refreshAlerts();});},{signal});
 const loadReports=async()=>{
  if(disconnected())return showMessage('Sem internet, não é possível actualizar relatórios.',true);
  if(busy)return;
  busy=true;showMessage('');
  try{
   report=await client.reportsSnapshot(grant.id,reportScope==='all'?null:branchId,reportFrom,reportTo);
   render();showMessage('Relatório actualizado. Os valores são operacionais e não substituem documentos fiscais.');
  }catch(error){report=null;render();showMessage('Não foi possível obter o relatório. Verifique as datas e permissões. ('+error.message+')',true);}
  finally{busy=false;}
 };
 const loadAudit=async()=>{
  if(disconnected())return showMessage('É necessário estar online para consultar a auditoria.',true);
  if(busy||grant.role!=='owner')return;
  busy=true;showMessage('');
  try{audit=await client.ownerAuditSnapshot(grant.id,auditPage);
   render();showMessage('Histórico de actividades actualizado.');}
  catch(error){audit=null;render();showMessage('Não foi possível consultar a auditoria. ('+error.message+')',true);}
  finally{busy=false;}
 };
 const lockPending=()=>{if(!pending)return false;showMessage('Existe uma venda por confirmar. Reenvie o mesmo pedido ou confira a venda antes de descartá-lo.',true);return true;};
 const add=(id,delta=1)=>{
  if(lockPending())return;
  const p=data.products.find(x=>x.id===id);
  if(!p)return showMessage('Produto indisponível.',true);
  const item=cart.find(x=>x.productId===id);
  const q=(item?.quantity||0)+delta;
  if(q>p.stock)return showMessage('Stock insuficiente.',true);
  if(q<=0)cart=cart.filter(x=>x.productId!==id);
  else if(item)item.quantity=q;
  else cart.push({productId:id,quantity:q});
  notice='';render();
 };
 const scanCode=code=>{
  if(accessBlocked||client.isScreenLocked?.()||view!=='sell'||!authorizedView('sell'))return 'Leitura disponível apenas no ponto de venda desbloqueado.';
  if(pending)return 'Resolva a venda pendente antes de adicionar outro produto.';
  const product=findScannedShopProduct(data?.products,code);
  if(!product)return 'Código não encontrado nesta loja.';
  const inCart=cart.find(row=>row.productId===product.id)?.quantity||0;
  if(inCart+1>product.stock)return 'Produto sem stock suficiente para esta venda.';
  add(product.id);return true;
 };
 const updateCashChangePreview=()=>{
  const form=root.querySelector('#shop-sale-form');
  const box=form?.querySelector('[data-shop-change-preview]');
  if(!form||!box)return;
  const preview=checkoutCashPreview({
   method,totalCents:Number(form.dataset.shopTotalCents),
   receivedRaw:form.elements.namedItem('cash_received')?.value??'',
   cashPortionRaw:form.elements.namedItem('pay_cash')?.value??'0'
  });
  box.dataset.state=preview.state;
  const amount=box.querySelector('[data-shop-change-amount]');
  const note=box.querySelector('[data-shop-change-note]');
  if(!amount||!note)return;
  const messages={
   waiting:['—','Introduza o valor recebido para calcular o troco.'],
   empty:['—','Adicione produtos à venda para calcular o troco.'],
   no_cash:['—','Este pagamento repartido não inclui dinheiro físico.'],
   invalid:['—','Introduza um valor de dinheiro válido.'],
   invalid_split:['—','Confira o valor da parte paga em dinheiro.'],
   exact:[MONEY(0),'Pagamento exacto. Não há troco.'],
   change:[MONEY(preview.change||0),'Troco a entregar ao cliente.'],
   short:['Falta '+MONEY(preview.shortfall||0),'O dinheiro recebido é insuficiente.'],
  };
  const [value,description]=messages[preview.state]||messages.invalid;
  amount.textContent=value;
  note.textContent=description;
 };
 const updatePanel=()=>{
  const panel=root.querySelector('#shop-checkout-panel');
  if(panel&&data)panel.outerHTML=shopPaymentPanel({method,cart,products:data.products,discount,session:session(),role:grant.role,credit,selectedCustomerId,creditDue,valueModeProducts:[...valueModeProducts],allowNoSession:cashState?.policy.openingRequired===false});
  // The mobile payment shortcuts are outside the checkout panel; keep both
  // groups in sync without replacing the search field or the product list.
  root.querySelectorAll('.shop-methods-mobile-quick [data-shop-method]').forEach(button=>{
   const selected=button.dataset.shopMethod===method;
   button.setAttribute('aria-pressed',String(selected));
   button.classList.toggle('selected',selected);
  });
 };
 const cashData=fields=>({business_id:grant.id,branch_id:branchId,...fields});
 const processSale=async()=>{
  if(!pending)return;
  if(disconnected()){showMessage('Sem internet: a venda não foi concluída. Guarde o rascunho encriptado e volte a tentar depois de restabelecer a ligação.',true);return;}
  busy=true;showMessage('');
  try{
   const checkoutRequest=pending;
   const receiptProducts=data.products.slice();
   const result=await client.merchantAction(pending.due_on?'credit_sale':'sale_complete',pending);
   const wasRepeated=result.duplicate===true;
   const receipt=confirmedSaleReceipt({request:checkoutRequest,result,products:receiptProducts,
    shop:grant.name,branch:branches.find(b=>b.id===branchId)?.name||'',seller:account.email});
   if(resumedHoldId&&typeof client.holdAction==='function'){
    try{await client.holdAction('hold_delete',cashData({hold_id:resumedHoldId}));resumedHoldId=null;}
    catch{/* Sale was committed; the held cart may require manual removal. */}
   }
   cart=[];pending=null;discount='0';method='cash';query='';creditDue='';
   try{await refresh();}catch{render();}
   void refreshPinMetrics(true);
   showMessage((wasRepeated?'Venda anteriormente registada, sem duplicação. ':result.debt_id?'Venda a crédito registada. ':'Venda concluída. ')+
    'Referência: '+String(result.sale_id||'').slice(0,8)+'.');
   // The decision appears only after a confirmed server commit, never on failure.
   void showSaleCompleteModal(receipt).then(action=>{
    if(action==='print'){
     try{printSaleReceipt(receipt,{branding,logoUrl:brandLogoUrl});}
     catch{showMessage('Venda confirmada. Não foi possível abrir a impressão neste dispositivo.',true);}
    }else if(action==='new'){
     view='sell';render();
     root.querySelector('#shop-search')?.focus();
    }
   }).catch(()=>showMessage('Venda confirmada. Consulte o histórico para imprimir o comprovativo.',true));
  }catch(e){
   render();
   showMessage('Venda ainda sem confirmação. Verifique a sessão e clique em «Repetir o mesmo pedido» para evitar duplicações. ('+String(e.message||'erro')+')',true);
  }finally{busy=false;}
 };
 const execute=async(action,payload)=>{
  if(busy)return;
  if(disconnected())return showMessage('Sem ligação à internet. A operação não foi enviada.',true);
  busy=true;showMessage('');
  try{
   const result=['cash_open','cash_close'].includes(action)&&typeof client.cashControl==='function'?
    await client.cashControl(action==='cash_open'?'open':'close',cashData(payload)):
    await client.merchantAction(action,cashData(payload));
   if(action==='product_create'&&payload.allow_fractional===true){
    try{await client.productFractionUpdate({businessId:grant.id,branchId,productId:result.product_id,
     allowFractional:true,expectedRevision:0});}
    catch(error){await refresh();render();showMessage('Produto criado, mas a venda fraccionada não foi activada. Abra Inventário e tente novamente. ('+error.message+')',true);return;}
   }
   await refresh();
   if(action==='product_create')view='products';
   if(action==='customer_save')view='customers';
   if(action==='debt_payment')view='debts';
   render();
   const summary=action==='product_create'?'Produto criado com código '+result.code:
    action==='stock_receive'?'Stock recebido e registado por lote.':
    action==='cash_open'?'Sessão de caixa aberta.':
    action==='cash_close'?'Caixa encerrado. Esperado: '+(Number(result.expected_cents)/100).toFixed(2)+' MT; diferença: '+(Number(result.difference_cents)/100).toFixed(2)+' MT.':
    action==='customer_save'?'Cliente guardado com sucesso.':
    action==='credit_policy'?'Limite de crédito actualizado com auditoria.':
    action==='debt_payment'?'Pagamento da dívida confirmado.':
    'Operação realizada.';
   showMessage(summary);
  }catch(e){
   if(['supabase_unauthorized','shop_access_required'].includes(e.message)){await leave();return;}
   showMessage('Operação rejeitada ou sem confirmação. Verifique os dados antes de tentar novamente. ('+String(e.message||'erro')+')',true);
  }finally{busy=false;}
 };
 // Close the notification popover without re-rendering a merchant's input form.
 root.addEventListener('pointerdown',event=>{
  if(!notificationsOpen||event.target.closest('.shop-notification-area'))return;
  notificationsOpen=false;root.querySelector('.shop-notification-popover')?.remove();
  root.querySelector('[data-shop-notifications]')?.setAttribute('aria-expanded','false');
 },{signal});
 root.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!notificationsOpen)return;
  notificationsOpen=false;root.querySelector('.shop-notification-popover')?.remove();
  const trigger=root.querySelector('[data-shop-notifications]');
  trigger?.setAttribute('aria-expanded','false');trigger?.focus({preventScroll:true});
 },{signal});
 root.addEventListener('click',async event=>{
  const el=event.target.closest('button');
  if(!el||busy||signal.aborted)return;
  if(el.hasAttribute('data-document-preview')){
   if(grant.role!=='owner')return;
   const form=root.querySelector('#shop-document-settings-form');
   if(!form)return;
   const fields=new FormData(form);
   const draft=normalizeDocumentBranding({
    displayName:fields.get('display_name'),address:fields.get('address'),
    phone:fields.get('phone'),email:fields.get('email'),
    primaryColor:fields.get('primary_color'),secondaryColor:fields.get('secondary_color'),
    footerNote:fields.get('footer_note'),template:fields.get('template'),
    logoPath:branding?.logoPath||''
   },grant.name);
   const win=window.open('','_blank');
   if(!win)return showMessage('Autorize a janela de pré-visualização.',true);
   win.document.write(brandedDocumentHTML({
    branding:draft,logoUrl:brandLogoUrl,title:'Pré-visualização de documento',
    subtitle:'Exemplo da identidade visual. Nenhum dado comercial é utilizado.',
    meta:[['Período','A definir'],['Filial','A definir']],
    sections:[{title:'Exemplo de tabela',columns:['Descrição','Quantidade','Valor (MT)'],rows:[]}],
    summary:[['Total ilustrativo','—']],scopeNote:'Documento de pré-visualização, sem validade fiscal.'
   }));
   win.document.close();return;
  }
  if(el.hasAttribute('data-shop-cashier-toggle')){
    if(!authorizedView('sell'))return;
    cashierMode=!cashierMode;closeScanner?.();
    notificationsOpen=false;menuOpen=false;
    // Only presentation changes. The current cart and payment survive.
    view='sell';render();return;
   }
   if(el.hasAttribute('data-shop-notifications')){
   notificationsOpen=!notificationsOpen;render();
   root.querySelector('[data-shop-notifications]')?.focus({preventScroll:true});return;
  }
  if(el.hasAttribute('data-shop-notifications-all')){
   if(!authorizedView('alerts'))return;
   notificationsOpen=false;view='alerts';menuOpen=false;render();return;
  }
  if(el.hasAttribute('data-shop-menu-toggle')){menuOpen=!menuOpen;render();return;}
  if(el.hasAttribute('data-shop-sidebar-collapse')){sidebarCollapsed=!sidebarCollapsed;render();return;}
  if(el.hasAttribute('data-shop-logout'))return void leave();
  if(el.hasAttribute('data-cash-export')){
   if(!['owner','manager'].includes(grant.role)||!cashState)return;
   const blob=new Blob([cashSessionsCSV(cashState)],{type:'text/csv;charset=utf-8'});
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='sessoes-caixa-pronto-pos.csv';document.body.appendChild(link);link.click();link.remove();
   URL.revokeObjectURL(url);return;
  }
  if(el.hasAttribute('data-staff-access-mode')){
   if(grant.role!=='owner'||disconnected())return showMessage('Apenas o proprietário pode alterar o acesso online.',true);
   const mode=el.dataset.staffAccessMode,target=el.dataset.staffUser;
   const employee=staffManagement?.staff.find(p=>p.id===target);
   if(!employee||!['auto','allow','block'].includes(mode))return;
   const confirmation={block:'Bloquear imediatamente',allow:'Autorizar imediatamente',auto:'Retomar o horário automático'}[mode];
   if(!await confirmShop(confirmation+' para '+employee.name+'?'))return;
   busy=true;showMessage('A actualizar acesso remoto no servidor…');
   void(async()=>{
    try{
     await client.ownerStaffAccessAction('mode',{business_id:grant.id,user_id:target,manual_mode:mode});
     await refresh();
     showMessage('Controlo remoto actualizado. O servidor já aplica o novo acesso.');
    }catch(error){showMessage('Não foi possível alterar o acesso. ('+error.message+')',true);}
    finally{busy=false;}
   })();return;
  }
  if(el.hasAttribute('data-staff-suspend')||el.hasAttribute('data-staff-reactivate')){
   if(grant.role!=='owner'||disconnected())return showMessage('A alteração exige permissão de proprietário e ligação activa.',true);
   const mode=el.hasAttribute('data-staff-suspend')?'suspend':'reactivate';
   const target=mode==='suspend'?el.dataset.staffSuspend:el.dataset.staffReactivate;
   const user=staffManagement?.staff.find(p=>p.id===target);
   if(!user||!await confirmShop((mode==='suspend'?'Suspender':'Reactivar')+' a conta de '+user.name+
     '? As permissões no servidor mudam imediatamente.'))return;
   busy=true;showMessage('A actualizar permissões do colaborador…');
   void(async()=>{
    try{
     await client.ownerStaffAction(mode,{business_id:grant.id,user_id:target});
     await refresh();
     showMessage(mode==='suspend'?'Acesso ao negócio suspenso no servidor.':
      'Acesso reactivado. O colaborador deverá voltar a entrar para actualizar a interface.');
    }catch(error){showMessage('Não foi possível alterar o acesso. ('+error.message+')',true);}
    finally{busy=false;}
   })();return;
  }
  if(el.hasAttribute('data-transfer-add')){
   const form=root.querySelector('[data-shop-form="transfer_send"]');
   const values=form?Array.from(form.elements).filter(x=>x.name).map(x=>[x.name,x.value]):[];
   transferLineCount=Math.min(10,transferLineCount+1);render();
   const next=root.querySelector('[data-shop-form="transfer_send"]');
   for(const [name,value] of values){
    const field=Array.from(next?.elements||[]).find(x=>x.name===name);
    if(field)field.value=value;
   }
   return;
  }
  if(el.hasAttribute('data-transfer-clear')){
   if(await confirmShop('Já verificou no histórico se esta expedição foi registada?')){
    pendingTransfer=null;render();
    showMessage('Referência local descartada. A operação já registada no servidor permanece.');
   }
   return;
  }
  if(el.hasAttribute('data-transfer-receive')||el.hasAttribute('data-transfer-cancel')){
   if(!['owner','manager','stock'].includes(grant.role)||disconnected())return showMessage('Esta acção exige ligação e permissão de gestão de stock.',true);
   const mode=el.hasAttribute('data-transfer-receive')?'receive':'cancel';
   const transferId=mode==='receive'?el.dataset.transferReceive:el.dataset.transferCancel;
   if(!await confirmShop(mode==='receive'?'Confirma a recepção física dos artigos nesta filial?':'Confirma o cancelamento antes da recepção e a reposição dos lotes na origem?'))return;
   busy=true;showMessage('A actualizar o movimento no servidor…');
   void(async()=>{
    try{
     const result=await client.transferAction(mode,{business_id:grant.id,transfer_id:transferId});
     await refresh();
     showMessage((result.duplicate?'Operação já confirmada. ':mode==='receive'?'Stock recebido na filial de destino. ':'Stock devolvido à filial de origem. ')+
      'Ref. '+String(transferId).slice(0,8)+'.');
    }catch(error){showMessage('O movimento não foi confirmado. Actualize a lista e verifique o estado antes de repetir. ('+error.message+')',true);}
    finally{busy=false;}
   })();return;
  }
  if(el.hasAttribute('data-finance-supplier')){supplierId=el.dataset.financeSupplier;render();return;}
  if(el.hasAttribute('data-finance-add-line')){
   const form=root.querySelector('[data-shop-form="purchase_receive"]');
   const values=form?Array.from(form.elements).filter(e=>e.name).map(e=>[e.name,e.value]):[];
   purchaseLines=Math.min(15,purchaseLines+1);render();
   const replacement=root.querySelector('[data-shop-form="purchase_receive"]');
   for(const [name,value] of values){const field=Array.from(replacement?.elements||[]).find(e=>e.name===name);if(field)field.value=value;}
   return;
  }
  if(el.hasAttribute('data-finance-discard')){
   if(await confirmShop('Já confirmou no histórico se a operação foi registada? Descartar uma tentativa NÃO reverte lançamentos existentes.')){pendingFinance=null;showMessage('Referência local descartada. Confirme o histórico antes de repetir.');}
   return;
  }
  if(el.hasAttribute('data-credit-customer')){selectedCustomerId=el.dataset.creditCustomer;render();return;}
  if(el.hasAttribute('data-credit-receipt')||el.hasAttribute('data-credit-statement')){
   if(!credit)return;
   const win=window.open('','_blank');
   if(!win)return showMessage('Autorize a janela de impressão.',true);
   try{
    const debtId=el.dataset.creditReceipt;
    const customerId=debtId?credit.debts.find(d=>d.id===debtId)?.customerId:el.dataset.creditStatement;
    const logoUrl=branding?.logoPath?await client.documentLogoUrl(branding.logoPath):'';
    win.document.write(creditStatementHTML(credit,customerId,{debtId,branding,logoUrl}));
    win.document.close();
    win.addEventListener('load',()=>{win.focus();win.print();},{once:true});
   }catch{win.close();showMessage('Não foi possível gerar o extracto.',true);}return;
  }
  if(el.hasAttribute('data-credit-whatsapp')){
   try{window.open(creditWhatsAppURL(credit,el.dataset.creditWhatsapp),'_blank','noopener,noreferrer');}
   catch{showMessage('Verifique o telefone do cliente.',true);}return;
  }
  if(el.hasAttribute('data-shop-credit')){if(lockPending())return;method=method==='credit'?'cash':'credit';updatePanel();return;}
  if(el.hasAttribute('data-shop-refresh'))return void safeLoad(false,true);
  if(el.hasAttribute('data-branch-toggle')){
   if(grant.role!=='owner'||disconnected()||pending)return;
   const mode=el.dataset.branchActive==='true'?'deactivate':'reactivate';
   if(!await confirmShop('Confirmar '+(mode==='deactivate'?'desactivação':'reactivação')+' desta filial?'))return;
   busy=true;void(async()=>{try{
    await client.manageBranch(mode,{business_id:grant.id,branch_id:el.dataset.branchToggle});
    branches=await client.merchantBranches(grant.id);
    await refresh();showMessage('Estado da filial actualizado.');
   }catch(e){showMessage('Operação não realizada: '+e.message,true);}
   finally{busy=false;}})();return;
  }
  if(el.hasAttribute('data-audit-prev')||el.hasAttribute('data-audit-next')){
   if(grant.role!=='owner')return;
   auditPage=Math.max(0,auditPage+(el.hasAttribute('data-audit-next')?1:-1));
   audit=null;render();void loadAudit();return;
  }
  if(el.hasAttribute('data-audit-export')){
   if(grant.role!=='owner'||!audit)return;
   const blob=new Blob([auditCSV(audit)],{type:'text/csv;charset=utf-8'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='auditoria-pronto-pos-pagina-'+(audit.page+1)+'.csv';
   document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);return;
  }
  if(el.hasAttribute('data-report-print')){
   if(!report)return;
   const win=window.open('','_blank');
   if(!win)return showMessage('Autorize a janela de impressão.',true);
   try{
    const payload=reportDocumentData(report);
    const logoUrl=branding?.logoPath?await client.documentLogoUrl(branding.logoPath):'';
    win.document.write(brandedDocumentHTML({
     ...payload,branding,logoUrl,title:'Relatório financeiro e operacional',
     subtitle:'Relatório interno do Pronto POS · valores expressos em meticais',
     scopeNote:'Lucro estimado depende dos custos de compra disponíveis. Documento não fiscal.'
    }));
    win.document.close();
    win.addEventListener('load',()=>{win.focus();win.print();},{once:true});
   }catch{win.close();showMessage('Não foi possível gerar o relatório para impressão.',true);}
   return;
  }
  if(el.hasAttribute('data-report-xlsx')){
   if(!report)return;
   busy=true;showMessage('A preparar a folha Excel...');
   try{
    const payload=reportDocumentData(report);
    await downloadBrandedExcel({
     ...payload,title:'Relatório financeiro e operacional',
     period:report.start+' a '+report.end,
     filename:'relatorio-pronto-pos-'+report.start+'-'+report.end+'.xlsx'
    });
    showMessage('Relatório Excel preparado.');
   }catch(e){showMessage('Não foi possível exportar o Excel: '+String(e.message||'erro'),true);}
   finally{busy=false;}
   return;
  }
  if(el.hasAttribute('data-report-export')){
   if(!report)return;
   const blob=new Blob([reportsCSV(report)],{type:'text/csv;charset=utf-8'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='relatorio-pronto-pos.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);return;
  }
  if(el.hasAttribute('data-inventory-select')){selectedProductId=el.dataset.inventorySelect;render();return;}
  if(el.hasAttribute('data-inventory-xlsx')){
   if(!inventory||!authorizedView('shopping_list'))return;
   busy=true;showMessage('A preparar a lista Excel...');
   try{
    const suggestions=inventoryAlerts(inventory,alertDays).suggestions;
    await downloadBrandedExcel({
     title:'Lista automática de compras',period:'Gerado em '+maputoDate(),
     summary:[['Artigos sugeridos',suggestions.length],['Filial',branches.find(b=>b.id===branchId)?.name||'Filial']],
     sections:[{title:'Sugestões de compra · estimativa',columns:['Produto','Disponível','Vendido em 30 dias','Comprar'],
      rows:suggestions.map(x=>[x.name,x.available,x.sold30,x.suggested])}],
     filename:'lista-compras-pronto-pos-'+maputoDate()+'.xlsx'
    });
    showMessage('Lista de compras Excel preparada. Confirme as quantidades antes de encomendar.');
   }catch(e){showMessage('Não foi possível exportar a lista Excel: '+String(e.message||'erro'),true);}
   finally{busy=false;}
   return;
  }
  if(el.hasAttribute('data-inventory-export')){
   if(!inventory)return;
   const csv=shoppingListCSV(inventory);
   const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
   const url=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=url;link.download='lista-compras-pronto-pos.csv';
   document.body.appendChild(link);link.click();link.remove();
   URL.revokeObjectURL(url);return;
  }

  if(el.hasAttribute('data-shop-hold')){
   if(lockPending()||!cart.length||disconnected())return showMessage('A venda em espera exige ligação; não foi guardada.',true);
   busy=true;const holdId=holdIdToSave||crypto.randomUUID();holdIdToSave=holdId;
   void(async()=>{
    try{
     await client.holdAction('hold_save',cashData({hold_id:holdId,cart,customer_id:selectedCustomerId||null}));
     holdIdToSave=null;cart=[];selectedCustomerId='';discount='0';method='cash';view='held';
     await refresh();showMessage('Venda suspensa na filial. O stock não foi reservado.');
    }catch(error){showMessage('Sem confirmação do servidor. Verifique a lista antes de repetir com a mesma referência.',true);}
    finally{busy=false;}
   })();return;
  }
  if(el.hasAttribute('data-shop-hold-resume')){
   if(pending)return void lockPending();
   const held=heldSales.find(x=>x.id===el.dataset.shopHoldResume);if(!held)return;
   if(cart.length&&!await confirmShop('Substituir o carrinho actual por esta venda em espera?'))return;
   cart=held.cart.map(x=>({productId:x.productId,quantity:x.quantity}));
   selectedCustomerId=held.customerId||'';resumedHoldId=held.id;method='cash';discount='0';view='sell';render();
   showMessage('Venda retomada. O stock e os preços serão verificados novamente ao concluir.');return;
  }
  if(el.hasAttribute('data-shop-hold-delete')){
   if(!await confirmShop('Eliminar este carrinho em espera? Não existe venda concluída a cancelar.'))return;
   busy=true;void(async()=>{
    try{await client.holdAction('hold_delete',cashData({hold_id:el.dataset.shopHoldDelete}));
     await refresh();showMessage('Carrinho em espera eliminado.');}
    catch{showMessage('Não foi possível remover o carrinho.',true);}
    finally{busy=false;}
   })();return;
  }

  if(el.hasAttribute('data-shop-draft-clear')){
   if(await confirmShop('Apagar o rascunho encriptado deste dispositivo? Isto não cancela vendas já registadas na loja.')){
    clearShopDraft(localStorage,scope());render();showMessage('Rascunho local apagado.');
   }return;
  }
  if(el.hasAttribute('data-shop-scan')){
   if(!authorizedView('sell')||view!=='sell'||accessBlocked||client.isScreenLocked?.())return;
   closeScanner?.();
   closeScanner=openShopCodeScanner({onCode:scanCode,onClose:()=>{closeScanner=null;}});
   return;
  }
  if(el.hasAttribute('data-shop-add'))return void add(el.dataset.shopAdd);
  if(el.hasAttribute('data-shop-value-toggle')){
   if(lockPending())return;
   const id=el.dataset.shopValueToggle;
   if(valueModeProducts.has(id))valueModeProducts.delete(id);else valueModeProducts.add(id);
   render();return;
  }
  if(el.hasAttribute('data-remove')){
   if(lockPending())return;
   cart=cart.filter(x=>x.productId!==el.dataset.remove);render();return;
  }
  if(el.hasAttribute('data-qty'))return void add(el.dataset.id,Number(el.dataset.qty));
  if(el.hasAttribute('data-shop-held-tab')){if(!authorizedView('held'))return;view='held';render();return;}
  if(el.hasAttribute('data-shop-sell-tab')){if(!authorizedView('sell'))return;view='sell';render();return;}
  if(el.hasAttribute('data-shop-settings-section')){
   if(grant.role!=='owner'||view!=='settings')return;
   settingsSection=el.dataset.shopSettingsSection;render();
   root.querySelector('.owner-settings-heading')?.scrollIntoView({block:'start',behavior:'smooth'});
   return;
  }
  if(el.hasAttribute('data-shop-pin-change')||el.hasAttribute('data-shop-pin-lock')){
   if(grant.role!=='owner')return;
   const action=el.hasAttribute('data-shop-pin-change')?'data-pin-change':'data-pin-lock';
   const control=document.querySelector('.pronto-pin-controls ['+action+']');
   if(!control)return showMessage('O controlo de PIN está indisponível nesta sessão.',true);
   control.click();return;
  }
  if(el.hasAttribute('data-shop-view')){if(!authorizedView(el.dataset.shopView))return;closeScanner?.();view=el.dataset.shopView;menuOpen=false;notificationsOpen=false;notice='';render();if(view==='reports')void loadReports();if(view==='audit'){audit=null;void loadAudit();}return;}
  if(el.hasAttribute('data-shop-go-checkout')){root.querySelector('#shop-checkout-panel')?.scrollIntoView({block:'start',behavior:'smooth'});return;}
  if(el.hasAttribute('data-shop-method')){if(lockPending())return;method=el.dataset.shopMethod;updatePanel();return;}
  if(el.hasAttribute('data-shop-retry'))return void processSale();
  if(el.hasAttribute('data-shop-discard')){
   if(await confirmShop('Verificou no histórico e no caixa se esta venda foi ou não concluída? Descartar o pedido pendente não anula uma venda já gravada.')){
    pending=null;showMessage('Pedido pendente descartado. Confira o histórico antes de uma nova venda.');render();
   }
  }
 },{signal});
 root.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='shop-search'){
   query=el.value;
   const results=root.querySelector('#shop-product-results');
   if(results){results.innerHTML=renderShopProductResults(data?.products||[],query);hydrateProductPhotos(results);}
  }else if(el.id==='shop-inventory-search'){
   inventoryQuery=el.value;
   const term=inventoryQuery.toLocaleLowerCase();
   root.querySelectorAll('[data-inventory-select]').forEach(button=>{
    const p=inventory?.products.find(x=>x.id===button.dataset.inventorySelect);
    button.hidden=!p||(p.name+' '+p.code).toLocaleLowerCase().includes(term);
   });
  }else if(el.id==='shop-customer-search'){
   customerQuery=el.value;
   const visible=searchCustomers(credit?.customers||[],customerQuery).map(c=>c.id);
   root.querySelectorAll('[data-credit-customer]').forEach(btn=>{btn.hidden=!visible.includes(btn.dataset.creditCustomer);});
  }else if(el.name==='discount'){
   discount=el.value;
  }else if(el.name==='cash_received'||(el.name==='pay_cash'&&method==='mixed')){
   updateCashChangePreview();
  }
 },{signal});
 root.addEventListener('change',event=>{
  const el=event.target;
  if(el.name==='unit'){
   const box=el.closest('form')?.querySelector('input[name="allow_fractional"]');
   if(box){box.disabled=!allowsFractionalSale({unit:el.value,allowFractional:true});if(box.disabled)box.checked=false;}
   return;
  }
  if(el.id==='shop-business-select'){
   const next=account.grants.find(x=>x.id===el.value);
   if(!next||busy)return;
   if(pending)return showMessage('Resolva a venda pendente antes de mudar de empresa.',true);
   closeScanner?.();clearPinKPIs(account.userId);pinMetricCheckedAt=0;grant=next;alertDays=readAlertDays();settingsSection='personalizacao';void safeLoad(true);return;
  }
  if(el.id==='shop-branch-select'){
   if(pending)return showMessage('Resolva a venda pendente antes de mudar de filial.',true);
   if(!branches.some(b=>b.id===el.value))return;
   closeScanner?.();clearPinKPIs(account.userId);pinMetricCheckedAt=0;branchId=el.value;cart=[];method='cash';discount='0';query='';report=null;void safeLoad();return;
  }
  if(el.id==='shop-audit-search'){auditSearch=el.value;render();return;}
  if(el.id==='shop-sale-customer'){if(lockPending())return;selectedCustomerId=el.value;updatePanel();return;}
  if(el.id==='shop-credit-due'){creditDue=el.value;return;}
  if(el.id==='shop-debt-filter'){debtFilter=el.value;render();return;}
  if(el.id==='shop-return-sale'){selectedReturnSaleId=el.value;render();return;}
  if(el.id==='shop-alert-days'){alertDays=[7,15,30,60,90,180,365].includes(Number(el.value))?Number(el.value):30;try{localStorage.setItem(alertDaysKey(),String(alertDays));}catch{/* The current session still uses the selected threshold. */}render();return;}
  if(el.name==='discount'){if(!lockPending())updatePanel();return;}
  if(el.hasAttribute('data-cart-qty')){
   if(lockPending())return;
   const p=data.products.find(x=>x.id===el.dataset.cartQty),line=cart.find(x=>x.productId===el.dataset.cartQty);
   if(!p||!line)return;
   try{
    const next=toQuantity(el.value,p.unit);
    validateSaleQuantity(p,next);
    line.quantity=next;render();
   }catch{showMessage('Quantidade inválida ou superior ao stock.',true);el.value=String(line.quantity);}
  }
  if(el.hasAttribute('data-shop-cart-value')){
   if(lockPending())return;
   const p=data.products.find(x=>x.id===el.dataset.shopCartValue),line=cart.find(x=>x.productId===el.dataset.shopCartValue);
   if(!p||!line)return;
   try{
    line.quantity=quantityFromValueCents({priceCents:p.priceCents,amountCents:toCents(el.value),product:p});
    render();
   }catch(error){showMessage(error.message==='amount_unrepresentable'? 'Este valor não corresponde a uma quantidade exacta permitida. Escolha outro montante ou venda por quantidade.':'Valor inválido ou stock insuficiente.',true);el.value=(Math.round(p.priceCents*line.quantity)/100).toFixed(2);}
  }
 },{signal});
 root.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.target.id!=='shop-search')return;
  event.preventDefault();
  if(lockPending())return;
  const exact=data.products.find(p=>p.code.toLocaleLowerCase()===event.target.value.trim().toLocaleLowerCase());
  if(exact){query='';add(exact.id);}
  else showMessage('Código não encontrado.',true);
 },{signal});
 root.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement))return;
  // Prevent browser navigation on every submit, including duplicate taps during an async save.
  event.preventDefault();
  if(busy)return;
  if(form.id==='shop-document-settings-form'){
   if(grant.role!=='owner'||disconnected())return showMessage('Apenas o proprietário online pode guardar a personalização.',true);
   const fields=new FormData(form);
   const raw=normalizeDocumentBranding({
    displayName:fields.get('display_name'),address:fields.get('address'),
    phone:fields.get('phone'),email:fields.get('email'),
    primaryColor:fields.get('primary_color'),secondaryColor:fields.get('secondary_color'),
    footerNote:fields.get('footer_note'),template:fields.get('template'),
    logoPath:branding?.logoPath||''
   },grant.name);
   try{serializeDocumentBranding(raw);}
   catch{return showMessage('Confirme o nome comercial e o e-mail.',true);}
   const file=fields.get('document_logo');
   busy=true;showMessage('A guardar personalização na nuvem...');
   try{
    if(file&&file.size>0)raw.logoPath=await client.uploadDocumentLogo(grant.id,file);
    branding=await client.saveDocumentSettings(grant.id,raw);
    brandLogoUrl=branding.logoPath?await client.documentLogoUrl(branding.logoPath):'';
    render();showMessage('Personalização guardada e aplicada aos documentos.');
   }catch(e){showMessage('Não foi possível guardar a personalização: '+String(e.message||'erro'),true);}
   finally{busy=false;}
   return;
  }
  if(form.id==='shop-reports-form'){
   const fields=new FormData(form);
   const from=String(fields.get('from')||''),to=String(fields.get('to')||'');
   const scope=String(fields.get('scope')||'branch');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||
    from>to||scope==='all'&&!['owner','manager','finance'].includes(grant.role))
     return showMessage('Datas ou abrangência inválidas.',true);
   reportFrom=from;reportTo=to;reportScope=scope==='all'?'all':'branch';
   void loadReports();return;
  }
  if(form.id==='shop-sale-form'){
   if(lockPending())return;
   const shift=session();
   if(!shift&&cashState?.policy.openingRequired!==false)return showMessage('Abra a sua sessão de caixa para vender.',true);
   try{
    const f=new FormData(form);
    const disc=grant.role==='cashier'?'0':root.querySelector('[name="discount"]')?.value||'0';
    const tempTotal=(()=>{const byId=new Map(data.products.map(p=>[p.id,p]));
      return cart.reduce((s,l)=>s+Math.round(byId.get(l.productId).priceCents*l.quantity),0)-toCents(disc);})();
    const totalText=(tempTotal/100).toFixed(2);
    const idem=crypto.randomUUID();
    if(method==='credit'){
     const customer=credit?.customers.find(c=>c.id===selectedCustomerId&&c.active);
     if(!customer)throw Error('debt_customer_required');
     const outstanding=credit.debts.filter(d=>d.customerId===customer.id&&d.balance>0).reduce((n,d)=>n+d.balance,0);
     creditDue=String(f.get('credit_due')||creditDue);
     pending=makeCreditSaleRequest({businessId:grant.id,branchId,sessionId:shift?.id||null,
      cart,customer,dueOn:creditDue,today:credit.today,outstanding,total:tempTotal,
      discount:disc,idempotencyKey:idem});
     await processSale();return;
    }
    const allocations=method==='mixed'?PAYMENT_METHODS.map(m=>({
     method:m,amount:String(f.get('pay_'+m)||'0')
    })).filter(p=>toCents(p.amount)>0):[{method,amount:totalText}];
    if(allocations.some(x=>x.method!=='cash')&&f.get('confirmed')!=='yes')throw Error('digital_unconfirmed');
    const givenCash=String(f.get('cash_received')??'').trim();
    const hasCash=allocations.some(x=>x.method==='cash'&&toCents(x.amount)>0);
    if(hasCash&&!givenCash)throw Error('cash_required');
    pending=makeSaleRequest({businessId:grant.id,branchId,sessionId:shift?.id||null,
     cart,products:data.products,discount:disc,allocations,idempotencyKey:idem,
     cashReceived:givenCash||'0'});
    if(selectedCustomerId)pending.customer_id=selectedCustomerId;
    await processSale();
   }catch(e){
    pending=null;
    showMessage({
     digital_unconfirmed:'Confirme o recebimento digital antes de concluir.',
     payment_mismatch:'Os pagamentos devem somar exactamente o valor total.',
     stock_unavailable:'O stock já não é suficiente.',
     cash_short:'O dinheiro recebido é inferior ao montante devido.',
     cash_required:'Introduza o valor de dinheiro efectivamente entregue pelo cliente.',
     debt_customer_required:'Seleccione o cliente antes de registar uma dívida.',
     debt_due_date:'Seleccione um prazo de pagamento válido.',
     debt_blocked:'Este cliente está bloqueado para novas dívidas. Contacte o gerente.',
     debt_limit:'Limite de crédito insuficiente. Solicite ao proprietário ou gerente para actualizar o limite na opção Clientes.'
    }[e.message]||'Corrija os valores e as quantidades antes de concluir. ('+e.message+')',true);
   }
   return;
  }
  const action=form.dataset.shopForm;
  if(!action)return;
  if(['cash_configure','cash_request_close','cash_remote','cash_note_difference'].includes(action)){
   if(['cash_request_close','cash_remote'].includes(action)&&offlineCount()>0)
    return showMessage('Este dispositivo tem movimentos por reconciliar. Sincronize antes de fechar ou bloquear. Podem existir movimentos noutros dispositivos que não são visíveis.',true);
   if(disconnected()||typeof client.cashControl!=='function'||lockPending())
    return showMessage('A gestão do caixa exige ligação e não pode ficar pendente.',true);
   const f=new FormData(form);let command,payload;
   try{
    if(action==='cash_configure'){
     if(grant.role!=='owner')return showMessage('Apenas o proprietário altera as definições.',true);
     command='configure';payload={opening_required:f.has('opening_required'),blind_close:f.has('blind_close')};
    }else if(action==='cash_note_difference'){
     command='note_difference';payload={session_id:String(f.get('session_id')||''),reason:String(f.get('reason')||'').trim()};
     if(payload.reason.length<8||payload.reason.length>500)throw Error('reason_required');
    }else if(action==='cash_request_close'){
     if(!session())return showMessage('Sem sessão aberta para pedir fecho.',true);
     command='request_close';payload={session_id:session().id};
    }else{
     if(grant.role!=='owner')return showMessage('Apenas o proprietário pode intervir remotamente.',true);
     command=String(f.get('remote_action')||'');
     payload={session_id:String(f.get('session_id')||''),reason:String(f.get('reason')||'').trim()};
     if(!['block','unblock','admin_close'].includes(command)||payload.reason.length<12)
      return showMessage('Escolha a operação e indique um motivo detalhado.',true);
    }
    if(!await confirmShop(action==='cash_configure'?'Guardar as regras de caixa para esta filial?':
      action==='cash_request_close'?'Solicitar fecho e impedir novas vendas nesta sessão?':
      action==='cash_note_difference'?'Guardar esta justificação no histórico, sem alterar a contagem?':
      command==='admin_close'?'Fechar sem conferência? O resultado não poderá ser apresentado como dinheiro contado.':
      (command==='block'?'Bloquear':'Desbloquear')+' esta sessão de caixa?'))return;
    busy=true;showMessage('A confirmar no servidor…');
    await client.cashControl(command,cashData(payload));
    await refresh();showMessage(command==='admin_close'?'Sessão encerrada sem conferência física, com auditoria.':
     command==='request_close'?'Pedido de fecho registado. Conte o dinheiro e confirme o valor.':
     command==='note_difference'?'Justificação adicionada ao histórico sem modificar os valores.':'Operação confirmada e auditada.');
   }catch(error){showMessage('Não foi possível confirmar a operação. Consulte o estado da sessão antes de repetir. ('+error.message+')',true);}
   finally{busy=false;}
   return;
  }
  if(action==='suspended_cash_close'){
   if(grant.role!=='owner'||disconnected())return showMessage('A reconciliação exige proprietário autenticado e ligação ao servidor.',true);
   const fields=new FormData(form);
   if(!fields.has('confirmed'))return showMessage('Confirme a contagem física do caixa.',true);
   const target=String(fields.get('session_id')||''),reason=String(fields.get('reason')||'').trim();
   if(!staffCash?.sessions.some(x=>x.id===target)||reason.length<12||reason.length>250)
    return showMessage('Caixa ou motivo inválido.',true);
   let counted;
   try{counted=toCents(String(fields.get('counted_cash')||''));}
   catch{return showMessage('Introduza o montante contado em MT.',true);}
   if(counted<0)return showMessage('O dinheiro contado não pode ser negativo.',true);
   if(!await confirmShop('Confirma a contagem física e encerramento excepcional deste caixa? Não será possível reabrir esta sessão.'))return;
   busy=true;showMessage('');
   try{
    const result=await client.ownerCloseSuspendedCash({business_id:grant.id,session_id:target,
     counted_cash_cents:counted,reason});
    let refreshed=true;
    try{await refresh();}catch{refreshed=false;}
    showMessage((result.duplicate?'Este caixa já estava reconciliado. ':'Caixa encerrado com auditoria. ')+
     'Esperado: '+(result.expected_cents/100).toFixed(2)+' MT. Diferença: '+
     (result.difference_cents/100).toFixed(2)+' MT.'+
     (refreshed?'':' Actualização da lista indisponível; consulte o histórico antes de repetir.'),!refreshed);
   }catch(error){showMessage('Não foi possível confirmar o encerramento. Verifique o histórico antes de tentar novamente. ('+error.message+')',true);}
   finally{busy=false;}
   return;
  }
  if(['branch_create','branch_rename'].includes(action)){
   if(grant.role!=='owner'||disconnected()||pending)return showMessage('Não é possível alterar a filial neste momento.',true);
   const f=new FormData(form),name=String(f.get('name')||'').trim();
   const target=String(f.get('branch_id')||'');
   if(name.length<2||name.length>120)return showMessage('Nome inválido.',true);
   busy=true;
   try{
    await client.manageBranch(action==='branch_create'?'create':'rename',
     {business_id:grant.id,name,...(target?{branch_id:target}:{})});
    branches=await client.merchantBranches(grant.id);
    await refresh();showMessage('Filial actualizada com sucesso.');
   }catch(e){showMessage('Falha na gestão da filial: '+e.message,true);}
   finally{busy=false;}
   return;
  }
  if(action==='staff_access_schedule'){
   if(grant.role!=='owner'||disconnected())return showMessage('É necessário ter permissão de proprietário e internet.',true);
   const fields=new FormData(form),id=String(fields.get('user_id')||'');
   const employee=staffManagement?.staff.find(x=>x.id===id);
   const start=String(fields.get('start_time')||''),end=String(fields.get('end_time')||'');
   const weekdays=fields.getAll('weekdays').map(Number);
   if(!employee||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(start)||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(end)||start===end||
    weekdays.length===0||weekdays.length>7||new Set(weekdays).size!==weekdays.length||
    weekdays.some(day=>!Number.isInteger(day)||day<0||day>6))
    return showMessage('Revise o horário e seleccione pelo menos um dia.',true);
   const enabled=fields.has('schedule_enabled');
   if(!await confirmShop('Guardar horário para '+employee.name+'? Os horários seguem Africa/Maputo e podem bloquear uma sessão já aberta.'))return;
   busy=true;showMessage('');
   try{
    await client.ownerStaffAccessAction('schedule',{business_id:grant.id,user_id:id,
     schedule_enabled:enabled,start_time:start,end_time:end,weekdays});
    await refresh();showMessage('Horário guardado. Use «Usar horário» para activar o controlo automático.');
   }catch(error){showMessage('Não foi possível guardar o horário. ('+error.message+')',true);}
   finally{busy=false;}
   return;
  }
  if(action==='staff_role_change'){
   if(grant.role!=='owner'||disconnected())return showMessage('Apenas o proprietário pode alterar funções online.',true);
   const fields=new FormData(form),id=String(fields.get('user_id')||''),role=String(fields.get('role')||'');
   const employee=staffManagement?.staff.find(x=>x.id===id);
   if(!employee||!['manager','cashier','stock','finance'].includes(role))
    return showMessage('Funcionário ou função inválidos.',true);
   if(!await confirmShop('Alterar a função de '+employee.name+' para '+role+'?'))return;
   busy=true;showMessage('');
   try{
    await client.ownerStaffAction('role_change',{business_id:grant.id,user_id:id,role});
    await refresh();showMessage('Função alterada no servidor. O colaborador deverá entrar novamente para actualizar o menu.');
   }catch(error){showMessage('Não foi possível alterar a função. ('+error.message+')',true);}
   finally{busy=false;}
   return;
  }
  if(action==='transfer_send'){
   if(!['owner','manager','stock'].includes(grant.role)||disconnected())return showMessage('Esta operação exige ligação e autorização.',true);
   if(pending)return void lockPending();
   const fields=new FormData(form);
   if(!fields.has('confirmed'))return showMessage('Confirme as quantidades antes de expedir.',true);
   let payload;
   try{
    if(!pendingTransfer){
     const target=String(fields.get('target_branch_id')||''),reason=String(fields.get('reason')||'').trim();
     if(!branches.some(b=>b.id===target&&target!==branchId)||reason.length<3||reason.length>250)throw Error('transfer_scope');
     const items=[],seen=new Set();
     for(let i=0;i<transferLineCount;i++){
      const id=String(fields.get('product_id_'+i)||''),amount=String(fields.get('quantity_'+i)||'');
      const product=data.products.find(p=>p.id===id);
      if(!product||seen.has(id))throw Error('transfer_product_invalid');
      const quantity=toQuantity(amount,product.unit);
      if(quantity<=0)throw Error('transfer_quantity');
      items.push({product_id:id,quantity});seen.add(id);
     }
     if(!items.length)throw Error('transfer_empty');
     payload={business_id:grant.id,source_branch_id:branchId,target_branch_id:target,
      reason,items,idempotency_key:crypto.randomUUID()};
     pendingTransfer=payload;
    }else payload=pendingTransfer;
   }catch(error){return showMessage('Dados de transferência inválidos: '+error.message,true);}
   busy=true;showMessage('A confirmar expedição e debitar o stock na origem…');
   try{
    const result=await client.transferAction('send',payload);
    pendingTransfer=null;transferLineCount=1;await refresh();view='transfers';render();
    showMessage((result.duplicate?'Transferência já registada. ':'Transferência expedida. ')+
     'Aguardamos confirmação de recepção na outra filial.');
   }catch(error){
    render();showMessage('A expedição pode estar registada. Consulte o histórico antes de repetir; a mesma referência será reutilizada. ('+error.message+')',true);
   }finally{busy=false;}
   return;
  }
  if(action==='csv_import'){
   if(!['owner','manager','stock'].includes(grant.role))return showMessage('Sem permissão para importar artigos.',true);
   if(disconnected())return showMessage('A importação exige ligação à internet.',true);
   if(pending)return void lockPending();
   const input=new FormData(form),file=input.get('csv_file');
   if(!input.has('confirm_import'))return showMessage('Confirme os dados antes da importação.',true);
   busy=true;
   try{
    let payload=pendingCSV;
    if(!payload){
     if(!file||typeof file.text!=='function'||file.size>300000)throw Error('csv_size');
     const content=await file.text();
     const parsed=parseProductCSV(content,(data?.products||[]).map(p=>p.code));
     if(parsed.errors.length)throw Error('Linhas inválidas: '+parsed.errors.slice(0,12).join(', '));
     if(parsed.products.length>100)throw Error('csv_rows_max_100');
     payload={business_id:grant.id,branch_id:branchId,idempotency_key:crypto.randomUUID(),
      items:parsed.products.map(p=>({name:p.name,category:p.category,code:p.code,unit:p.unit,
       price_cents:p.price,min_stock:p.min,stock:p.stock,
       expires_on:p.expiryDate||null,unit_cost_cents:null,lot_number:null}))};
     pendingCSV=payload;
    }
    showMessage('A importar '+payload.items.length+' artigo(s) numa única transacção…');
    const result=await client.importProductsCSV(payload);
    pendingCSV=null;await refresh();view='products';render();
    showMessage((result.duplicate?'Importação já realizada. ':'Importação concluída. ')+
     result.imported_count+' artigo(s) registados.');
   }catch(error){
    showMessage('Importação não confirmada: '+String(error.message||'erro')+
     '. Se o pedido já foi enviado, mantenha a mesma referência antes de tentar novamente.',true);
   }finally{busy=false;}
   return;
  }

  if(action==='photo_upload'){
   if(pending||pendingFinance||disconnected())return showMessage('Conclua operações pendentes e ligue-se à internet antes de enviar fotografias.',true);
   if(!['owner','manager','stock'].includes(grant.role))return showMessage('Sem permissão para alterar fotografias.',true);
   const f=new FormData(form),file=f.get('photo'),productId=String(f.get('product_id')||''),
    expectedRevision=Number(f.get('revision'));
   if(!inventory?.products.some(p=>p.id===productId))return showMessage('Produto não encontrado.',true);
   busy=true;showMessage('');
   try{
    await client.uploadProductPhoto({businessId:grant.id,branchId,productId,expectedRevision,file});
    photoCache.clear();await refresh();render();showMessage('Fotografia guardada. A imagem só está disponível aos utilizadores autorizados.');
   }catch(error){showMessage('Não foi possível guardar a fotografia. Verifique formato, tamanho e versão do produto. ('+error.message+')',true);}
   finally{busy=false;}return;
  }
  if(['product_update','inventory_adjust','inventory_count'].includes(action)){
   if(disconnected()||pending||pendingFinance||pendingPayment)return showMessage('Conclua primeiro as operações pendentes e confirme a ligação.',true);
   const values=new FormData(form),get=k=>String(values.get(k)||'').trim();
   const p=inventory?.products.find(p=>p.id===get('product_id'));
   if(!p)return showMessage('Produto não encontrado.',true);
   const revision=Number(get('revision'));
   let payload;
   try{
    if(action==='product_update'){
     if(!['owner','manager'].includes(grant.role))throw Error('price_permission');
     if(values.has('allow_fractional')&&!allowsFractionalSale({unit:get('unit'),allowFractional:true}))throw Error('A unidade não permite venda fraccionada');
     payload={product_id:p.id,expected_revision:revision,name:get('name'),category:get('category'),
      unit:get('unit'),price_cents:toCents(get('price')),min_stock:Number(get('min_stock')),
      active:values.has('active')};
    }else if(action==='inventory_count'){
     const counted=Number(get('counted_qty'));
     if(!Number.isFinite(counted)||counted<0)throw Error('invalid_count');
     payload={product_id:p.id,expected_revision:revision,counted_qty:counted,reason:get('reason')};
    }else{
     const delta=Number(get('delta'));
     if(!Number.isFinite(delta)||delta===0)throw Error('invalid_adjustment');
     payload={product_id:p.id,expected_revision:revision,delta,reason:get('reason'),
      expires_on:get('expires_on')};
    }
   }catch(error){return showMessage('Reveja o formulário: '+error.message,true);}
   busy=true;showMessage('');
   try{
    const result=await client.inventoryAction(action,cashData(payload));
    if(action==='product_update'&&values.has('allow_fractional')!==allowsFractionalSale(p)){
     try{await client.productFractionUpdate({businessId:grant.id,branchId,productId:p.id,
      allowFractional:values.has('allow_fractional'),expectedRevision:result.revision});}
     catch(error){await refresh();render();showMessage('Os dados do produto foram actualizados, mas a configuração de venda fraccionada não foi guardada. Repita na opção Inventário. ('+error.message+')',true);return;}
    }
    await refresh();render();showMessage('Inventário actualizado. Stock actual: '+String(result.stock||0));
   }catch(error){showMessage('A alteração não foi confirmada. Actualize os dados antes de repetir. ('+error.message+')',true);}
   finally{busy=false;}return;
  }
  if(action==='return_confirm'){
   if(lockPending()||disconnected())return showMessage('A devolução exige ligação ao servidor.',true);
   if(!['owner','manager'].includes(grant.role))return showMessage('Sem permissão para devolver.',true);
   const f=new FormData(form),str=k=>String(f.get(k)||'').trim();
   let payload;
   try{
    const sale=returns?.sales.find(x=>x.id===str('sale_id')&&x.status==='completed');
    if(!sale)throw Error('sale_unavailable');
    const items=[];
    for(let i=0;i<sale.items.length;i++){
     const item=sale.items[i],val=str('qty_'+i);
     if(!val||Number(val)===0)continue;
     const qty=toQuantity(val,item.unit);
     if(qty>item.qty-item.returned)throw Error('return_exceeds_quantity');
     items.push({product_id:item.productId,quantity:qty,
      resellable:f.has('resellable_'+i),expires_on:str('expiry_'+i)});
    }
    if(!items.length)throw Error('return_empty');
    const method=str('method');
    if(!f.has('confirmed')||(method!=='cash'&&!str('reference')))throw Error('refund_not_confirmed');
    if(method==='cash'&&!session())throw Error('cash_not_open');
    payload={sale_id:sale.id,session_id:method==='cash'?session().id:null,
     method,reference:str('reference'),reason:str('reason'),
     manually_confirmed:true,items,idempotency_key:crypto.randomUUID()};
    if(pendingReturn){
     if(pendingReturn.sale_id!==payload.sale_id)throw Error('return_pending');
     payload=pendingReturn;
    }else pendingReturn=payload;
   }catch(error){return showMessage('Confira a devolução: '+String(error.message||''),true);}
   busy=true;showMessage('A confirmar devolução e registar movimentos…');
   try{
    const result=await client.returnAction('return_confirm',cashData(payload));
    pendingReturn=null;await refresh();render();
    showMessage((result.duplicate?'Devolução já registada: ':'Devolução registada: ')+
     (Number(result.amount_cents||0)/100).toFixed(2)+' MT. O reembolso digital, se aplicável, é manual.');
   }catch(error){
    showMessage('Devolução por confirmar. Verifique o histórico antes de repetir; o pedido mantém a mesma referência. ('+error.message+')',true);
   }finally{busy=false;}
   return;
  }
  if(action==='cash_offline_sync'){
   if(disconnected())return showMessage('É necessário ter Internet para sincronizar.',true);
   if(lockPending()||busy)return;
   const pass=String(new FormData(form).get('offline_passphrase')||'');
   const keys=offlineCashKeys(localStorage,scope());
   if(!keys.length)return showMessage('Não há movimentos offline pendentes neste dispositivo.');
   if(!await confirmShop('Sincronizar '+keys.length+' movimento(s)? Cada lançamento mantém a sua referência original.'))return;
   busy=true;showMessage('');
   let done=0;
   try{
    const access=await client.myAccessStatus(grant.id);
    if(!access.allowed)throw Error('cash_access_denied');
    for(const key of keys){
     const payload=await restoreOfflineCash(localStorage,scope(),pass,key);
     // Send exactly the original idempotent request. The server either confirms
     // an already applied movement (even after a remote close), applies it only
     // to an authorised OPEN session, or safely rejects a late new movement.
     const result=await client.holdAction('cash_move',payload);
     if(result?.duplicate!==true&&typeof result?.movement_id!=='string')throw Error('cash_unconfirmed');
     clearOfflineCash(localStorage,scope(),key);done++;
    }
    await refresh();showMessage(done+' movimento(s) sincronizado(s) e confirmado(s).');
   }catch(error){
    pendingCashOffline=offlineCount();render();
    showMessage('Sincronizados '+done+' de '+keys.length+'. Os restantes continuam guardados. ('+error.message+')',true);
   }finally{busy=false;}
   return;
  }
  if(action==='cash_move'){
   if(lockPending())return;
   if(!session())return showMessage('Abra o caixa para registar o movimento.',true);
   const fields=new FormData(form),direction=String(fields.get('direction')||''),reason=String(fields.get('reason')||'').trim();
   if(!fields.has('physical_confirmed'))return showMessage('Confirme a movimentação física do dinheiro.',true);
   const pass=String(fields.get('offline_passphrase')||'');
   let payload;
   try{
    payload=pendingCashMove||cashData({session_id:session().id,direction,reason,
     amount_cents:toCents(fields.get('amount')),idempotency_key:crypto.randomUUID()});
    if(!['in','out'].includes(payload.direction)||payload.amount_cents<=0||payload.reason.length<3||payload.reason.length>180)
     throw Error('cash_movement_invalid');
    pendingCashMove=payload;
   }catch(error){return showMessage('Verifique o valor e motivo. ('+error.message+')',true);}
   if(disconnected()){
    if(pass.length<12)return showMessage('Introduza uma frase de protecção de pelo menos 12 caracteres.',true);
    busy=true;
    try{
     await saveOfflineCash(localStorage,scope(),pass,payload);
     pendingCashMove=null;pendingCashOffline=offlineCount();render();
     showMessage('Movimento guardado encriptado. Não foi somado ao caixa. Sincronize assim que tiver Internet.');
    }catch(error){showMessage('Não foi possível guardar o movimento. ('+error.message+')',true);}
    finally{busy=false;}return;
   }
   busy=true;showMessage('A enviar movimento…');
   try{
    const result=await client.holdAction('cash_move',payload);
    if(result?.duplicate!==true&&typeof result?.movement_id!=='string')throw Error('cash_unconfirmed');
    pendingCashMove=null;await refresh();showMessage('Movimento registado e auditado.');
   }catch(error){
    if(pass.length>=12){
     try{
      await saveOfflineCash(localStorage,scope(),pass,payload);
      pendingCashMove=null;pendingCashOffline=offlineCount();render();
      showMessage('Confirmação incerta. Pedido encriptado com a mesma referência para reenvio seguro.',true);
     }catch{showMessage('Confirmação incerta e gravação offline falhou. Não crie outro pedido.',true);}
    }else showMessage('Movimento por confirmar. Mantenha a referência e confira antes de repetir. ('+error.message+')',true);
   }finally{busy=false;}return;
  }
  if(['supplier_save','purchase_receive','purchase_payment','expense_add','expense_schedule_save'].includes(action)){
   if(lockPending())return;
   if(disconnected())return showMessage('Esta operação exige ligação à internet. Não foi concluída.',true);
   const f=new FormData(form),str=k=>String(f.get(k)||'').trim();
   let payload;
   try{
    if(pendingFinance&&pendingFinance.action!==action)throw Error('pending_finance_operation');
    if(action==='supplier_save'){
     payload={supplier_id:str('supplier_id')||null,name:str('name'),phone:str('phone'),address:str('address')};
     if(str('supplier_id'))payload.active=f.has('active');
    }else if(action==='purchase_receive'){
     const items=[];
     for(let i=0;i<purchaseLines;i++){
      const id=str('product_id_'+i),amount=str('quantity_'+i),cost=str('cost_'+i);
      if(!id)continue;
      const product=data.products.find(p=>p.id===id);
      if(!product)throw Error('product_unavailable');
      items.push({product_id:id,quantity:toQuantity(amount,product.unit),
       unit_cost_cents:toCents(cost),lot_number:str('lot_'+i),expires_on:str('expiry_'+i)});
     }
     if(!items.length)throw Error('purchase_items_missing');
     payload={supplier_id:str('supplier_id'),items,invoice_ref:str('invoice_ref'),
      due_on:str('due_on'),idempotency_key:crypto.randomUUID()};
    }else if(action==='purchase_payment'){
     const p=finance?.purchases.find(x=>x.id===str('purchase_id'));
     if(!p)throw Error('purchase_missing');
     const amount=toCents(str('amount')),method=str('method'),reference=str('reference');
     if(amount<=0||amount>p.balance||!f.has('confirmed')||(method!=='cash'&&!reference))throw Error('payment_invalid');
     if(method==='cash'&&!session())throw Error('cash_not_open');
     payload={purchase_id:p.id,amount_cents:amount,method,reference,
      session_id:method==='cash'?session().id:null,manual_confirmed:true,idempotency_key:crypto.randomUUID()};
    }else if(action==='expense_add'){
     const amount=toCents(str('amount')),method=str('method'),reference=str('reference');
     if(amount<=0||!f.has('confirmed')||(method!=='cash'&&!reference))throw Error('expense_invalid');
     if(method==='cash'&&!session())throw Error('cash_not_open');
     payload={label:str('label'),category:str('category'),amount_cents:amount,
      method,reference,session_id:method==='cash'?session().id:null,
      manual_confirmed:true,idempotency_key:crypto.randomUUID()};
    }else{
     payload={label:str('label'),category:str('category'),amount_cents:toCents(str('amount')),
      repeat_months:Number(str('repeat_months')),next_due_on:str('next_due_on')};
    }
    if(pendingFinance)payload=pendingFinance.payload;
    else if(['purchase_receive','purchase_payment','expense_add'].includes(action))
     pendingFinance={action,payload};
   }catch(error){return showMessage('Reveja o formulário ou a operação pendente: '+error.message,true);}
   busy=true;showMessage('');
   try{
    const result=await client.financeAction(action,{business_id:grant.id,branch_id:branchId,...payload});
    if(pendingFinance?.action===action)pendingFinance=null;
    await refresh();render();
    showMessage(action==='purchase_receive'?'Compra registada e stock recebido: '+String(result.purchase_id||'').slice(0,8):
     action==='purchase_payment'?'Pagamento ao fornecedor lançado.':
     action==='expense_add'?'Despesa registada no livro e no caixa quando aplicável.':
     action==='expense_schedule_save'?'Lembrete de despesa recorrente guardado.':'Fornecedor actualizado.');
   }catch(error){
    showMessage('A operação pode estar pendente ou foi rejeitada. Confira os registos antes de repetir. '+String(error.message||''),true);
   }finally{busy=false;}
   return;
  }
  if(['customer_save','credit_policy','debt_payment'].includes(action)){
   if(lockPending())return;
   if(disconnected())return showMessage('Sem internet não é possível gerir clientes ou dívidas.',true);
   const values=new FormData(form);
   const value=k=>String(values.get(k)||'').trim();
   let payload;
   try{
    if(action==='customer_save'){
     payload={customer_id:value('customer_id')||null,name:value('name'),phone:value('phone'),note:value('note')};
     if(value('customer_id'))payload.active=values.has('active');
    }else if(action==='credit_policy'){
     payload={customer_id:value('customer_id'),credit_limit_cents:toCents(value('credit_limit')),
      credit_blocked:values.has('credit_blocked'),expected_revision:Number(value('expected_revision')),reason:value('reason')};
    }else{
     if(!session())throw Error('cash_not_open');
     const debt=credit?.debts.find(d=>d.id===value('debt_id'));
     if(!debt)throw Error('debt_not_found');
     if(pendingPayment&&pendingPayment.debt_id!==debt.id)throw Error('pending_collection');
     payload=pendingPayment||makeDebtPaymentRequest({businessId:grant.id,branchId,sessionId:session().id,
      debt,amount:value('amount'),method:value('method'),reference:value('reference'),
      confirmed:values.has('confirmed'),idempotencyKey:crypto.randomUUID()});
     pendingPayment=payload;
    }
   }catch(error){return showMessage('Verifique os dados da operação: '+error.message,true);}
   busy=true;showMessage('');
   try{
    const result=await client.merchantAction(action,{business_id:grant.id,branch_id:branchId,...payload});
    if(action==='debt_payment')pendingPayment=null;
    await refresh();if(action==='customer_save')selectedCustomerId=result.customer_id;
    render();showMessage(action==='debt_payment'?'Cobrança registada e reconciliada com o caixa.':'Dados actualizados com sucesso.');
   }catch(error){
    showMessage(action==='debt_payment'?'Cobrança por confirmar. Não altere o pedido nem o repita com outra referência; confira o histórico ou reenvie o mesmo pedido.':'O servidor rejeitou a operação: '+error.message,true);
   }finally{busy=false;}
   return;
  }
  if(action==='team_invite'){
   if(grant.role!=='owner')return showMessage('Apenas o proprietário pode criar colaboradores.',true);
   if(disconnected())return showMessage('Precisa de ligação à internet para criar o acesso.',true);
   if(pending)return void lockPending();
   const fields=new FormData(form);
   const name=String(fields.get('name')||'').trim();
   const email=String(fields.get('email')||'').trim();
   const role=String(fields.get('role')||'');
   busy=true;showMessage('A criar o acesso do colaborador…');
   try{
    const result=await client.provisionShopStaff({businessId:grant.id,name,email,role});
    showProntoCredentials(result);
    form.reset();
    try{await refresh();}catch{/* Credentials are already displayed; avoid retrying creation. */}
    showMessage('Conta criada. Copie as credenciais antes de fechar a janela.');
   }catch(error){
    const messages={account_exists:'Este email já tem uma conta. Contacte o suporte para a associar.',
     association_failed:'A conta não foi associada. Confirme o estado antes de repetir.',
     provision_partial_contact_support:'O registo ficou incompleto. Contacte o suporte antes de repetir.',
     account_unavailable:'Não foi possível criar o acesso. Verifique a ligação.',
     not_authorized:'Não tem autorização para esta operação.',
     supabase_unauthorized:'Sessão expirada. Saia e volte a entrar.'};
    showMessage(messages[error.message]||'Não foi possível criar o colaborador.',true);
   }finally{busy=false;}
   return;
  }
  if(action==='draft_save'||action==='draft_restore'){
   const password=String(new FormData(form).get('passphrase')||'');
   if(password.length<12)return showMessage('A frase de recuperação deve ter pelo menos 12 caracteres.',true);
   busy=true;
   try{
    if(action==='draft_save'){
     if(!cart.length&&!pending)throw Error('draft_payload');
     if(hasShopDraft(localStorage,scope())&&!await confirmShop('Já existe um rascunho nesta loja e neste dispositivo. Deseja substituí-lo?'))return;
     const draft=makeShopDraft({scope:scope(),cart,method,discount,pending});
     await saveShopDraft(localStorage,scope(),password,draft);
     render();showMessage('Rascunho encriptado guardado neste dispositivo. Não foi registada nenhuma venda.');
    }else{
     if(pending)throw Error('pending_checkout');
     if(cart.length&&!await confirmShop('O carrinho actual será substituído pelo rascunho. Continuar?'))return;
     const restored=await restoreShopDraft(localStorage,scope(),password);
     cart=restored.cart.map(item=>({...item}));
     method=restored.method;discount=restored.discount;pending=restored.pending;
     view='sell';render();
     showMessage(pending?'Pedido pendente recuperado com a mesma chave. Confira no histórico e use «Repetir o mesmo pedido»; não crie outra venda.':
      'Carrinho recuperado. O stock e os preços serão novamente verificados ao concluir.');
    }
   }catch(e){showMessage(e.message==='pending_checkout'?'Resolva o pedido pendente antes de recuperar outro.':
    'Não foi possível guardar ou recuperar o rascunho. Confirme a frase, o dispositivo e a loja.',true);
   }finally{busy=false;}
   return;
  }
  if(action==='cash_close'&&offlineCount()>0)return showMessage('Sincronize os movimentos pendentes antes do fecho definitivo.',true);
  if(pending)return void lockPending();
  if(disconnected())return showMessage('Sem ligação: não é possível abrir/fechar o caixa ou alterar stock. Guarde um rascunho e aguarde a ligação.',true);
  const f=new FormData(form);
  try{
   let payload;
   if(action==='product_create'){
    if(f.has('allow_fractional')&&!allowsFractionalSale({unit:String(f.get('unit')),allowFractional:true}))throw Error('Esta unidade não permite venda fraccionada.');
    payload={name:String(f.get('name')||'').trim(),
    category:String(f.get('category')||'').trim(),unit:String(f.get('unit')||'un'),
    price_cents:toCents(f.get('price')),code:String(f.get('code')||'').trim(),
    min_stock:String(f.get('min_stock')||'0'),allow_fractional:f.has('allow_fractional')};
   }
   else if(action==='stock_receive')payload={product_id:String(f.get('product_id')||''),
    quantity:toQuantity(f.get('quantity'),data.products.find(p=>p.id===f.get('product_id'))?.unit),
    lot_number:String(f.get('lot_number')||'').trim(),expires_on:String(f.get('expires_on')||''),
    unit_cost_cents:f.get('unit_cost')?toCents(f.get('unit_cost')):null};
   else if(action==='cash_open'){
    payload={device_id:String(f.get('device_id')||'').trim(),
     opening_cash_cents:toCents(f.get('opening_cash'))};
    if(!await confirmShop('Abrir o caixa com fundo inicial de '+(payload.opening_cash_cents/100).toFixed(2)+' MT?'))return;
   }
   else if(action==='cash_close'){
    const target=cashState?.sessions.find(s=>s.operatorId===account.userId&&s.status==='pending')||session();
    if(!target)return showMessage('Solicite primeiro o fecho da sessão.',true);
    payload={session_id:target.id,counted_cash_cents:toCents(f.get('counted_cash'))};
    if(!await confirmShop('Confirmar contagem de '+(payload.counted_cash_cents/100).toFixed(2)+' MT? Não poderá alterá-la depois.'))return;
   }
   else return;
   await execute(action,payload);
  }catch(e){showMessage('Confira os dados introduzidos. '+String(e.message||''),true);}
 },{signal});
 window.addEventListener('offline',()=>showMessage('Sem internet: as vendas não podem ser concluídas. Guarde um rascunho encriptado e recupere-o depois de entrar novamente com ligação.',true),{signal});
 window.addEventListener('online',()=>showMessage('Ligação restabelecida. Sincronize os movimentos offline pendentes em Caixa, se existirem.'),{signal});
 root.innerHTML='<main class="shop-loading" aria-hidden="true"></main>';
 if(await checkStaffAccess())await safeLoad(true);
}

import {renderShopScreen,shopPaymentPanel} from './supabase-shop-ui.js';
import {toCents,toQuantity,makeSaleRequest,cartTotal,esc} from './supabase-shop-core.js';
import {makeCreditSaleRequest,makeDebtPaymentRequest,searchCustomers} from './supabase-credit-core.js';
import {creditStatementHTML,creditWhatsAppURL} from './supabase-credit-ui.js';
import {shoppingListCSV} from './supabase-inventory-ui.js';
import {reportsCSV} from './supabase-reports-ui.js';
const maputoDate=(time=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
import {makeShopDraft,saveShopDraft,restoreShopDraft,hasShopDraft,clearShopDraft} from './supabase-shop-draft.js';

// Explicit, isolated PostgreSQL checkout pilot. The existing SQLite POS is untouched.
export async function mountSupabaseMerchantPilot({root,client,account,onLogout}){
 if(!account?.grants?.length||account.ubuntuAdmin)throw Error('shop_access_required');
 const aborter=new AbortController(),signal=aborter.signal;
 let grant=account.grants[0],branches=[],branchId='',data=null,cart=[],
  view=['owner','manager','cashier'].includes(account.grants[0].role)?'sell':
   account.grants[0].role==='stock'?'products':'history',
  method='cash',discount='0',query='',notice='',busy=false,pending=null,
  credit=null,selectedCustomerId='',customerQuery='',debtFilter='open',creditDue='',pendingPayment=null,
  finance=null,supplierId='',purchaseLines=1,pendingFinance=null,heldSales=[],resumedHoldId=null,holdIdToSave=null,returns=null,selectedReturnSaleId='',pendingReturn=null,pendingCashMove=null,inventory=null,selectedProductId='',alertDays=30,inventoryQuery='',report=null,reportFrom=maputoDate(new Date(Date.now()-29*86400000)),reportTo=maputoDate(),reportScope='branch';
 const scope=()=>({userId:account.userId,businessId:grant.id,branchId});
 const authorizedView=target=>({sell:['owner','manager','cashier'],products:['owner','manager','stock'],cash:['owner','manager','cashier'],history:['owner','manager','cashier','finance'],customers:['owner','manager','cashier','finance'],debts:['owner','manager','cashier','finance'],suppliers:['owner','manager','stock','finance'],purchases:['owner','manager','stock','finance'],expenses:['owner','manager','finance'],held:['owner','manager','cashier'],returns:['owner','manager'],inventory:['owner','manager','stock','finance'],alerts:['owner','manager','stock','finance'],shopping_list:['owner','manager','stock','finance'],reports:['owner','manager','cashier','finance'],team:['owner']})[target]?.includes(grant.role)===true;
 const disconnected=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
 const leave=async()=>{
  aborter.abort();root.innerHTML='';
  try{await client.signOut();}finally{onLogout();}
 };
 const showMessage=(text,warning=false)=>{
  notice=text;
  const el=root.querySelector('#shop-message');
  if(el){el.textContent=text;el.classList.toggle('shop-error',warning);}
 };
 const session=()=>data?.sessions.find(s=>s.operatorId===account.userId)||null;
 const render=()=>{
  if(!data)return;
  root.innerHTML=renderShopScreen({account,grants:account.grants,grant,branches,branchId,data,cart,view,method,discount,query,feedback:notice,pending,
   draftAvailable:hasShopDraft(localStorage,scope()),credit,selectedCustomerId,customerQuery,debtFilter,creditDue,finance,supplierId,purchaseLines,pendingFinance,heldSales,returns,selectedReturnSaleId,inventory,selectedProductId,alertDays,inventoryQuery,report,reportFrom,reportTo,reportScope});
 };
 const refresh=async(selectFirst=false)=>{
  if(selectFirst){
   branches=await client.merchantBranches(grant.id);
   if(!branches.length)throw Error('shop_no_branch');
   branchId=branches[0].id;cart=[];pending=null;method='cash';discount='0';query='';credit=null;selectedCustomerId='';customerQuery='';debtFilter='open';creditDue='';finance=null;supplierId='';purchaseLines=1;heldSales=[];resumedHoldId=null;holdIdToSave=null;returns=null;selectedReturnSaleId='';inventory=null;selectedProductId='';inventoryQuery='';report=null;reportScope='branch';
   view=['owner','manager','cashier'].includes(grant.role)?'sell':grant.role==='stock'?'products':'history';
  }
  data=await client.merchantSnapshot(grant.id,branchId);
  credit=typeof client.creditSnapshot==='function'?await client.creditSnapshot(grant.id,branchId):null;
  finance=typeof client.financeSnapshot==='function'?await client.financeSnapshot(grant.id,branchId):null;
  heldSales=typeof client.holdList==='function'&&['owner','manager','cashier'].includes(grant.role)?await client.holdList(grant.id,branchId):[];
  returns=typeof client.returnSnapshot==='function'&&['owner','manager'].includes(grant.role)?await client.returnSnapshot(grant.id,branchId):null;
  inventory=typeof client.inventorySnapshot==='function'&&['owner','manager','stock','finance'].includes(grant.role)?await client.inventorySnapshot(grant.id,branchId):null;
  if(credit&&selectedCustomerId&&!credit.customers.some(c=>c.id===selectedCustomerId&&c.active))selectedCustomerId='';
  render();
 };
 const safeLoad=async(first=false)=>{
  if(busy)return;busy=true;
  try{await refresh(first);showMessage('Dados sincronizados com o Supabase.');}
  catch(e){
   if(e.message==='supabase_unauthorized'||e.message==='shop_access_required'){
    await leave();return;
   }
   showMessage('Não foi possível carregar dados da loja. Confirme a licença e a ligação à internet.',true);
  }finally{busy=false;}
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
 const updatePanel=()=>{
  const panel=root.querySelector('#shop-checkout-panel');
  if(panel&&data)panel.outerHTML=shopPaymentPanel({method,cart,products:data.products,discount,session:session(),role:grant.role,credit,selectedCustomerId,creditDue});
 };
 const cashData=fields=>({business_id:grant.id,branch_id:branchId,...fields});
 const processSale=async()=>{
  if(!pending)return;
  if(disconnected()){showMessage('Sem internet: a venda não foi concluída. Guarde o rascunho encriptado e volte a tentar depois de restabelecer a ligação.',true);return;}
  busy=true;showMessage('A verificar e registar a venda no servidor…');
  try{
   const result=await client.merchantAction(pending.due_on?'credit_sale':'sale_complete',pending);
   const wasRepeated=result.duplicate===true;
   if(resumedHoldId&&typeof client.holdAction==='function'){
    try{await client.holdAction('hold_delete',cashData({hold_id:resumedHoldId}));resumedHoldId=null;}
    catch{/* Sale was committed; the held cart may require manual removal. */}
   }
   cart=[];pending=null;discount='0';method='cash';query='';creditDue='';
   try{await refresh();}catch{render();}
   showMessage((wasRepeated?'Venda anteriormente registada, sem duplicação. ':result.debt_id?'Venda a crédito registada. ':'Venda concluída. ')+
    'Referência: '+String(result.sale_id||'').slice(0,8)+'.');
  }catch(e){
   showMessage('Venda ainda sem confirmação. Verifique a sessão e clique em «Repetir o mesmo pedido» para evitar duplicações. ('+String(e.message||'erro')+')',true);
   render();
  }finally{busy=false;}
 };
 const execute=async(action,payload)=>{
  if(busy)return;
  if(disconnected())return showMessage('Sem ligação à internet. Esta operação não foi enviada ao Supabase.',true);
  busy=true;showMessage('A registar informação no Supabase…');
  try{
   const result=await client.merchantAction(action,cashData(payload));
   await refresh();
   if(action==='product_create')view='products';
   if(action==='customer_save')view='customers';
   if(action==='debt_payment')view='debts';
   render();
   const summary=action==='product_create'?'Produto criado com código '+result.code:
    action==='stock_receive'?'Stock recebido e registado por lote.':
    action==='cash_open'?'Sessão de caixa aberta.':
    action==='cash_close'?'Caixa fechado. Esperado: '+(Number(result.expected_cents)/100).toFixed(2)+' MT; diferença: '+(Number(result.difference_cents)/100).toFixed(2)+' MT.':
    action==='customer_save'?'Cliente guardado no Supabase.':
    action==='credit_policy'?'Limite de crédito actualizado com auditoria.':
    action==='debt_payment'?'Pagamento da dívida confirmado no Supabase.':
    'Operação realizada.';
   showMessage(summary);
  }catch(e){
   if(['supabase_unauthorized','shop_access_required'].includes(e.message)){await leave();return;}
   showMessage('Operação rejeitada ou sem confirmação. Verifique os dados antes de tentar novamente. ('+String(e.message||'erro')+')',true);
  }finally{busy=false;}
 };
 root.addEventListener('click',event=>{
  const el=event.target.closest('button');
  if(!el||busy||signal.aborted)return;
  if(el.hasAttribute('data-shop-logout'))return void leave();
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
   if(confirm('Já verificou se a operação foi registada no Supabase? Descartar uma tentativa NÃO reverte lançamentos existentes.')){pendingFinance=null;showMessage('Referência local descartada. Confirme o histórico antes de repetir.');}
   return;
  }
  if(el.hasAttribute('data-credit-customer')){selectedCustomerId=el.dataset.creditCustomer;render();return;}
  if(el.hasAttribute('data-credit-receipt')||el.hasAttribute('data-credit-statement')){
   if(!credit)return;
   try{const debtId=el.dataset.creditReceipt;
    const customerId=debtId?credit.debts.find(d=>d.id===debtId)?.customerId:el.dataset.creditStatement;
    const html=creditStatementHTML(credit,customerId,{debtId});
    const win=window.open('','_blank');if(!win){showMessage('Autorize a janela de impressão.',true);return;}
    win.document.write(html);win.document.close();win.focus();win.print();
   }catch{showMessage('Não foi possível gerar o extracto.',true);}return;
  }
  if(el.hasAttribute('data-credit-whatsapp')){
   try{window.open(creditWhatsAppURL(credit,el.dataset.creditWhatsapp),'_blank','noopener,noreferrer');}
   catch{showMessage('Verifique o telefone do cliente.',true);}return;
  }
  if(el.hasAttribute('data-shop-credit')){if(lockPending())return;method=method==='credit'?'cash':'credit';updatePanel();return;}
  if(el.hasAttribute('data-shop-refresh'))return void safeLoad();
  if(el.hasAttribute('data-inventory-select')){selectedProductId=el.dataset.inventorySelect;render();return;}
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
   if(cart.length&&!confirm('Substituir o carrinho actual por esta venda em espera?'))return;
   cart=held.cart.map(x=>({productId:x.productId,quantity:x.quantity}));
   selectedCustomerId=held.customerId||'';resumedHoldId=held.id;method='cash';discount='0';view='sell';render();
   showMessage('Venda retomada. O stock e os preços serão verificados novamente ao concluir.');return;
  }
  if(el.hasAttribute('data-shop-hold-delete')){
   if(!confirm('Eliminar este carrinho em espera? Não existe venda concluída a cancelar.'))return;
   busy=true;void(async()=>{
    try{await client.holdAction('hold_delete',cashData({hold_id:el.dataset.shopHoldDelete}));
     await refresh();showMessage('Carrinho em espera eliminado.');}
    catch{showMessage('Não foi possível remover o carrinho.',true);}
    finally{busy=false;}
   })();return;
  }

  if(el.hasAttribute('data-shop-draft-clear')){
   if(confirm('Apagar o rascunho encriptado deste dispositivo? Isto não cancela vendas já registadas no Supabase.')){
    clearShopDraft(localStorage,scope());render();showMessage('Rascunho local apagado.');
   }return;
  }
  if(el.hasAttribute('data-shop-add'))return void add(el.dataset.shopAdd);
  if(el.hasAttribute('data-remove')){
   if(lockPending())return;
   cart=cart.filter(x=>x.productId!==el.dataset.remove);render();return;
  }
  if(el.hasAttribute('data-qty'))return void add(el.dataset.id,Number(el.dataset.qty));
  if(el.hasAttribute('data-shop-view')){if(!authorizedView(el.dataset.shopView))return;view=el.dataset.shopView;notice='';render();return;}
  if(el.hasAttribute('data-shop-method')){if(lockPending())return;method=el.dataset.shopMethod;updatePanel();return;}
  if(el.hasAttribute('data-shop-retry'))return void processSale();
  if(el.hasAttribute('data-shop-discard')){
   if(confirm('Verificou no histórico e no caixa se esta venda foi ou não concluída? Descartar o pedido pendente não anula uma venda já gravada.')){
    pending=null;showMessage('Pedido pendente descartado. Confira o histórico antes de uma nova venda.');render();
   }
  }
 },{signal});
 root.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='shop-search'){
   query=el.value;
   root.querySelectorAll('[data-shop-add]').forEach(button=>{
    const p=data?.products.find(x=>x.id===button.dataset.shopAdd);
    const card=button.closest('.shop-product');
    if(p&&card)card.hidden=!(p.name+' '+p.code).toLocaleLowerCase().includes(query.toLocaleLowerCase());
   });
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
  }
 },{signal});
 root.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='shop-business-select'){
   const next=account.grants.find(x=>x.id===el.value);
   if(!next||busy)return;
   if(pending)return showMessage('Resolva a venda pendente antes de mudar de empresa.',true);
   grant=next;void safeLoad(true);return;
  }
  if(el.id==='shop-branch-select'){
   if(pending)return showMessage('Resolva a venda pendente antes de mudar de filial.',true);
   if(!branches.some(b=>b.id===el.value))return;
   branchId=el.value;cart=[];method='cash';discount='0';query='';void safeLoad();return;
  }
  if(el.id==='shop-sale-customer'){if(lockPending())return;selectedCustomerId=el.value;updatePanel();return;}
  if(el.id==='shop-credit-due'){creditDue=el.value;return;}
  if(el.id==='shop-debt-filter'){debtFilter=el.value;render();return;}
  if(el.id==='shop-return-sale'){selectedReturnSaleId=el.value;render();return;}
  if(el.id==='shop-alert-days'){alertDays=Math.max(1,Math.min(365,Number(el.value)||30));render();return;}
  if(el.name==='discount'){if(!lockPending())updatePanel();return;}
  if(el.hasAttribute('data-cart-qty')){
   if(lockPending())return;
   const p=data.products.find(x=>x.id===el.dataset.cartQty),line=cart.find(x=>x.productId===el.dataset.cartQty);
   if(!p||!line)return;
   try{
    const next=toQuantity(el.value,p.unit);
    if(next>p.stock)throw Error('stock_unavailable');
    line.quantity=next;render();
   }catch{showMessage('Quantidade inválida ou superior ao stock.',true);el.value=String(line.quantity);}
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
  if(!(form instanceof HTMLFormElement)||busy)return;
  event.preventDefault();
  if(form.id==='shop-sale-form'){
   if(lockPending())return;
   const shift=session();
   if(!shift)return showMessage('Abra a sua sessão de caixa para vender.',true);
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
     pending=makeCreditSaleRequest({businessId:grant.id,branchId,sessionId:shift.id,
      cart,customer,dueOn:creditDue,today:credit.today,outstanding,total:tempTotal,
      discount:disc,idempotencyKey:idem});
     await processSale();return;
    }
    const allocations=method==='mixed'?['cash','mpesa','emola','transfer'].map(m=>({
     method:m,amount:String(f.get('pay_'+m)||'0')
    })).filter(p=>toCents(p.amount)>0):[{method,amount:totalText}];
    if(allocations.some(x=>x.method!=='cash')&&f.get('confirmed')!=='yes')throw Error('digital_unconfirmed');
    pending=makeSaleRequest({businessId:grant.id,branchId,sessionId:shift.id,
     cart,products:data.products,discount:disc,allocations,idempotencyKey:idem,
     cashReceived:String(f.get('cash_received')||'0')});
    if(selectedCustomerId)pending.customer_id=selectedCustomerId;
    await processSale();
   }catch(e){
    pending=null;
    showMessage({
     digital_unconfirmed:'Confirme o recebimento digital antes de concluir.',
     payment_mismatch:'Os pagamentos devem somar exactamente o valor total.',
     stock_unavailable:'O stock já não é suficiente.',
     cash_short:'O dinheiro recebido é inferior ao montante devido.'
    }[e.message]||'Corrija os valores e as quantidades antes de concluir. ('+e.message+')',true);
   }
   return;
  }
  const action=form.dataset.shopForm;
  if(!action)return;
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
   busy=true;showMessage('A validar quantidades e permissões no Supabase…');
   try{
    const result=await client.inventoryAction(action,cashData(payload));
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
  if(action==='cash_move'){
   if(lockPending()||disconnected())return showMessage('Sem ligação para registar movimento.',true);
   if(!session())return showMessage('Abra o caixa para registar o movimento.',true);
   const f=new FormData(form),direction=String(f.get('direction')||''),reason=String(f.get('reason')||'').trim();
   let payload;try{payload=pendingCashMove||{session_id:session().id,direction,reason,
    amount_cents:toCents(f.get('amount')),idempotency_key:crypto.randomUUID()};
    pendingCashMove=payload;}
   catch(error){return showMessage('Verifique o valor e motivo: '+error.message,true);}
   busy=true;
   try{await client.holdAction('cash_move',cashData(payload));pendingCashMove=null;await refresh();
    showMessage('Movimento de caixa registado e auditado.');}
   catch{showMessage('Movimento por confirmar: confira o caixa antes de repetir. Não lance novamente sem verificar.',true);}
   finally{busy=false;}
   return;
  }
  if(['supplier_save','purchase_receive','purchase_payment','expense_add','expense_schedule_save'].includes(action)){
   if(lockPending())return;
   if(disconnected())return showMessage('Esta operação exige ligação ao Supabase. Não foi lançada.',true);
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
   busy=true;showMessage('A registar operação no Supabase…');
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
   busy=true;showMessage('A guardar no Supabase…');
   try{
    const result=await client.merchantAction(action,{business_id:grant.id,branch_id:branchId,...payload});
    if(action==='debt_payment')pendingPayment=null;
    await refresh();if(action==='customer_save')selectedCustomerId=result.customer_id;
    render();showMessage(action==='debt_payment'?'Cobrança registada e reconciliada com o caixa.':'Dados actualizados no Supabase.');
   }catch(error){
    showMessage(action==='debt_payment'?'Cobrança por confirmar. Não altere o pedido nem o repita com outra referência; confira o histórico ou reenvie o mesmo pedido.':'O servidor rejeitou a operação: '+error.message,true);
   }finally{busy=false;}
   return;
  }
  if(action==='team_invite'){
   if(grant.role!=='owner')return showMessage('Apenas o proprietário pode convidar colaboradores.',true);
   if(disconnected())return showMessage('Sem internet não é possível enviar convites.',true);
   if(pending)return void lockPending();
   const fields=new FormData(form);
   const name=String(fields.get('name')||'').trim();
   const email=String(fields.get('email')||'').trim();
   const role=String(fields.get('role')||'');
   busy=true;showMessage('A verificar permissões e enviar convite…');
   try{
    const result=await client.inviteShopStaff({businessId:grant.id,name,email,role});
    form.reset();
    showMessage(result?.ok===true?
      'Convite enviado. O colaborador deverá aceitar, autenticar-se e criar o seu próprio PIN de cinco dígitos.':
      'Pedido recebido. Verifique o convite no Supabase.');
   }catch(error){
    const messages={staff_exists:'Esta conta já existe. Peça à Ubuntu Service para associar a conta actual.',
     staff_invited_not_linked:'O convite foi enviado mas a associação falhou. Peça apoio à Ubuntu Service antes de reenviar.',
     staff_invite_unavailable:'Não foi possível enviar o convite. Confirme a ligação e o envio de emails.',
     supabase_unauthorized:'Sessão ou autorização expirada. Saia e volte a entrar.'};
    showMessage(messages[error.message]||'Não foi possível convidar o colaborador.',true);
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
     if(hasShopDraft(localStorage,scope())&&!confirm('Já existe um rascunho nesta loja e neste dispositivo. Deseja substituí-lo?'))return;
     const draft=makeShopDraft({scope:scope(),cart,method,discount,pending});
     await saveShopDraft(localStorage,scope(),password,draft);
     render();showMessage('Rascunho encriptado guardado neste dispositivo. Não foi registada nenhuma venda.');
    }else{
     if(pending)throw Error('pending_checkout');
     if(cart.length&&!confirm('O carrinho actual será substituído pelo rascunho. Continuar?'))return;
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
  if(pending)return void lockPending();
  if(disconnected())return showMessage('Sem ligação: não é possível abrir/fechar o caixa ou alterar stock. Guarde um rascunho e aguarde a ligação.',true);
  const f=new FormData(form);
  try{
   let payload;
   if(action==='product_create')payload={name:String(f.get('name')||'').trim(),
    category:String(f.get('category')||'').trim(),unit:String(f.get('unit')||'un'),
    price_cents:toCents(f.get('price')),code:String(f.get('code')||'').trim(),
    min_stock:String(f.get('min_stock')||'0')};
   else if(action==='stock_receive')payload={product_id:String(f.get('product_id')||''),
    quantity:toQuantity(f.get('quantity'),data.products.find(p=>p.id===f.get('product_id'))?.unit),
    lot_number:String(f.get('lot_number')||'').trim(),expires_on:String(f.get('expires_on')||''),
    unit_cost_cents:f.get('unit_cost')?toCents(f.get('unit_cost')):null};
   else if(action==='cash_open')payload={device_id:String(f.get('device_id')||'').trim(),
    opening_cash_cents:toCents(f.get('opening_cash'))};
   else if(action==='cash_close')payload={session_id:session()?.id,
    counted_cash_cents:toCents(f.get('counted_cash'))};
   else return;
   await execute(action,payload);
  }catch(e){showMessage('Confira os dados introduzidos. '+String(e.message||''),true);}
 },{signal});
 window.addEventListener('offline',()=>showMessage('Sem internet: as vendas não podem ser concluídas. Guarde um rascunho encriptado e recupere-o depois de entrar novamente com ligação.',true),{signal});
 window.addEventListener('online',()=>showMessage('Ligação restabelecida. Confira o stock actualizado antes de concluir.'),{signal});
 root.innerHTML='<main class="shop-loading">A consultar filiais e permissões reais no Supabase…</main>';
 await safeLoad(true);
}

import {renderShopScreen,shopPaymentPanel} from './supabase-shop-ui.js';
import {toCents,toQuantity,makeSaleRequest,cartTotal,esc} from './supabase-shop-core.js';
import {makeCreditSaleRequest,makeDebtPaymentRequest,searchCustomers} from './supabase-credit-core.js';
import {creditStatementHTML,creditWhatsAppURL} from './supabase-credit-ui.js';
import {makeShopDraft,saveShopDraft,restoreShopDraft,hasShopDraft,clearShopDraft} from './supabase-shop-draft.js';

// Explicit, isolated PostgreSQL checkout pilot. The existing SQLite POS is untouched.
export async function mountSupabaseMerchantPilot({root,client,account,onLogout}){
 if(!account?.grants?.length||account.ubuntuAdmin)throw Error('shop_access_required');
 const aborter=new AbortController(),signal=aborter.signal;
 let grant=account.grants[0],branches=[],branchId='',data=null,cart=[],
  view=['owner','manager','cashier'].includes(account.grants[0].role)?'sell':
   account.grants[0].role==='stock'?'products':'history',
  method='cash',discount='0',query='',notice='',busy=false,pending=null,
  credit=null,selectedCustomerId='',customerQuery='',debtFilter='open',creditDue='',pendingPayment=null;
 const scope=()=>({userId:account.userId,businessId:grant.id,branchId});
 const authorizedView=target=>({sell:['owner','manager','cashier'],products:['owner','manager','stock'],cash:['owner','manager','cashier'],history:['owner','manager','cashier','finance'],customers:['owner','manager','cashier','finance'],debts:['owner','manager','cashier','finance'],team:['owner']})[target]?.includes(grant.role)===true;
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
   draftAvailable:hasShopDraft(localStorage,scope()),credit,selectedCustomerId,customerQuery,debtFilter,creditDue});
 };
 const refresh=async(selectFirst=false)=>{
  if(selectFirst){
   branches=await client.merchantBranches(grant.id);
   if(!branches.length)throw Error('shop_no_branch');
   branchId=branches[0].id;cart=[];pending=null;method='cash';discount='0';query='';credit=null;selectedCustomerId='';customerQuery='';debtFilter='open';creditDue='';
   view=['owner','manager','cashier'].includes(grant.role)?'sell':grant.role==='stock'?'products':'history';
  }
  data=await client.merchantSnapshot(grant.id,branchId);
  credit=typeof client.creditSnapshot==='function'?await client.creditSnapshot(grant.id,branchId):null;
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

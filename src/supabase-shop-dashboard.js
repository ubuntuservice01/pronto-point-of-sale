import {renderShopScreen,shopPaymentPanel} from './supabase-shop-ui.js';
import {toCents,toQuantity,makeSaleRequest,esc} from './supabase-shop-core.js';

// Explicit, isolated PostgreSQL checkout pilot. The existing SQLite POS is untouched.
export async function mountSupabaseMerchantPilot({root,client,account,onLogout}){
 if(!account?.grants?.length||account.ubuntuAdmin)throw Error('shop_access_required');
 const aborter=new AbortController(),signal=aborter.signal;
 let grant=account.grants[0],branches=[],branchId='',data=null,cart=[],
  view='sell',method='cash',discount='0',query='',notice='',busy=false,pending=null;
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
  root.innerHTML=renderShopScreen({account,grants:account.grants,grant,branches,branchId,data,cart,view,method,discount,query,feedback:notice,pending});
 };
 const refresh=async(selectFirst=false)=>{
  if(selectFirst){
   branches=await client.merchantBranches(grant.id);
   if(!branches.length)throw Error('shop_no_branch');
   branchId=branches[0].id;cart=[];pending=null;method='cash';discount='0';query='';
  }
  data=await client.merchantSnapshot(grant.id,branchId);
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
  if(panel&&data)panel.outerHTML=shopPaymentPanel({method,cart,products:data.products,discount,session:session()});
 };
 const cashData=fields=>({business_id:grant.id,branch_id:branchId,...fields});
 const processSale=async()=>{
  if(!pending)return;
  busy=true;showMessage('A verificar e registar a venda no servidor…');
  try{
   const result=await client.merchantAction('sale_complete',pending);
   const wasRepeated=result.duplicate===true;
   cart=[];pending=null;discount='0';method='cash';query='';
   await refresh();
   showMessage((wasRepeated?'Venda anteriormente registada, sem duplicação. ':'Venda concluída. ')+
    'Referência: '+String(result.sale_id||'').slice(0,8)+'.');
  }catch(e){
   showMessage('Venda ainda sem confirmação. Verifique a sessão e clique em «Repetir o mesmo pedido» para evitar duplicações. ('+String(e.message||'erro')+')',true);
   render();
  }finally{busy=false;}
 };
 const execute=async(action,payload)=>{
  if(busy)return;
  busy=true;showMessage('A registar informação no Supabase…');
  try{
   const result=await client.merchantAction(action,cashData(payload));
   await refresh();
   if(action==='product_create')view='products';
   render();
   const summary=action==='product_create'?'Produto criado com código '+result.code:
    action==='stock_receive'?'Stock recebido e registado por lote.':
    action==='cash_open'?'Sessão de caixa aberta.':
    action==='cash_close'?'Caixa fechado. Esperado: '+(Number(result.expected_cents)/100).toFixed(2)+' MT; diferença: '+(Number(result.difference_cents)/100).toFixed(2)+' MT.':
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
  if(el.hasAttribute('data-shop-refresh'))return void safeLoad();
  if(el.hasAttribute('data-shop-add'))return void add(el.dataset.shopAdd);
  if(el.hasAttribute('data-remove')){
   if(lockPending())return;
   cart=cart.filter(x=>x.productId!==el.dataset.remove);render();return;
  }
  if(el.hasAttribute('data-qty'))return void add(el.dataset.id,Number(el.dataset.qty));
  if(el.hasAttribute('data-shop-view')){view=el.dataset.shopView;notice='';render();return;}
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
    const disc=root.querySelector('[name="discount"]')?.value||'0';
    const tempTotal=(()=>{const byId=new Map(data.products.map(p=>[p.id,p]));
      return cart.reduce((s,l)=>s+Math.round(byId.get(l.productId).priceCents*l.quantity),0)-toCents(disc);})();
    const totalText=(tempTotal/100).toFixed(2);
    const allocations=method==='mixed'?['cash','mpesa','emola','transfer'].map(m=>({
     method:m,amount:String(f.get('pay_'+m)||'0')
    })).filter(p=>toCents(p.amount)>0):[{method,amount:totalText}];
    if(allocations.some(x=>x.method!=='cash')&&f.get('confirmed')!=='yes')throw Error('digital_unconfirmed');
    pending=makeSaleRequest({businessId:grant.id,branchId,sessionId:shift.id,
     cart,products:data.products,discount:disc,allocations,idempotencyKey:crypto.randomUUID(),
     cashReceived:String(f.get('cash_received')||'0')});
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
  if(pending)return void lockPending();
  const action=form.dataset.shopForm;
  if(!action)return;
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
 root.innerHTML='<main class="shop-loading">A consultar filiais e permissões reais no Supabase…</main>';
 await safeLoad(true);
}

import {merchantState,merchantStates,merchantOutcome} from './admin-merchant-lifecycle.js';
import {admin360AuditCSV} from './supabase-admin-360.js';
import {showConfirmModal,showPromptModal,showSuccessModal} from './ui/pronto-modal.js';
import {startProntoLoading} from './ui/pronto-loading.js';
import {customerMessage} from './customer-copy.js';
import {showProntoCredentials} from './pronto-credentials-ui.js';
import {renderUbuntuAdminShell,renderUbuntuAdminTab} from './supabase-admin-ui.js';
import {renderProvisioningForms} from './supabase-admin-forms.js';
import {ADMIN_TABS} from './supabase-admin-model.js';

export function prepareAdminProvisioning(form,FormDataImpl=FormData){
 const fd=new FormDataImpl(form);
 const action=form.dataset.provisionAction;
 const value=k=>String(fd.get(k)||'').trim();
 if(action==='business_create')return {action,data:{
  name:value('name'),phone:value('phone'),address:value('address'),branch_name:value('branch_name'),
  ...(value('business_type')?{business_type:value('business_type')}:{})
 }};
 if(action==='plan_create'){
  const raw=value('price_mzn');
  const normalized=raw.replace(/\.(?=\d{3}(?:[.,]|$))/g,'').replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))throw Error('invalid_price');
  const cents=Math.round(Number(normalized)*100);
  const duration=Number(value('duration_days'));
  if(!Number.isSafeInteger(cents)||cents<0||!Number.isSafeInteger(duration)||duration<1||duration>3660)throw Error('invalid_price');
  return {action,data:{name:value('name'),price_cents:cents,duration_days:duration}};
 }
 if(action==='license_manage'){
  const selected=value('license_action');
  if(!['license_assign','license_renew'].includes(selected))throw Error('admin_invalid_action');
  return {action:selected,data:{business_id:value('business_id'),plan_id:value('plan_id')}};
 }
 if(action==='member_create')return {action,data:{
  business_id:value('business_id'),email:value('email').toLowerCase(),
  display_name:value('display_name'),role:value('role')
 }};
 if(action==='pharmacy_professional_set')return {action,data:{
   business_id:value('business_id'),user_id:value('user_id'),license_reference:value('license_reference'),
   valid_until:value('valid_until'),active:value('active')==='true'
 }};
 if(action==='member_assign')return {action,data:{
  business_id:value('business_id'),user_id:value('user_id'),
  display_name:value('display_name'),role:value('role')
 }};
 throw Error('admin_invalid_action');
}
const errorMessages={
 invalid_price:'O preço ou o prazo do plano não são válidos.',
 account_exists:'Este email já tem uma conta. Utilize «Associação avançada» para relacioná-la com a loja.',
 association_failed:'A conta não foi associada à loja. Nenhuma senha será apresentada. Tente novamente ou contacte o suporte.',
 provision_partial_contact_support:'Não foi possível concluir a criação com segurança. Contacte o suporte antes de repetir.',
 account_unavailable:'Não foi possível criar o acesso. Verifique a ligação e tente novamente.',
 not_authorized:'Não tem autorização para esta operação.',
 account_invalid:'Confira o email, o nome e o perfil escolhido.',
 account_response_invalid:'Não foi possível confirmar as credenciais geradas. Contacte o suporte.',
 supabase_request_failed:'Não foi possível concluir a operação. Verifique os dados e evite duplicar registos.',
 admin_invalid_action:'Operação administrativa inválida.',
 invalid_input:'Preencha os campos obrigatórios correctamente.'
};
export async function mountUbuntuAdminDashboard({root,client,account,onLogout}){
 if(!account?.ubuntuAdmin)throw Error('admin_required');
 root.innerHTML=renderUbuntuAdminShell(account);
 let data=null,insights=null,trials=[],tab='overview',busy=false,businessFilter='all';
 const message=root.querySelector('#pronto-admin-message');
 const content=root.querySelector('#pronto-admin-content');
 const refreshButton=root.querySelector('#pronto-admin-refresh');
 const search=root.querySelector('#pronto-admin-search');
 const searchWrap=root.querySelector('#pronto-admin-search-wrap');
 const tabs=[...root.querySelectorAll('[data-admin-tab]')];
 const toggleBusy=state=>{
  busy=state;refreshButton.disabled=state;
  tabs.forEach(button=>button.disabled=state);
  content.querySelectorAll('button').forEach(button=>button.disabled=state);
 };
 const render=()=>{
  if(!data)return;
  searchWrap.hidden=tab!=='businesses'&&tab!=='members';
  search.placeholder=tab==='members'?'Pesquisar nome, email ou loja':'Pesquisar comerciante ou contacto';
  search.setAttribute('aria-label',tab==='members'?'Pesquisar utilizadores':'Pesquisar comerciantes');
  const query=tab==='businesses'||tab==='members'?search.value:'';
  content.innerHTML=renderUbuntuAdminTab(tab,data,{query,insights:insights||{},trials,businessFilter})+renderProvisioningForms(tab,data);
  tabs.forEach(button=>{
   const selected=button.dataset.adminTab===tab;
   button.setAttribute('aria-current',selected?'page':'false');
   button.classList.toggle('active',selected);
  });
 };
 const expired=async()=>{await client.signOut();onLogout();};
 const failure=async(error)=>{
  if(['supabase_unauthorized','supabase_identity_mismatch','admin_required'].includes(error.message)){
   await expired();return true;
  }
  message.textContent=customerMessage(errorMessages[error.message.split(':')[0]]||
   'Não foi possível completar a operação. Verifique a ligação e tente novamente.',{warning:true});
  return false;
 };
 const logout=async()=>{
  if(busy)return;
  toggleBusy(true);
  try{await client.signOut();}finally{onLogout();}
 };
 const load=async(nextTab=tab)=>{
  if(busy||!ADMIN_TABS.includes(nextTab))return;
  const loader=!data||nextTab===tab?startProntoLoading({title:'A preparar o seu painel',mode:'admin'}):null;
  let succeeded=false;
  toggleBusy(true);message.textContent='';
  try{
   [data,insights,trials]=await Promise.all([client.adminOverview(),client.adminInsights(),client.trialOverview()]);tab=nextTab;
   message.textContent='';render();succeeded=true;
  }catch(error){
   if(await failure(error))return;
   content.replaceChildren();
  }finally{
   if(root.querySelector('#pronto-admin-refresh')===refreshButton)toggleBusy(false);
   if(loader){if(succeeded)void loader.finish();else loader.cancel();}
  }
 };
 const submit=async event=>{
  const form=event.target.closest('form[data-provision-action]');
  if(!form)return;
  event.preventDefault();
  if(busy)return;
  let item;
  try{item=prepareAdminProvisioning(form);}
  catch(e){message.textContent=errorMessages[e.message]||'Confira os dados introduzidos.';return;}
  toggleBusy(true);message.textContent='';
  try{
   if(item.action==='member_create'){
    const account=await client.provisionMember(item.data);
    showProntoCredentials(account);
   }else if(item.action==='pharmacy_professional_set')await client.pharmacyAction('professional_set',item.data);
   else await client.adminMutate(item.action,item.data);
   [data,insights]=await Promise.all([client.adminOverview(),client.adminInsights()]);
   render();
   message.textContent=item.action==='member_create'?
    'A conta foi criada. Copie as credenciais antes de fechar a janela.':
    'Operação guardada com sucesso.';
  }catch(e){await failure(e);}
  finally{if(root.querySelector('#pronto-admin-refresh')===refreshButton)toggleBusy(false);}
 };
 const changeAdminPassword=async event=>{
  const form=event.target.closest('form[data-admin-password-change]');
  if(!form)return;
  event.preventDefault();
  if(busy)return;
  const fields=new FormData(form);
  // Do not trim, persist, log, or pass secrets to audit records.
  const current=String(fields.get('current_password')||'');
  const next=String(fields.get('new_password')||'');
  const confirm=String(fields.get('confirm_password')||'');
  if(next.length<12||next.length>128){message.textContent='A nova palavra-passe deve ter entre 12 e 128 caracteres.';return;}
  if(next!==confirm){message.textContent='A confirmação da palavra-passe não coincide.';return;}
  if(next===current){message.textContent='Escolha uma palavra-passe diferente da actual.';return;}
  toggleBusy(true);message.textContent='';
  try{
   await client.changeOwnAdminPassword(current,next);
   form.reset();
   // End the old session after saving; the next entry uses the new password
   // and the same personal PIN.
   await client.signOut();
   onLogout();
  }catch(error){
   if(error.message==='supabase_unauthorized'||error.message==='supabase_identity_mismatch'){
    form.reset();
    await expired();return;
   }
   message.textContent={
    admin_current_password_invalid:'A palavra-passe actual não está correcta.',
    admin_password_same:'Escolha uma palavra-passe diferente da actual.',
    admin_password_invalid:'A nova palavra-passe deve ter entre 12 e 128 caracteres.',
    supabase_rate_limit:'Muitas tentativas. Tente novamente mais tarde.',
    supabase_unavailable:'Sem ligação. Não foi possível alterar a palavra-passe.'
   }[error.message]||'Não foi possível alterar a palavra-passe. Verifique a ligação e tente novamente.';
  }finally{if(root.querySelector('#pronto-admin-refresh')===refreshButton)toggleBusy(false);}
 };
 const recoverAccount=async event=>{
  const form=event.target.closest('form[data-admin-password-reset]');
  if(!form)return;
  event.preventDefault();
  if(busy)return;
  const fields=new FormData(form);
  const businessId=String(fields.get('business_id')||'');
  const userId=String(fields.get('user_id')||'');
  const reason=String(fields.get('reason')||'').trim();
  if(reason.length<10||reason.length>500||!fields.has('identity_verified')){
   message.textContent='Confirme a identidade e indique o motivo (10 a 500 caracteres).';return;
  }
  const member=data?.businesses?.find(b=>b.id===businessId)?.members?.find(m=>m.userId===userId);
  if(!member){message.textContent='Não foi possível identificar a conta. Actualize a lista.';return;}
  if(!await showConfirmModal({
   title:'Repor acesso do utilizador',
   message:'Confirma a reposição da palavra-passe de '+String(member.name||member.email)+
    '? A senha anterior deixará de servir para novos logins. Esta operação será registada em auditoria.',
   danger:true,confirmText:'Sim, gerar nova senha'
  }))return;
  toggleBusy(true);message.textContent='';
  try{
   const credentials=await client.resetMemberPassword({businessId,userId,reason,identityVerified:true});
   showProntoCredentials(credentials);
   form.reset();
   message.textContent='Senha provisória gerada. Entregue-a apenas ao utilizador cuja identidade foi confirmada.';
  }catch(error){
   message.textContent={
    not_authorized_or_limited:'Reposição não autorizada ou limite de tentativas atingido.',
    account_unavailable:'A conta não está disponível para recuperação.',
    reset_partial_contact_support:'Recuperação parcialmente concluída. Contacte o suporte antes de repetir.',
    reset_failed:'O serviço não conseguiu repor a palavra-passe.',
    supabase_rate_limit:'Demasiadas tentativas. Aguarde antes de tentar novamente.'
   }[error.message]||'Não foi possível concluir a recuperação. Verifique a ligação e tente novamente.';
  }finally{toggleBusy(false);}
 };
 const controlForm=async event=>{
  const form=event.target.closest('form[data-admin-control]');
  if(!form)return;
  event.preventDefault();
  if(busy)return;
  const action=form.dataset.adminControl,fd=new FormData(form),val=n=>String(fd.get(n)||'').trim();
  const moneyCents=name=>{
   const value=val(name);
   if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('invalid_price');
   const n=Math.round(Number(value)*100);
   if(!Number.isSafeInteger(n)||n<0)throw Error('invalid_price');
   return n;
  };
  let payload;
  try{
   if(action==='business_edit')payload={business_id:val('business_id'),name:val('name'),phone:val('phone'),address:val('address')};
   else if(action==='branch_edit')payload={business_id:val('business_id'),branch_id:val('branch_id'),name:val('name'),active:fd.has('active')};
   else if(action==='member_edit')payload={business_id:val('business_id'),user_id:val('user_id'),display_name:val('display_name'),role:val('role')};
   else if(action==='plan_edit')payload={plan_id:val('plan_id'),name:val('name'),price_cents:moneyCents('price_mzn'),duration_days:Number(val('duration_days'))};
   else if(action==='payment_record')payload={business_id:val('business_id'),plan_id:val('plan_id')||null,
    amount_cents:moneyCents('amount_mzn'),method:val('method'),external_reference:val('external_reference'),reason:val('reason')};
   else throw Error('admin_invalid_action');
  }catch(e){message.textContent=errorMessages[e.message]||'Confira todos os campos.';return;}
  if(!await showConfirmModal({
   title:action==='payment_record'?'Confirmar recebimento':'Guardar alterações',
   message:action==='payment_record'?
    'Confirma que a Ubuntu recebeu efectivamente este pagamento? Este registo financeiro será auditado.':
    'Guardar estas alterações na plataforma?',
   confirmText:action==='payment_record'?'Registar recebimento':'Guardar'
  }))return;
  toggleBusy(true);message.textContent='';
  try{
   await client.adminControl(action,payload);
   [data,insights]=await Promise.all([client.adminOverview(),client.adminInsights()]);
   render();message.textContent=action==='business_edit'?merchantOutcome(action):'Operação confirmada e auditada.';
   if(action==='business_edit')void showSuccessModal({title:'Comerciante actualizado',message:message.textContent,confirmText:'OK'});
  }catch(e){await failure(e);}finally{toggleBusy(false);}
 };
 const quickOperation=async button=>{
  if(busy)return;
  const action=button.dataset.adminOperation,id=button.dataset.adminId;
  const known=['business_suspend','business_activate','business_archive','business_restore','business_remove',
   'license_cancel','member_deactivate','member_reactivate','plan_toggle'];
  if(!known.includes(action))return;
  let payload={},request=action==='business_suspend'||action==='business_activate'||
   action==='license_cancel'||action==='member_deactivate'?'adminCritical':'adminControl';
  if(action.startsWith('member_')){
   const ids=String(id||'').split('|');
   if(ids.length!==2){message.textContent='Utilizador não identificado.';return;}
   payload={business_id:ids[0],user_id:ids[1]};
  }else if(action.startsWith('plan_')){
   const plan=data.plans.find(x=>x.id===id);
   if(!plan)return;
   payload={plan_id:id,active:!plan.active};
  }else payload={business_id:id};
  const business=data.businesses.find(x=>x.id===payload.business_id);
  if(action.startsWith('business_')&&!business){message.textContent='Comerciante não encontrado. Actualize a lista.';return;}
  const current=business?merchantState(business,insights?.businesses):null;
  if(action==='business_activate'&&(current==='removed'||current==='archived')){
   message.textContent='Restaure primeiro este comerciante. Depois confirme a licença e active o negócio.';
   return;
  }
  if(action==='business_restore'&&current!=='archived'&&current!=='removed'){
   message.textContent='Este comerciante não está arquivado nem retirado. Actualize a lista.';
   return;
  }
  const label={
   business_suspend:'Suspender comerciante',business_activate:'Reactivar comerciante',
   business_archive:'Arquivar comerciante',business_restore:'Restaurar comerciante',
   business_remove:'Retirar comerciante (reversível)',license_cancel:'Cancelar licença',
   member_deactivate:'Bloquear utilizador',member_reactivate:'Reactivar utilizador',
   plan_toggle:'Alterar disponibilidade do plano'
  }[action]||'Confirmar operação';
  const dangerous=['business_suspend','business_archive','business_remove','license_cancel','member_deactivate'].includes(action);
  const resourceName=business?.name||'este registo';
  if(['business_remove','business_archive','business_restore'].includes(action)){
   const safety=action==='business_remove'?'RETIRAR':'CONFIRMAR';
   const typed=await showPromptModal({
    title:label,message:'Para '+label.toLowerCase()+' de '+resourceName+', escreva '+safety+'. Vendas, caixa, stock e dívidas serão preservados; restaurar não reactiva automaticamente o negócio.',
    placeholder:'Escreva '+safety,minLength:safety.length,maxLength:16,danger:dangerous,
    confirmText:'Continuar'
   });
   if(typed!==safety)return;
   const reason=await showPromptModal({
    title:'Motivo da intervenção',
    message:'Indique o motivo desta operação. Será guardado no histórico administrativo.',
    placeholder:'Justifique a intervenção (mínimo de 10 caracteres)',minLength:10,maxLength:500,
    danger:dangerous,confirmText:'Confirmar intervenção'
   });
   if(reason===null)return;
   payload.reason=reason;
  }else{
   if(!await showConfirmModal({
    title:label,message:'Confirmar '+label.toLowerCase()+' para '+resourceName+'?',
    danger:dangerous,confirmText:dangerous?'Sim, continuar':'Confirmar'
   }))return;
   if(request==='adminCritical'){
    const reason=await showPromptModal({
     title:'Motivo obrigatório',
     message:'Registe a justificação desta intervenção crítica. O registo ficará disponível na auditoria.',
     placeholder:'Escreva o motivo (mínimo de 10 caracteres)',minLength:10,maxLength:500,
     danger:true,confirmText:'Executar operação'
    });
    if(reason===null)return;
    payload.reason=reason;
   }
  }
  toggleBusy(true);message.textContent='';
  try{
   const outcome=await client[request](action,payload);
   if(!outcome||typeof outcome!=='object')throw Error('admin_operation_unconfirmed');
   [data,insights]=await Promise.all([client.adminOverview(),client.adminInsights()]);
   render();message.textContent=merchantOutcome(action,outcome);
   void showSuccessModal({title:label+' — concluído',message:message.textContent,confirmText:'OK'});
  }catch(e){await failure(e);}finally{toggleBusy(false);}
 };
 content.addEventListener('submit',recoverAccount);
 content.addEventListener('submit',changeAdminPassword);
 content.addEventListener('submit',controlForm);
 content.addEventListener('click',event=>{
  const navigate=event.target.closest('[data-admin-navigate]');
  if(navigate){search.value='';load(navigate.dataset.adminNavigate);return;}
  const selector=event.target.closest('[data-admin-business-filter]');
  if(selector&&!busy){
   const selected=selector.dataset.adminBusinessFilter;
   if(merchantStates.includes(selected)){businessFilter=selected;render();}
   return;
  }
  const operation=event.target.closest('[data-admin-operation]');
  if(operation){void quickOperation(operation);return;}
  const exporter=event.target.closest('[data-admin-export="audit"]');
  if(exporter&&insights){
   const blob=new Blob([admin360AuditCSV(insights)],{type:'text/csv;charset=utf-8'});
   const uri=URL.createObjectURL(blob),anchor=document.createElement('a');
   anchor.href=uri;anchor.download='pronto-admin-auditoria.csv';document.body.append(anchor);
   anchor.click();anchor.remove();URL.revokeObjectURL(uri);
  }
 });

 tabs.forEach(button=>button.addEventListener('click',()=>{if(busy)return;search.value='';load(button.dataset.adminTab);}));
 refreshButton.addEventListener('click',()=>load(tab));
 root.querySelector('#pronto-admin-logout').addEventListener('click',logout);
 content.addEventListener('submit',submit);
 search.addEventListener('input',()=>{if((tab==='businesses'||tab==='members')&&data&&!busy)render();});
 await load();
}

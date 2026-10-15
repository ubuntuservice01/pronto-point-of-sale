import {renderUbuntuAdminShell,renderUbuntuAdminTab} from './supabase-admin-ui.js';
import {renderProvisioningForms} from './supabase-admin-forms.js';
import {ADMIN_TABS} from './supabase-admin-model.js';

export function prepareAdminProvisioning(form){
 const fd=new FormData(form);
 const action=form.dataset.provisionAction;
 const value=k=>String(fd.get(k)||'').trim();
 if(action==='business_create')return {action,data:{
  name:value('name'),phone:value('phone'),address:value('address'),branch_name:value('branch_name')
 }};
 if(action==='plan_create'){
  const raw=value('price_mzn');
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(raw))throw Error('invalid_price');
  const cents=Math.round(Number(raw.replace(',','.'))*100);
  const duration=Number(value('duration_days'));
  if(!Number.isSafeInteger(cents)||cents<0||!Number.isSafeInteger(duration)||duration<1||duration>3660)throw Error('invalid_price');
  return {action,data:{name:value('name'),price_cents:cents,duration_days:duration}};
 }
 if(action==='license_manage'){
  const selected=value('license_action');
  if(!['license_assign','license_renew'].includes(selected))throw Error('admin_invalid_action');
  return {action:selected,data:{business_id:value('business_id'),plan_id:value('plan_id')}};
 }
 if(action==='member_invite')return {action,data:{
  business_id:value('business_id'),email:value('email').toLowerCase(),
  display_name:value('display_name'),role:value('role')
 }};
 if(action==='member_assign')return {action,data:{
  business_id:value('business_id'),user_id:value('user_id'),
  display_name:value('display_name'),role:value('role')
 }};
 throw Error('admin_invalid_action');
}
const errorMessages={
 invalid_price:'O valor do plano ou o prazo não são válidos.',
 account_exists_use_existing_user:'Este email já tem uma conta Supabase. Utilize a opção «Associar conta já existente» com o UID da conta.',
 invited_but_membership_failed:'Convite enviado, mas a associação falhou. Verifique o utilizador em Authentication → Users e associe-o pelo UID antes de repetir o convite.',
 invitation_created_check_auth_dashboard:'O convite foi criado, mas não foi possível identificar a conta. Confirme em Authentication → Users.',
 invitation_unavailable:'Não foi possível enviar o convite. Confirme o estado do Supabase Auth e tente novamente.',
 supabase_request_failed:'Não foi possível concluir a operação. Verifique os dados e evite duplicar registos.',
 admin_invalid_action:'Operação administrativa inválida.',
 invalid_input:'Preencha os campos obrigatórios correctamente.'
};
export async function mountUbuntuAdminDashboard({root,client,account,onLogout}){
 if(!account?.ubuntuAdmin)throw Error('admin_required');
 root.innerHTML=renderUbuntuAdminShell(account);
 let data=null,tab='overview',busy=false;
 const message=root.querySelector('#pronto-admin-message');
 const content=root.querySelector('#pronto-admin-content');
 const refreshButton=root.querySelector('#pronto-admin-refresh');
 const search=root.querySelector('#pronto-admin-search');
 const searchWrap=root.querySelector('#pronto-admin-search-wrap');
 const tabs=[...root.querySelectorAll('[data-admin-tab]')];
 const toggleBusy=state=>{
  busy=state;refreshButton.disabled=state;
  tabs.forEach(button=>button.disabled=state);
  content.querySelectorAll('button[type="submit"]').forEach(button=>button.disabled=state);
 };
 const render=()=>{
  if(!data)return;
  searchWrap.hidden=tab!=='businesses';
  const query=tab==='businesses'?search.value:'';
  content.innerHTML=renderUbuntuAdminTab(tab,data,{query})+renderProvisioningForms(tab,data);
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
  message.textContent=errorMessages[error.message.split(':')[0]]||
   'Não foi possível completar a operação. Verifique a ligação e tente novamente.';
  return false;
 };
 const logout=async()=>{
  if(busy)return;
  toggleBusy(true);
  try{await client.signOut();}finally{onLogout();}
 };
 const load=async(nextTab=tab)=>{
  if(busy||!ADMIN_TABS.includes(nextTab))return;
  toggleBusy(true);message.textContent='A actualizar informações autorizadas…';
  try{
   data=await client.adminOverview();tab=nextTab;
   message.textContent='';render();
  }catch(error){
   if(await failure(error))return;
   content.replaceChildren();
  }finally{if(root.querySelector('#pronto-admin-refresh')===refreshButton)toggleBusy(false);}
 };
 const submit=async event=>{
  const form=event.target.closest('form[data-provision-action]');
  if(!form||busy)return;
  event.preventDefault();
  let item;
  try{item=prepareAdminProvisioning(form);}
  catch(e){message.textContent=errorMessages[e.message]||'Confira os dados introduzidos.';return;}
  toggleBusy(true);message.textContent='A guardar no Supabase…';
  try{
   if(item.action==='member_invite')await client.inviteMember(item.data);
   else await client.adminMutate(item.action,item.data);
   data=await client.adminOverview();
   render();
   message.textContent=item.action==='member_invite'?
    'Convite solicitado ao Supabase. Confirme que o colaborador recebeu o email e completou o registo.':
    'Operação registada no Supabase com sucesso.';
  }catch(e){await failure(e);}
  finally{if(root.querySelector('#pronto-admin-refresh')===refreshButton)toggleBusy(false);}
 };
 tabs.forEach(button=>button.addEventListener('click',()=>{if(busy)return;search.value='';load(button.dataset.adminTab);}));
 refreshButton.addEventListener('click',()=>load(tab));
 root.querySelector('#pronto-admin-logout').addEventListener('click',logout);
 content.addEventListener('submit',submit);
 search.addEventListener('input',()=>{if(tab==='businesses'&&data&&!busy)render();});
 await load();
}

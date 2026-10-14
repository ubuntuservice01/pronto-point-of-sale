import {renderUbuntuAdminShell,renderUbuntuAdminTab} from './supabase-admin-ui.js';
import {ADMIN_TABS} from './supabase-admin-model.js';

// All five administrative sections use the authenticated database RPC.
// Changing tabs fetches fresh authorised data; the page never offers
// administrative writes until the trusted-server endpoints are implemented.
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
 const render=()=>{
  if(!data)return;
  searchWrap.hidden=tab!=='businesses';
  const query=tab==='businesses'?search.value:'';
  content.innerHTML=renderUbuntuAdminTab(tab,data,{query});
  tabs.forEach(button=>{
   const selected=button.dataset.adminTab===tab;
   button.setAttribute('aria-current',selected?'page':'false');
   button.classList.toggle('active',selected);
  });
 };
 const logout=async()=>{
  if(busy)return;
  busy=true;
  root.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await client.signOut();}finally{onLogout();}
 };
 const load=async(nextTab=tab)=>{
  if(busy||!ADMIN_TABS.includes(nextTab))return;
  busy=true;
  refreshButton.disabled=true;tabs.forEach(b=>b.disabled=true);
  message.textContent='A actualizar informações autorizadas…';
  try{
   const received=await client.adminOverview();
   data=received;tab=nextTab;
   message.textContent='';
   render();
  }catch(error){
   // Revoked privileges or expired/invalid tokens cannot keep a previously
   // visible administration dashboard. Return to login and discard it.
   if(['supabase_unauthorized','supabase_identity_mismatch','admin_required'].includes(error.message)){
    await client.signOut();onLogout();return;
   }
   message.textContent='Não foi possível carregar dados administrativos. Verifique a ligação e tente novamente.';
   content.replaceChildren();
  }finally{
   busy=false;
   if(root.querySelector('#pronto-admin-refresh')===refreshButton){
    refreshButton.disabled=false;tabs.forEach(b=>b.disabled=false);
   }
  }
 };
 tabs.forEach(button=>button.addEventListener('click',()=>{search.value='';load(button.dataset.adminTab);}));
 refreshButton.addEventListener('click',()=>load(tab));
 root.querySelector('#pronto-admin-logout').addEventListener('click',logout);
 search.addEventListener('input',()=>{if(tab==='businesses'&&data)render();});
 await load();
}

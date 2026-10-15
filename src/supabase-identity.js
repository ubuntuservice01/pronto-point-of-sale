// Pronto POS Supabase identity smoke-test (no POS writes and no persistent tokens).
// Keeps tokens in memory; pages must be re-authenticated on reload.
const validEmail = value => typeof value === 'string' && value.length > 3 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
import {normalizeAdminOverview} from './supabase-admin-model.js';
import {normalizeMerchantSnapshot} from './supabase-shop-core.js';
import {normalizeCreditSnapshot} from './supabase-credit-ui.js';
import {normalizeFinanceSnapshot} from './supabase-finance-ui.js';
import {normalizeReturnSnapshot} from './supabase-returns-ui.js';
import {normalizeInventorySnapshot} from './supabase-inventory-ui.js';
import {normalizeReports} from './supabase-reports-ui.js';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createProntoIdentity({ url, publishableKey, fetchImpl = fetch } = {}) {
 const apiURL=new URL(url||'');
 if(apiURL.protocol!=='https:' || apiURL.hostname!=='xgtpvszwzvkwysrswkek.supabase.co' || apiURL.pathname!=='/') throw Error('supabase_project');
 if(typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw Error('supabase_publishable_key');
 let session=null;
 let sessionLocked=false;
 let refreshJob=null;
 const expiresAt=data=>Number.isFinite(Number(data?.expires_in))&&Number(data.expires_in)>0?Date.now()+Number(data.expires_in)*1000:0;
 async function ensureFresh(){
  if(!session)throw Error('supabase_unauthorized');
  if(!session.expiresAt||Date.now()<session.expiresAt-30000)return;
  if(!session.refresh_token){session=null;throw Error('supabase_unauthorized');}
  if(!refreshJob){
   refreshJob=(async()=>{
    const previous=session;
    const response=await fetchImpl(apiURL.origin+'/auth/v1/token?grant_type=refresh_token',{
     method:'POST',headers:{apikey:publishableKey,Accept:'application/json','Content-Type':'application/json'},
     cache:'no-store',credentials:'omit',redirect:'error',body:JSON.stringify({refresh_token:previous.refresh_token})
    });
    if(!response.ok){session=null;throw Error('supabase_unauthorized');}
    let data;try{data=await response.json();}catch{session=null;throw Error('supabase_unavailable');}
    if(!data||typeof data.access_token!=='string'||!uuid(data.user?.id)||data.user.id!==previous.user.id){session=null;throw Error('supabase_identity_mismatch');}
    session={access_token:data.access_token,refresh_token:data.refresh_token||previous.refresh_token,user:{id:data.user.id},expiresAt:expiresAt(data)};
   })().finally(()=>{refreshJob=null;});
  }
  await refreshJob;
 }
 async function call(endpoint, {method='GET', payload, authenticated=true,allowLocked=false}={}) {
  if(authenticated&&sessionLocked&&!allowLocked)throw Error('pin_screen_locked');
  if(authenticated)await ensureFresh();
  const headers={apikey:publishableKey,Accept:'application/json'};
  if(payload!==undefined)headers['Content-Type']='application/json';
  if(authenticated && session?.access_token)headers.Authorization='Bearer '+session.access_token;
  const response=await fetchImpl(apiURL.origin+endpoint, {
   method,headers,cache:'no-store',credentials:'omit',redirect:'error',
   body:payload===undefined?undefined:JSON.stringify(payload)
  });
  let data;
  try { data=await response.json(); } catch { throw Error('supabase_unavailable'); }
  if(!response.ok) {
   if(response.status===401||response.status===403){if(authenticated)session=null;throw Error('supabase_unauthorized');}
   if(response.status===429)throw Error('supabase_rate_limit');
   throw Error('supabase_request_failed');
  }
  return data;
 }
 async function account() {
  if(!session)throw Error('supabase_unauthorized');
  const user=await call('/auth/v1/user');
  if(!uuid(user?.id) || user.id!==session.user.id)throw Error('supabase_identity_mismatch');
  // Read-only RPC: verifies the *current token's* UUID against a private admin registry.
  // Never trust user_metadata, a caller-supplied role, or an email string for elevation.
  const ubuntuAdmin=await call('/rest/v1/rpc/pronto_admin_status',{method:'POST',payload:{}});
  if(typeof ubuntuAdmin!=='boolean')throw Error('supabase_response');
  const memberships=await call('/rest/v1/pronto_memberships?select=business_id,role,active&user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true');
  if(!Array.isArray(memberships))throw Error('supabase_response');
  const safe=memberships.filter(m=>uuid(m.business_id)&&['owner','manager','cashier','stock','finance'].includes(m.role)&&m.active===true);
  const ids=[...new Set(safe.map(m=>m.business_id))];
  let businesses=[];
  if(ids.length){
   businesses=await call('/rest/v1/pronto_businesses?select=id,name,status&id=in.('+ids.join(',')+')');
   if(!Array.isArray(businesses))throw Error('supabase_response');
  }
  const allowed=new Map(businesses.filter(b=>uuid(b.id)&&b.status==='active').map(b=>[b.id,b]));
  const grants=safe.filter(m=>allowed.has(m.business_id)).map(m=>({
   id:m.business_id,name:allowed.get(m.business_id).name,role:m.role
  }));
  return {userId:user.id,email:user.email||'',ubuntuAdmin,grants};
 }
 async function signIn(email,password){
  if(!validEmail(email)||typeof password!=='string'||password.length<1||password.length>200)throw Error('supabase_invalid_credentials');
  session=null;sessionLocked=false;
  const result=await call('/auth/v1/token?grant_type=password',{authenticated:false,method:'POST',payload:{email,password}});
  if(typeof result.access_token!=='string'||!uuid(result.user?.id))throw Error('supabase_response');
  session={access_token:result.access_token,refresh_token:result.refresh_token||null,user:{id:result.user.id},expiresAt:expiresAt(result)};
  try{return await account();}
  catch(error){session=null;throw error;}
 }
 async function adminOverview(){
  if(!session)throw Error('supabase_unauthorized');
  const result=await call('/rest/v1/rpc/pronto_admin_overview',{method:'POST',payload:{}});
  return normalizeAdminOverview(result);
 }
 async function adminMutate(action,data){
  if(!session)throw Error('supabase_unauthorized');
  const allowed=['plan_create','business_create','member_assign','member_deactivate','license_assign','license_renew','license_cancel','business_suspend','business_activate'];
  if(!allowed.includes(action)||!data||typeof data!=='object'||Array.isArray(data))throw Error('admin_invalid_action');
  return call('/rest/v1/rpc/pronto_admin_mutation',{method:'POST',payload:{p_action:action,p_data:data}});
 }
 async function inviteMember({email,display_name,role,business_id}){
  if(sessionLocked)throw Error('pin_screen_locked');
  if(!session)throw Error('supabase_unauthorized');
  await ensureFresh();
  const response=await fetchImpl(apiURL.origin+'/functions/v1/pronto-admin-invite',{
   method:'POST',headers:{apikey:publishableKey,Authorization:'Bearer '+session.access_token,Accept:'application/json','Content-Type':'application/json'},
   cache:'no-store',credentials:'omit',redirect:'error',
   body:JSON.stringify({email,display_name,role,business_id})
  });
  let result;try{result=await response.json();}catch{throw Error('invitation_unavailable');}
  if(!response.ok){
   const allowed=['account_exists_use_existing_user','invitation_created_check_auth_dashboard','invited_but_membership_failed','admin_required','invalid_input'];
   if(response.status===401||response.status===403){session=null;throw Error('supabase_unauthorized');}
   if(allowed.includes(result?.error))throw Error(result.error+(result.user_id?':'+result.user_id:''));
   throw Error('invitation_unavailable');
  }
  return result;
 }
 async function inviteShopStaff({businessId,email,name,role}){
  if(sessionLocked)throw Error('pin_screen_locked');
  if(!session)throw Error('supabase_unauthorized');
  if(!uuid(businessId)||!validEmail(email)||typeof name!=='string'||name.trim().length<2||
   !['manager','cashier','stock','finance'].includes(role))throw Error('staff_invite_invalid');
  await ensureFresh();
  const response=await fetchImpl(apiURL.origin+'/functions/v1/pronto-owner-invite',{
   method:'POST',
   headers:{apikey:publishableKey,Authorization:'Bearer '+session.access_token,
    Accept:'application/json','Content-Type':'application/json'},
   cache:'no-store',credentials:'omit',redirect:'error',
   body:JSON.stringify({business_id:businessId,email:email.trim().toLowerCase(),
    display_name:name.trim(),role})
  });
  let result;try{result=await response.json();}catch{throw Error('staff_invite_unavailable');}
  if(!response.ok){
   if(response.status===401||response.status===403){session=null;throw Error('supabase_unauthorized');}
   if(result?.error==='account_exists_use_existing_user')throw Error('staff_exists');
   if(result?.error==='invited_but_membership_failed')throw Error('staff_invited_not_linked');
   throw Error('staff_invite_unavailable');
  }
  return result;
 }
 async function merchantBranches(businessId){
  if(!uuid(businessId))throw Error('shop_scope');
  const items=await call('/rest/v1/pronto_branches?select=id,name&active=eq.true&business_id=eq.'+encodeURIComponent(businessId)+'&order=name.asc');
  if(!Array.isArray(items))throw Error('supabase_response');
  return items.filter(b=>uuid(b?.id)).map(b=>({id:b.id,name:String(b.name||'Filial')}));
 }
 async function reportsSnapshot(businessId,branchId,from,to){
  if(!uuid(businessId)||(branchId!==null&&!uuid(branchId))||!/^\\d{4}-\\d{2}-\\d{2}$/.test(from||'')||!/^\\d{4}-\\d{2}-\\d{2}$/.test(to||''))throw Error('reports_scope');
  return normalizeReports(await call('/rest/v1/rpc/pronto_reports_snapshot',{
   method:'POST',payload:{p_business:businessId,p_branch:branchId,p_start:from,p_end:to}
  }));
 }
 async function inventorySnapshot(businessId,branchId){
  if(!uuid(businessId)||!uuid(branchId))throw Error('shop_scope');
  return normalizeInventorySnapshot(await call('/rest/v1/rpc/pronto_inventory_snapshot',{
   method:'POST',payload:{p_business:businessId,p_branch:branchId}
  }));
 }
 async function inventoryAction(action,data){
  if(!['product_update','inventory_adjust','inventory_count'].includes(action)||!data||typeof data!=='object'||Array.isArray(data))throw Error('inventory_action_invalid');
  return call('/rest/v1/rpc/pronto_inventory_action',{
   method:'POST',payload:{p_action:action,p_data:data}
  });
 }
 async function returnSnapshot(businessId,branchId){
  if(!uuid(businessId)||!uuid(branchId))throw Error('shop_scope');
  const value=await call('/rest/v1/rpc/pronto_return_snapshot',{
   method:'POST',payload:{p_business:businessId,p_branch:branchId}
  });
  return normalizeReturnSnapshot(value);
 }
 async function returnAction(action,data){
  if(action!=='return_confirm'||!data||typeof data!=='object'||Array.isArray(data))throw Error('return_action_invalid');
  return call('/rest/v1/rpc/pronto_return_action',{
   method:'POST',payload:{p_action:action,p_data:data}
  });
 }
 async function holdList(businessId,branchId){
  if(!uuid(businessId)||!uuid(branchId))throw Error('shop_scope');
  const rows=await call('/rest/v1/rpc/pronto_hold_list',{method:'POST',
   payload:{p_business:businessId,p_branch:branchId}});
  if(!Array.isArray(rows))throw Error('supabase_response');
  return rows.filter(x=>uuid(x?.id)&&Array.isArray(x.cart)).map(x=>({
   id:x.id,cart:x.cart,customerId:x.customer_id,operatorId:x.operator_id,createdAt:x.created_at
  }));
 }
 async function holdAction(action,data){
  if(!['hold_save','hold_delete','cash_move'].includes(action)||!data||typeof data!=='object'||Array.isArray(data))
   throw Error('hold_action_invalid');
  return call('/rest/v1/rpc/pronto_hold_action',{method:'POST',
   payload:{p_action:action,p_data:data}});
 }
 async function financeSnapshot(businessId,branchId){
  if(!uuid(businessId)||!uuid(branchId))throw Error('shop_scope');
  const data=await call('/rest/v1/rpc/pronto_finance_snapshot',{
   method:'POST',payload:{p_business:businessId,p_branch:branchId}
  });
  return normalizeFinanceSnapshot(data);
 }
 async function financeAction(action,data){
  if(!['supplier_save','purchase_receive','purchase_payment','expense_add','expense_schedule_save'].includes(action))throw Error('finance_action_invalid');
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('finance_action_invalid');
  return call('/rest/v1/rpc/pronto_finance_action',{
   method:'POST',payload:{p_action:action,p_data:data}
  });
 }
 async function creditSnapshot(businessId,branchId){
  if(!uuid(businessId)||!uuid(branchId))throw Error('shop_scope');
  const data=await call('/rest/v1/rpc/pronto_credit_snapshot',{
   method:'POST',payload:{p_business:businessId,p_branch:branchId}
  });
  return normalizeCreditSnapshot(data);
 }
 async function merchantSnapshot(businessId,branchId){
  if(!uuid(businessId)||!uuid(branchId))throw Error('shop_scope');
  const payload={p_business:businessId,p_branch:branchId};
  const result=await call('/rest/v1/rpc/pronto_merchant_snapshot',{method:'POST',payload});
  return normalizeMerchantSnapshot(result);
 }
 async function merchantAction(action,data){
  if(!['product_create','stock_receive','cash_open','cash_close','sale_complete','customer_save','credit_policy','credit_sale','debt_payment'].includes(action))
   throw Error('shop_action_invalid');
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('shop_action_invalid');
  return call('/rest/v1/rpc/pronto_merchant_action',{method:'POST',payload:{p_action:action,p_data:data}});
 }
 async function requestPasswordRecovery(email,redirectUrl){
  if(!validEmail(email))throw Error('supabase_invalid_credentials');
  let redirect;
  try{redirect=new URL(redirectUrl);}
  catch{throw Error('recovery_redirect');}
  if(!['https:','http:'].includes(redirect.protocol)||redirect.username||redirect.password||
   (redirect.protocol==='http:'&&!['localhost','127.0.0.1'].includes(redirect.hostname))||
   redirect.hash||redirect.searchParams.get('mode')!=='supabase'||redirect.searchParams.get('reset-password')!=='1')
   throw Error('recovery_redirect');
  // Password reset depends on Supabase Auth approved redirect URLs and SMTP.
  await call('/auth/v1/recover?redirect_to='+encodeURIComponent(redirect.href),{
   authenticated:false,method:'POST',payload:{email}
  });
  return true;
 }
 async function completePasswordRecovery(recoveryAccessToken,newPassword){
  if(typeof recoveryAccessToken!=='string'||recoveryAccessToken.length<20||recoveryAccessToken.length>10000)throw Error('recovery_token');
  if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>128)throw Error('recovery_password');
  // The token is accepted only by Supabase Auth. It never becomes a merchant session.
  const headers={apikey:publishableKey,Authorization:'Bearer '+recoveryAccessToken,Accept:'application/json'};
  const verify=await fetchImpl(apiURL.origin+'/auth/v1/user',{
   method:'GET',headers,cache:'no-store',credentials:'omit',redirect:'error'
  });
  if(!verify.ok)throw Error('recovery_invalid');
  const user=await verify.json().catch(()=>null);
  if(!uuid(user?.id))throw Error('recovery_invalid');
  const updated=await fetchImpl(apiURL.origin+'/auth/v1/user',{
   method:'PUT',headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({password:newPassword}),
   cache:'no-store',credentials:'omit',redirect:'error'
  });
  if(!updated.ok){
   if(updated.status===401||updated.status===403)throw Error('recovery_invalid');
   throw Error('recovery_rejected');
  }
  session=null;
  return true;
 }
 async function sessionPin(action,pin=null,currentPin=null){
  if(!['status','create','verify','change'].includes(action))throw Error('pin_invalid_action');
  if(action!=='status'&&!(typeof pin==='string'&&/^\d{5}$/.test(pin)))throw Error('pin_five_digits');
  if(action==='change'&&!(typeof currentPin==='string'&&/^\d{5}$/.test(currentPin)))throw Error('pin_five_digits');
  const result=await call('/rest/v1/rpc/pronto_session_pin',{method:'POST',allowLocked:true,
   payload:{p_action:action,p_pin:pin,p_current_pin:currentPin}});
  if(!result||typeof result!=='object')throw Error('supabase_response');
  if(action==='verify'&&result.ok===true)sessionLocked=false;
  return result;
 }
 function lockScreen(){if(session)sessionLocked=true;}
 function isScreenLocked(){return sessionLocked;}
 async function signOut(){
  if(session){
   try{await call('/auth/v1/logout',{method:'POST'});}catch{/* Clear local token even when service unavailable. */}
  }
  session=null;sessionLocked=false;
 }
 return {sessionPin,lockScreen,isScreenLocked,signIn,account,adminOverview,adminMutate,inviteMember,inviteShopStaff,merchantBranches,merchantSnapshot,creditSnapshot,financeSnapshot,financeAction,holdList,holdAction,returnSnapshot,returnAction,inventorySnapshot,inventoryAction,reportsSnapshot,merchantAction,requestPasswordRecovery,completePasswordRecovery,signOut};
}

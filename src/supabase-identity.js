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
import {normalizeTransferSnapshot} from './supabase-transfers-ui.js';
import {normalizeStaffSnapshot} from './supabase-team-management-ui.js';
import {normalizeSuspendedCash} from './supabase-staff-cash-ui.js';
import {normalizeAuditSnapshot} from './supabase-audit-ui.js';
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
 async function provisionAccount({businessId,email,name,role,scope}){
  if(sessionLocked)throw Error('pin_screen_locked');
  if(!session)throw Error('supabase_unauthorized');
  if(!uuid(businessId)||!validEmail(email)||typeof name!=='string'||name.trim().length<2||name.trim().length>120||
   !['owner','manager','cashier','stock','finance'].includes(role)||
   !['admin','owner'].includes(scope)||(scope==='owner'&&role==='owner'))throw Error('account_invalid');
  await ensureFresh();
  const response=await fetchImpl(apiURL.origin+'/functions/v1/pronto-credentials',{
   method:'POST',headers:{apikey:publishableKey,Authorization:'Bearer '+session.access_token,
    Accept:'application/json','Content-Type':'application/json'},
   cache:'no-store',credentials:'omit',redirect:'error',
   body:JSON.stringify({business_id:businessId,email:email.trim().toLowerCase(),
    display_name:name.trim(),role,scope})
  });
  let result;try{result=await response.json();}catch{throw Error('account_unavailable');}
  if(!response.ok){
   if(response.status===401){session=null;throw Error('supabase_unauthorized');}
   const known=['account_exists','not_authorized','invalid_input','association_failed','provision_partial_contact_support'];
   if(known.includes(result?.error))throw Error(result.error);
   throw Error('account_unavailable');
  }
  if(result?.ok!==true||result.email!==email.trim().toLowerCase()||
   typeof result.temporary_password!=='string'||result.temporary_password.length<16||
   typeof result.account_code!=='string'||!uuid(result.user_id))throw Error('account_response_invalid');
  return result;
 }
 async function provisionMember({email,display_name,role,business_id}){
  return provisionAccount({businessId:business_id,email,name:display_name,role,scope:'admin'});
 }
 async function provisionShopStaff({businessId,email,name,role}){
  return provisionAccount({businessId,email,name,role,scope:'owner'});
 }
 async function merchantBranches(businessId){
  if(!uuid(businessId))throw Error('shop_scope');
  const items=await call('/rest/v1/pronto_branches?select=id,name&active=eq.true&business_id=eq.'+encodeURIComponent(businessId)+'&order=name.asc');
  if(!Array.isArray(items))throw Error('supabase_response');
  return items.filter(b=>uuid(b?.id)).map(b=>({id:b.id,name:String(b.name||'Filial')}));
 }
 async function reportsSnapshot(businessId,branchId,from,to){
  if(!uuid(businessId)||(branchId!==null&&!uuid(branchId))||!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))throw Error('reports_scope');
  return normalizeReports(await call('/rest/v1/rpc/pronto_reports_snapshot',{
   method:'POST',payload:{p_business:businessId,p_branch:branchId,p_start:from,p_end:to}
  }));
 }
 async function uploadProductPhoto({businessId,branchId,productId,expectedRevision,file}){
  if(sessionLocked)throw Error('pin_screen_locked');
  if(!session)throw Error('supabase_unauthorized');
  if(!uuid(businessId)||!uuid(branchId)||!uuid(productId)||!Number.isInteger(expectedRevision)
   ||expectedRevision<0||!file||typeof file.size!=='number'||file.size<1||file.size>3145728)
   throw Error('photo_invalid');
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  const ext=types[file.type];if(!ext)throw Error('photo_mime');
  await ensureFresh();
  const path=[businessId,branchId,productId,crypto.randomUUID()+'.'+ext].join('/');
  const response=await fetchImpl(apiURL.origin+'/storage/v1/object/pronto-product-photos/'+path,{
   method:'POST',headers:{apikey:publishableKey,Authorization:'Bearer '+session.access_token,
    'Content-Type':file.type,'x-upsert':'false'},
   cache:'no-store',credentials:'omit',redirect:'error',body:file
  });
  if(!response.ok)throw Error('photo_upload_failed');
  // The DB verifies the uploaded object really belongs to the current business and product.
  return call('/rest/v1/rpc/pronto_photo_attach',{method:'POST',
   payload:{p_data:{business_id:businessId,branch_id:branchId,product_id:productId,
    photo_path:path,expected_revision:expectedRevision}}});
 }
 async function productPhotoUrl(path){
  if(typeof path!=='string'||path.length>240||
   !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(path))
   throw Error('photo_path');
  const result=await call('/storage/v1/object/sign/pronto-product-photos/'+path,{
   method:'POST',payload:{expiresIn:300}
  });
  const signed=result?.signedURL||result?.signedUrl;
  if(typeof signed!=='string')throw Error('photo_url_invalid');
  const normal=signed.startsWith('/object/sign/pronto-product-photos/')?'/storage/v1'+signed:signed;
  const u=new URL(normal,apiURL.origin);
  if(u.origin!==apiURL.origin||
   !u.pathname.startsWith('/storage/v1/object/sign/pronto-product-photos/'+path))
   throw Error('photo_url_invalid');
  return u.href;
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
 async function ownerAuditSnapshot(businessId,page=0){
  if(!uuid(businessId)||!Number.isInteger(page)||page<0||page>100)throw Error('audit_scope');
  const value=await call('/rest/v1/rpc/pronto_owner_audit_snapshot',{
   method:'POST',payload:{p_business:businessId,p_page:page,p_limit:50}
  });
  return normalizeAuditSnapshot(value);
 }
 async function ownerSuspendedCash(businessId){
  if(!uuid(businessId))throw Error('cash_scope');
  const value=await call('/rest/v1/rpc/pronto_owner_suspended_cash_snapshot',{
   method:'POST',payload:{p_business:businessId}
  });
  return normalizeSuspendedCash(value);
 }
 async function ownerCloseSuspendedCash(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||!uuid(data.business_id)||!uuid(data.session_id))throw Error('cash_scope');
  if(!Number.isSafeInteger(data.counted_cash_cents)||data.counted_cash_cents<0||
   data.counted_cash_cents>999999999999||typeof data.reason!=='string'||
   data.reason.trim().length<12||data.reason.trim().length>250)
   throw Error('cash_reconciliation_invalid');
  const result=await call('/rest/v1/rpc/pronto_owner_suspended_cash_close',{
   method:'POST',payload:{p_data:data}
  });
  if(!result||result.session_id!==data.session_id||
   typeof result.duplicate!=='boolean'||
   ![result.expected_cents,result.counted_cents,result.difference_cents].every(Number.isSafeInteger)||
   result.counted_cents!==data.counted_cash_cents||
   result.expected_cents+result.difference_cents!==result.counted_cents)
   throw Error('cash_reconciliation_response_invalid');
  return result;
 }
 async function myAccessStatus(businessId=null){
  if(businessId!==null&&!uuid(businessId))throw Error('shop_scope');
  const data=await call('/rest/v1/rpc/pronto_my_access_status',{
   method:'POST',payload:{p_business:businessId}
  });
  if(!data||typeof data.allowed!=='boolean'||typeof data.reason!=='string')
   throw Error('staff_access_response_invalid');
  return data;
 }
 async function ownerStaffAccessAction(action,data){
  if(!['mode','schedule'].includes(action)||!data||typeof data!=='object'||Array.isArray(data)
    ||!uuid(data.business_id)||!uuid(data.user_id))throw Error('staff_access_invalid');
  return call('/rest/v1/rpc/pronto_owner_staff_access_action',{
   method:'POST',payload:{p_action:action,p_data:data}
  });
 }
 async function ownerStaffSnapshot(businessId){
  if(!uuid(businessId))throw Error('shop_scope');
  const result=await call('/rest/v1/rpc/pronto_owner_staff_snapshot',{
   method:'POST',payload:{p_business:businessId}
  });
  return normalizeStaffSnapshot(result);
 }
 async function ownerStaffAction(action,data){
  if(!['role_change','suspend','reactivate'].includes(action)||
   !data||typeof data!=='object'||Array.isArray(data))throw Error('staff_action_invalid');
  return call('/rest/v1/rpc/pronto_owner_staff_action',{
   method:'POST',payload:{p_action:action,p_data:data}
  });
 }
 async function transferSnapshot(businessId){
  if(!uuid(businessId))throw Error('shop_scope');
  const value=await call('/rest/v1/rpc/pronto_transfer_snapshot',{
   method:'POST',payload:{p_business:businessId}
  });
  return normalizeTransferSnapshot(value);
 }
 async function transferAction(action,data){
  if(!['send','receive','cancel'].includes(action)||
   !data||typeof data!=='object'||Array.isArray(data))throw Error('transfer_action_invalid');
  return call('/rest/v1/rpc/pronto_transfer_action',{
   method:'POST',payload:{p_action:action,p_data:data}
  });
 }
 async function manageBranch(action,data){
  if(!['list','create','rename','deactivate','reactivate'].includes(action)||!data||typeof data!=='object'||Array.isArray(data))throw Error('branch_action_invalid');
  return call('/rest/v1/rpc/pronto_manage_branch',{method:'POST',payload:{p_action:action,p_data:data}});
 }
 async function importProductsCSV(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.items)||data.items.length>100)
   throw Error('csv_import_invalid');
  return call('/rest/v1/rpc/pronto_import_products_csv',{method:'POST',payload:{p_data:data}});
 }
 async function cashControl(action,data){
  if(!['settings','configure','snapshot','open','request_close','close','block','unblock','admin_close','note_difference'].includes(action)||
   !data||typeof data!=='object'||Array.isArray(data)||!uuid(data.business_id)||!uuid(data.branch_id))
   throw Error('cash_action_invalid');
  return call('/rest/v1/rpc/pronto_cash_control',{method:'POST',payload:{p_action:action,p_data:data}});
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
 async function recoverPinWithPassword({password,pin}){
  if(!session)throw Error('supabase_unauthorized');
  if(typeof password!=='string'||password.length<1||password.length>200||
   typeof pin!=='string'||!/^\d{5}$/.test(pin))throw Error('pin_recovery_invalid');
  await ensureFresh();
  const response=await fetchImpl(apiURL.origin+'/functions/v1/pronto-pin-recovery',{
   method:'POST',
   headers:{apikey:publishableKey,Authorization:'Bearer '+session.access_token,
    Accept:'application/json','Content-Type':'application/json'},
   cache:'no-store',credentials:'omit',redirect:'error',
   body:JSON.stringify({password,new_pin:pin})
  });
  let result;try{result=await response.json();}catch{throw Error('pin_recovery_unavailable');}
  if(!response.ok){
   if(response.status===401){session=null;throw Error('supabase_unauthorized');}
   const reason=result?.error;
   if(reason==='incorrect_password')throw Error('pin_recovery_password_incorrect');
   if(reason==='same_pin')throw Error('pin_recovery_same_pin');
   if(reason==='rate_limited'||response.status===429)throw Error('supabase_rate_limit');
   if(reason==='pin_not_configured')throw Error('pin_not_configured');
   throw Error('pin_recovery_unavailable');
  }
  if(result?.ok!==true)throw Error('pin_recovery_unavailable');
  return {ok:true};
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
 return {recoverPinWithPassword,sessionPin,lockScreen,isScreenLocked,signIn,account,adminOverview,adminMutate,provisionMember,provisionShopStaff,merchantBranches,merchantSnapshot,creditSnapshot,financeSnapshot,financeAction,holdList,holdAction,returnSnapshot,returnAction,inventorySnapshot,inventoryAction,reportsSnapshot,uploadProductPhoto,productPhotoUrl,merchantAction,cashControl,importProductsCSV,manageBranch,transferSnapshot,transferAction,ownerStaffSnapshot,ownerStaffAction,ownerStaffAccessAction,myAccessStatus,ownerAuditSnapshot,ownerSuspendedCash,ownerCloseSuspendedCash,requestPasswordRecovery,completePasswordRecovery,signOut};
}

// Pronto POS Supabase identity smoke-test (no POS writes and no persistent tokens).
// Keeps tokens in memory; pages must be re-authenticated on reload.
const validEmail = value => typeof value === 'string' && value.length > 3 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createProntoIdentity({ url, publishableKey, fetchImpl = fetch } = {}) {
 const apiURL=new URL(url||'');
 if(apiURL.protocol!=='https:' || apiURL.hostname!=='xgtpvszwzvkwysrswkek.supabase.co' || apiURL.pathname!=='/') throw Error('supabase_project');
 if(typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw Error('supabase_publishable_key');
 let session=null;
 async function call(endpoint, {method='GET', payload, authenticated=true}={}) {
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
   if(response.status===401||response.status===403)throw Error('supabase_unauthorized');
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
  session=null;
  const result=await call('/auth/v1/token?grant_type=password',{authenticated:false,method:'POST',payload:{email,password}});
  if(typeof result.access_token!=='string'||!uuid(result.user?.id))throw Error('supabase_response');
  session={access_token:result.access_token,user:{id:result.user.id}};
  try{return await account();}
  catch(error){session=null;throw error;}
 }
 async function signOut(){
  if(session){
   try{await call('/auth/v1/logout',{method:'POST'});}catch{/* Clear local token even when service unavailable. */}
  }
  session=null;
 }
 return {signIn,account,signOut};
}

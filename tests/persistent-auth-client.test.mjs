import test from 'node:test';
import assert from 'node:assert/strict';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const USER='11111111-1111-4111-8111-111111111111';
const BUSINESS='22222222-2222-4222-8222-222222222222';
const ok=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
class Storage{
 constructor(){this.data=new Map()}
 getItem(k){return this.data.get(k)??null}
 setItem(k,v){this.data.set(k,v)}
 removeItem(k){this.data.delete(k)}
}
function provider(){
 let sequence=0,offline=false,revoked=false,denied=false;
 const fetchImpl=async(url,options)=>{
  if(offline)throw Error('offline');
  if(url.includes('grant_type=password'))return ok(200,{
   access_token:'initialAccess',refresh_token:'firstRefresh123',user:{id:USER},expires_in:300});
  if(url.includes('grant_type=refresh_token')){
   if(revoked)return ok(401,{error:'invalid'});
   sequence++;
   return ok(200,{access_token:'renewedAccess'+sequence,refresh_token:'freshRefresh'+sequence,
    user:{id:USER},expires_in:3600});
  }
  if(url.endsWith('/auth/v1/user'))return ok(200,{id:USER,email:'merchant@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return ok(200,false);
  if(url.includes('pronto_memberships?'))return ok(200,[{business_id:BUSINESS,role:'owner',active:true}]);
  if(url.includes('pronto_businesses?'))return ok(200,[{id:BUSINESS,name:'Shop',status:'active'}]);
  if(url.endsWith('/rest/v1/rpc/pronto_merchant_action'))return denied?ok(403,{}):ok(200,{ok:true});
  if(url.endsWith('/rest/v1/rpc/pronto_session_pin'))return ok(200,{ok:true});
  if(url.endsWith('/auth/v1/logout'))return ok(200,{});
  return ok(404,{});
 };
 return {fetchImpl,setOffline:v=>offline=v,setRevoked:v=>revoked=v,setDenied:v=>denied=v};
}
const create=(p,storage)=>createProntoIdentity({...prontoSupabaseConfig,fetchImpl:p.fetchImpl,storage});
test('Login stays on same device; only refresh credential is saved, and rights are reloaded',async()=>{
 const p=provider(),storage=new Storage(),first=create(p,storage);
 const user=await first.signIn('merchant@example.org','user-password');
 assert.equal(user.grants[0].role,'owner');
 const text=[...storage.data.values()][0];
 assert.match(text,/firstRefresh123/);
 assert.doesNotMatch(text,/initialAccess|user-password/);
 const second=create(p,storage);
 const resumed=await second.restoreSession();
 assert.equal(resumed.userId,USER);
 assert.equal(second.isScreenLocked(),true);
 assert.match([...storage.data.values()][0],/freshRefresh1/);
 await assert.rejects(()=>second.merchantAction('product_create',{}),/pin_screen_locked/);
 await second.sessionPin('verify','12345');
 await second.merchantAction('product_create',{});
 await second.signOut();
 assert.equal(storage.data.size,0);
 assert.equal(await create(p,storage).restoreSession(),null);
});
test('Network interruption retains login, but revoked credentials are cleared',async()=>{
 const p=provider(),storage=new Storage();
 await create(p,storage).signIn('merchant@example.org','user-password');
 p.setOffline(true);
 const client=create(p,storage);
 await assert.rejects(()=>client.restoreSession(),/supabase_unavailable/);
 assert.equal(storage.data.size,1);
 p.setOffline(false);
 assert.equal((await client.restoreSession()).userId,USER);
 const again=create(p,storage);
 p.setRevoked(true);
 await assert.rejects(()=>again.restoreSession(),/supabase_unauthorized/);
 assert.equal(storage.data.size,0);
});
test('A forbidden merchant action does not silently terminate valid authentication',async()=>{
 const p=provider(),storage=new Storage(),auth=create(p,storage);
 await auth.signIn('merchant@example.org','user-password');
 p.setDenied(true);
 await assert.rejects(()=>auth.merchantAction('product_create',{}),/supabase_forbidden/);
 assert.equal((await auth.account()).userId,USER);
 assert.equal(storage.data.size,1);
});

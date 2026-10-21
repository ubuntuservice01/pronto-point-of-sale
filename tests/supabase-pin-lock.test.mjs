import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {PIN_IDLE_MS,pinError,pinScreen} from '../src/supabase-pin-lock.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';

const ID='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const response=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json'}});
function mock(){
 let configured=false,pin='',attempts=0,locked=false;
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const payload=options.body?JSON.parse(options.body):null;
  calls.push({url,method:options.method,auth:options.headers.Authorization||null,payload});
  if(url.endsWith('/auth/v1/token?grant_type=password'))return response(200,{access_token:'mock-jwt',user:{id:ID},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return response(200,{id:ID,email:'seller@example.org'});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(200,false);
  if(url.includes('/rest/v1/pronto_memberships?'))return response(200,[{business_id:B,role:'owner',active:true}]);
  if(url.includes('/rest/v1/pronto_businesses?'))return response(200,[{id:B,name:'Loja Beta',status:'active'}]);
  if(url.endsWith('/rest/v1/rpc/pronto_session_pin')){
   const {p_action,p_pin,p_current_pin}=payload;
   if(p_action==='status')return response(200,{configured,retry_after_seconds:0});
   if(p_action==='create'){
    if(configured)return response(200,{ok:false,reason:'already_configured'});
    configured=true;pin=p_pin;return response(200,{ok:true,configured:true});
   }
   if(locked)return response(200,{ok:false,reason:'temporarily_blocked',retry_after_seconds:900});
   if(p_action==='verify'||p_action==='change'){
    if((p_action==='verify'?p_pin:p_current_pin)!==pin){
     attempts++;
     if(attempts>=5){locked=true;return response(200,{ok:false,reason:'temporarily_blocked',retry_after_seconds:900});}
     return response(200,{ok:false,reason:'incorrect_pin',remaining_attempts:5-attempts});
    }
    attempts=0;if(p_action==='change')pin=p_pin;
    return response(200,{ok:true,configured:true});
   }
  }
  if(url.endsWith('/rest/v1/rpc/pronto_merchant_action'))return response(200,{ok:true});
  if(url.endsWith('/functions/v1/pronto-credentials'))return response(201,{ok:true,email:'m@example.org',temporary_password:'Long-Temporary-Password-4455',account_code:'POS-22222222',user_id:'22222222-2222-4222-8222-222222222222'});
  if(url.endsWith('/auth/v1/logout'))return response(200,{});
  return response(404,{message:'Not Found'});
 };
 return {calls,fetchImpl};
}
test('PIN screen renders five digits, Portuguese labels and clear lock controls',()=>{
 assert.equal(PIN_IDLE_MS,180000);
 const html=pinScreen({mode:'unlock',email:'seller@example.org'});
 assert.match(html,/Ecrã bloqueado/);
 assert.match(html,/Desbloquear/);
 assert.equal((html.match(/<span><\/span>/g)||[]).length,5);
 assert.equal((html.match(/data-pin-key=/g)||[]).length,12);
 assert.match(pinScreen({mode:'create'}),/Criar PIN de 5 dígitos/);
 assert.match(pinScreen({mode:'change'}),/PIN actual/);
 assert.ok(!pinScreen({email:'<script>alert(1)</script>'}).includes('<script>'));
 assert.match(pinError({reason:'incorrect_pin',remaining_attempts:2}),/2 tentativas/);
 assert.match(pinError({reason:'temporarily_blocked',retry_after_seconds:900}),/15 minutos/);
});
test('PIN is set only after Supabase Auth; locked browser client denies POS writes until server confirms PIN',async()=>{
 const fake=mock(),client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:fake.fetchImpl});
 const account=await client.signIn('seller@example.org','strong-long-password');
 assert.equal(account.grants[0].role,'owner');
 assert.deepEqual(await client.sessionPin('status'),{configured:false,retry_after_seconds:0});
 assert.deepEqual(await client.sessionPin('create','58264'),{ok:true,configured:true});
 client.lockScreen();
 assert.equal(client.isScreenLocked(),true);
 await assert.rejects(()=>client.merchantAction('product_create',{business_id:B}),/pin_screen_locked/);
 await assert.rejects(()=>client.provisionShopStaff({businessId:B,email:'m@example.org',name:'Maria',role:'cashier'}),/pin_screen_locked/);
 assert.equal((await client.sessionPin('verify','00000')).ok,false);
 assert.equal(client.isScreenLocked(),true);
 assert.equal((await client.sessionPin('verify','58264')).ok,true);
 assert.equal(client.isScreenLocked(),false);
 await client.merchantAction('product_create',{business_id:B});
 await client.provisionShopStaff({businessId:B,email:'m@example.org',name:'Maria',role:'cashier'});
 const calls=fake.calls.filter(c=>c.url.endsWith('/rpc/pronto_session_pin'));
 assert.equal(calls.length,4);
 assert.ok(calls.every(c=>c.auth==='Bearer mock-jwt'));
 assert.ok(calls.every(c=>!JSON.stringify(c).includes('sb_secret_')));
 await assert.rejects(()=>client.sessionPin('create','abc12'),/pin_five_digits/);
 await assert.rejects(()=>client.sessionPin('create','123456'),/pin_five_digits/);
 await client.signOut();
 await assert.rejects(()=>client.sessionPin('status'),/supabase_unauthorized/);
});
test('Only the global admin may create owners; shop owner cannot elevate staff',async()=>{
 const fake=mock(),client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl:fake.fetchImpl});
 await client.signIn('seller@example.org','password');
 await assert.rejects(()=>client.provisionShopStaff({businessId:B,email:'a@example.org',name:'Ana',role:'owner'}),/account_invalid/);
 await assert.rejects(()=>client.provisionShopStaff({businessId:B,email:'a@example.org',name:'Ana',role:'super_admin'}),/account_invalid/);
 await assert.rejects(()=>client.provisionShopStaff({businessId:'bad',email:'a@example.org',name:'Ana',role:'cashier'}),/account_invalid/);
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 assert.match(ui,/data-shop-form="team_invite"/);
 assert.match(ui,/PIN de cinco dígitos/);
});
test('Migrations enforce hashed PIN, 5-attempt rate limit, and owner-scoped invitations',()=>{
 const pin=readFileSync(new URL('../supabase/migrations/20261015163000_session_pin.sql',import.meta.url),'utf8');
 const owner=readFileSync(new URL('../supabase/migrations/20261015164500_owner_staff_onboarding.sql',import.meta.url),'utf8');
 assert.match(pin,/extensions\.crypt\(/);
 assert.match(pin,/extensions\.gen_salt\('bf',12\)/);
 assert.match(pin,/failed_attempts/);
 assert.match(pin,/interval '15 minutes'/);
 assert.match(pin,/revoke all on pronto_private\.session_pins from public, anon, authenticated/);
 assert.match(owner,/pronto_private\.member_role\(p_business\)='owner'/);
 assert.match(owner,/p_role not in \('manager','cashier','stock','finance'\)/);
 assert.match(owner,/global_admin_cannot_join_shop/);
 const corrected=readFileSync(new URL('../supabase/migrations/20261015170000_owner_scope_explicit_deny.sql',import.meta.url),'utf8');
 assert.match(corrected,/coalesce\(pronto_private\.member_role\(p_business\),'\'\)/);
 assert.match(corrected,/coalesce\(pronto_private\.member_role\(p_business\)='owner',false\)/);
 const legacy=readFileSync(new URL('../supabase/functions/pronto-owner-invite/index.ts',import.meta.url),'utf8');
 assert.match(legacy,/legacy_invitation_disabled/);
 assert.match(legacy,/status:410/);
});

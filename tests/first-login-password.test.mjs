import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pinScreen} from '../src/supabase-pin-lock.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {credentialsText} from '../src/pronto-credentials-ui.js';

const USER='11111111-1111-4111-8111-111111111111';
const BIZ='22222222-2222-4222-8222-222222222222';
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('First-login screen asks for a personal password before the PIN keypad',()=>{
 const html=pinScreen({mode:'password',email:'caixa@example.org'});
 assert.match(html,/Criar nova palavra-passe/);
 assert.match(html,/Passo 1 de 2/);
 assert.match(html,/name="current_password"/);
 assert.match(html,/name="new_password"/);
 assert.match(html,/name="confirm_password"/);
 assert.match(html,/autocomplete="new-password"/);
 assert.doesNotMatch(html,/data-pin-key=/);
 assert.match(pinScreen({mode:'create'}),/Passo 2 de 2/);
 const initial=credentialsText({ok:true,email:'caixa@example.org',
  temporary_password:'safe-temporary-pass-123',account_code:'POS-12345678'},'https://example.org');
 assert.match(initial,/altere a palavra-passe provisória e depois crie/);
});
test('Server marker survives login/restore and clears only after a confirmed Auth password update',async()=>{
 let requiresChange=true,updates=0;
 const requests=[];
 const fetchImpl=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;
  requests.push({url,method:options.method,body});
  if(url.endsWith('/auth/v1/token?grant_type=password'))return response(200,{
   access_token:'mock-access',refresh_token:'mock-refresh',user:{id:USER},expires_in:3600
  });
  if(url.endsWith('/auth/v1/user')&&options.method==='PUT'){
   updates++;
   assert.equal(body.current_password,'Initial-pass-4455');
   assert.equal(body.password,'New-long-password-5566');
   requiresChange=false;return response(200,{id:USER});
  }
  if(url.endsWith('/auth/v1/user'))return response(200,{id:USER,email:'caixa@example.org',
   app_metadata:requiresChange?{pronto_password_change_required:true}:{}});
  if(url.endsWith('/rest/v1/rpc/pronto_admin_status'))return response(200,false);
  if(url.includes('/rest/v1/pronto_memberships?'))return response(200,[{business_id:BIZ,role:'cashier',active:true}]);
  if(url.includes('/rest/v1/pronto_businesses?'))return response(200,[{id:BIZ,name:'Loja',status:'active'}]);
  if(url.endsWith('/auth/v1/logout'))return response(200,{});
  return response(404,{message:'not found'});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl,storage:{
   getItem:()=>null,setItem:()=>{},removeItem:()=>{}
 }});
 const account=await client.signIn('caixa@example.org','Initial-pass-4455');
 assert.equal(account.requiresPasswordChange,true);
 client.lockScreen();
 await assert.rejects(()=>client.changeInitialPassword('Initial-pass-4455','short'),/password_setup_invalid/);
 await assert.rejects(()=>client.changeInitialPassword('Initial-pass-4455','Initial-pass-4455'),/password_setup_same/);
 assert.equal(updates,0);
 assert.equal(await client.changeInitialPassword('Initial-pass-4455','New-long-password-5566'),true);
 assert.equal(updates,1);
 // A password change does not bypass the PIN guard or unlock shop operations.
 assert.equal(client.isScreenLocked(),true);
 assert.equal((await client.account().catch(e=>e.message)),'pin_screen_locked');
 client.unlockReloadedScreen();
 assert.equal((await client.account()).requiresPasswordChange,undefined);
 await client.signOut();
});
test('Trusted marker comes from server admin provisioning, not editable user metadata',()=>{
 const edge=readFileSync(new URL('../supabase/functions/pronto-credentials/index.ts',import.meta.url),'utf8');
 const identity=readFileSync(new URL('../src/supabase-identity.js',import.meta.url),'utf8');
 const pin=readFileSync(new URL('../src/supabase-pin-lock.js',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../supabase/migrations/20261026120000_first_login_password_setup.sql',import.meta.url),'utf8');
 assert.match(edge,/app_metadata:\{pronto_password_change_required:true\}/);
 assert.match(identity,/user\.app_metadata\?\.pronto_password_change_required===true/);
 assert.match(identity,/current_password:currentPassword,password:newPassword/);
 assert.match(pin,/account\.requiresPasswordChange===true/);
 assert.match(pin,/await client\.changeInitialPassword\(currentPassword,newPassword\)/);
 assert.match(sql,/before update of encrypted_password on auth\.users/);
 assert.match(sql,/before insert on pronto_private\.session_pins/);
 assert.doesNotMatch(sql,/raw_user_meta_data/);
});

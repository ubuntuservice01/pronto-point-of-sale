import test from 'node:test';
import assert from 'node:assert/strict';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
import {shopDraftKey,makeShopDraft,encryptShopDraft,decryptShopDraft,saveShopDraft,restoreShopDraft,hasShopDraft,clearShopDraft} from '../src/supabase-shop-draft.js';
import {extractRecoveryFromHash} from '../src/supabase-recovery-ui.js';
import {renderShopScreen,shopPaymentPanel} from '../src/supabase-shop-ui.js';
const U='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',P='44444444-4444-4444-8444-444444444444';
const scope={userId:U,businessId:B,branchId:C};
const pending={business_id:B,branch_id:C,session_id:P,idempotency_key:U,
 items:[{product_id:P,quantity:1}],discount_cents:0,cash_received_cents:2000,
 allocations:[{method:'cash',amount_cents:2000},{method:'emola',amount_cents:5000}]};
const password='Uma-frase-segura-2026!';
const draft=()=>makeShopDraft({scope,cart:[{productId:P,quantity:1}],method:'mixed',discount:'0',pending});
const storage=()=>{const entries=new Map();return {
 getItem:key=>entries.has(key)?entries.get(key):null,
 setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)
}};
const response=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('Encrypted merchant drafts preserve the same sale idempotency key without retaining JWT/password in clear text',async()=>{
 const draftData=draft();
 const encrypted=await encryptShopDraft(draftData,scope,password);
 assert.ok(encrypted.startsWith('{"v":1,'));
 assert.ok(!encrypted.includes('emola')&&!encrypted.includes('2000')&&!encrypted.includes(password));
 assert.ok(!encrypted.includes(U));
 const decoded=await decryptShopDraft(encrypted,scope,password);
 assert.deepEqual(decoded,draftData);
 assert.equal(decoded.pending.idempotency_key,U);
 const vault=storage();
 await saveShopDraft(vault,scope,password,draftData);
 assert.equal(hasShopDraft(vault,scope),true);
 assert.deepEqual(await restoreShopDraft(vault,scope,password),draftData);
 clearShopDraft(vault,scope);
 assert.equal(hasShopDraft(vault,scope),false);
});
test('Wrong phrase, another user/shop/branch or tampering never decrypts an offline cart',async()=>{
 const encrypted=await encryptShopDraft(draft(),scope,password);
 await assert.rejects(()=>decryptShopDraft(encrypted,scope,'wrong-passphrase-12345'),/draft_unlock_failed/);
 for(const change of [{userId:P},{businessId:C},{branchId:P}]){
  await assert.rejects(()=>decryptShopDraft(encrypted,{...scope,...change},password),/draft_unlock_failed/);
 }
 const altered=JSON.parse(encrypted);altered.c=altered.c.slice(0,-3)+'AAA';
 await assert.rejects(()=>decryptShopDraft(JSON.stringify(altered),scope,password),/draft_unlock_failed/);
 await assert.rejects(()=>encryptShopDraft(draft(),scope,'123'),/draft_passphrase/);
 assert.notEqual(shopDraftKey(U,B,C),shopDraftKey(U,C,B));
});
test('Offline backup cannot be used as a POS transaction or altered to point at a second business',()=>{
 assert.throws(()=>makeShopDraft({scope,cart:[{productId:P,quantity:1}],method:'mixed',discount:'0',
  pending:{...pending,business_id:C}}),/draft_payload/);
 assert.throws(()=>makeShopDraft({scope,cart:[{productId:P,quantity:1}],method:'untrusted',discount:'0',pending:null}),/draft_payload/);
});
test('Password recovery requests use public key and site-specific approved redirect, never service role',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/auth/v1/recover'))return response(200,{});
  if(url.endsWith('/auth/v1/user')&&options.method==='GET')return response(200,{id:U,email:'owner@example.org'});
  if(url.endsWith('/auth/v1/user')&&options.method==='PUT')return response(200,{id:U});
  return response(404,{});
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.requestPasswordRecovery('owner@example.org','https://pronto.example.com/?mode=supabase&reset-password=1');
 assert.equal(calls[0].options.headers.apikey,prontoSupabaseConfig.publishableKey);
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.match(calls[0].url,/redirect_to=/);
 assert.doesNotMatch(JSON.stringify(calls),/sb_secret_|service_role/);
 await assert.rejects(()=>client.requestPasswordRecovery('bad','https://pronto.example.com/?mode=supabase&reset-password=1'),/supabase_invalid_credentials/);
 await assert.rejects(()=>client.requestPasswordRecovery('owner@example.org','http://danger.example.com/?mode=supabase&reset-password=1'),/recovery_redirect/);
 const token='valid-recovery-token-length-1234';
 await client.completePasswordRecovery(token,'UmaNovaPalavraPasse1234');
 assert.equal(calls.at(-1).options.method,'PUT');
 assert.equal(JSON.parse(calls.at(-1).options.body).password,'UmaNovaPalavraPasse1234');
 assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+token);
 await assert.rejects(()=>client.completePasswordRecovery(token,'short'),/recovery_password/);
});
test('Recovery link tokens are removed from URL before password form appears',()=>{
 let cleaned='';
 const location={hash:'#type=recovery&access_token=secret123&refresh_token=refresh-secret',pathname:'/pos',search:'?mode=supabase'};
 const result=extractRecoveryFromHash(location,{replaceState:(_a,_b,url)=>cleaned=url});
 assert.equal(result.token,'secret123');
 assert.equal(cleaned,'/pos?mode=supabase');
});
test('Cashier sees neither stock administration nor discount control; stock user cannot see checkout',()=>{
 const product={id:P,name:'Arroz',code:'PR-000001',category:'Geral',unit:'kg',priceCents:7000,stock:5,minStock:1};
 const state={products:[product],branches:[{id:C,name:'Principal'}],sessions:[{id:P,operatorId:U,openedAt:new Date().toISOString(),openingCash:0}],sales:[]};
 const account={userId:U,email:'caixa@example.org',grants:[{id:B,name:'Loja A',role:'cashier'}]};
 const base={account,grants:account.grants,grant:account.grants[0],branches:state.branches,branchId:C,data:state,cart:[{productId:P,quantity:1}],view:'sell',method:'cash',discount:'0',query:'',feedback:'',pending:null,draftAvailable:true};
 const cashier=renderShopScreen(base);
 assert.ok(!cashier.includes('data-shop-view="products"'));
 assert.ok(cashier.includes('Desconto (requer gerente)'));
 assert.ok(cashier.includes('Guardar rascunho encriptado'));
 assert.ok(cashier.includes('Recuperar rascunho'));
 const stock=renderShopScreen({...base,grant:{...base.grant,role:'stock'},view:'products'});
 assert.ok(!stock.includes('data-shop-view="sell"'));
 assert.ok(stock.includes('data-shop-view="products"'));
 assert.ok(!stock.includes('data-shop-view="history"'));
 assert.match(shopPaymentPanel({method:'cash',cart:base.cart,products:state.products,role:'cashier',session:state.sessions[0]}),/disabled/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
 saveOfflineCash,restoreOfflineCash,offlineCashKeys,hasOfflineCash,clearOfflineCash
} from '../src/supabase-cash-offline.js';
import {renderCashManagement,normalizeCashControl} from '../src/supabase-cash-ui.js';
const u='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const branch='33333333-3333-4333-8333-333333333333';
const s='44444444-4444-4444-8444-444444444444';
const key='55555555-5555-4555-8555-555555555555';
const scope={userId:u,businessId:b,branchId:branch};
class Store{
 constructor(){this.data=new Map()}
 get length(){return this.data.size}
 key(i){return [...this.data.keys()][i]??null}
 getItem(k){return this.data.get(k)??null}
 setItem(k,v){this.data.set(k,v)}
 removeItem(k){this.data.delete(k)}
}
const payload={business_id:b,branch_id:branch,session_id:s,
 idempotency_key:key,direction:'in',amount_cents:10000,reason:'Reforço para trocos'};
const pass='Senha longa e confidencial @2026';
test('Offline movement is AES-GCM encrypted, scoped and retained on repeated save',async()=>{
 const store=new Store();
 const first=await saveOfflineCash(store,scope,pass,payload);
 assert.equal(first,key);
 const keys=offlineCashKeys(store,scope);
 assert.equal(keys.length,1);assert.equal(hasOfflineCash(store,scope),true);
 const ciphertext=store.getItem(keys[0]);
 assert.doesNotMatch(ciphertext,/Reforço para trocos|10000|business_id/);
 assert.deepEqual(await restoreOfflineCash(store,scope,pass,keys[0]),payload);
 // Retry must retain the original idempotency key and not produce a duplicate.
 await saveOfflineCash(store,scope,pass,payload);
 assert.equal(offlineCashKeys(store,scope).length,1);
 await assert.rejects(()=>restoreOfflineCash(store,scope,'wrong secret long',keys[0]),/unlock_failed/);
 clearOfflineCash(store,scope,keys[0]);
 assert.equal(hasOfflineCash(store,scope),false);
});
test('Offline drafts never cross merchant, branch or user boundaries',async()=>{
 const store=new Store();await saveOfflineCash(store,scope,pass,payload);
 const other={...scope,businessId:'66666666-6666-4666-8666-666666666666'};
 assert.equal(offlineCashKeys(store,other).length,0);
 await assert.rejects(()=>restoreOfflineCash(store,other,pass,offlineCashKeys(store,scope)[0]),/unlock_failed/);
 assert.throws(()=>clearOfflineCash(store,other,offlineCashKeys(store,scope)[0]),/cash_draft_scope/);
});
test('Cannot save malformed cash movement or short protection phrase',async()=>{
 const store=new Store();
 await assert.rejects(()=>saveOfflineCash(store,scope,'short',payload),/passphrase/);
 await assert.rejects(()=>saveOfflineCash(store,scope,pass,{...payload,amount_cents:0}),/invalid/);
 await assert.rejects(()=>saveOfflineCash(store,scope,pass,{...payload,business_id:'77777777-7777-4777-8777-777777777777'}),/invalid/);
 await assert.rejects(()=>saveOfflineCash(store,scope,pass,{...payload,idempotency_key:'not-uuid'}),/invalid/);
 assert.equal(store.length,0);
});
test('Cash page displays explicit sync and warning without claiming offline settlement',()=>{
 const snapshot=normalizeCashControl({
  policy:{opening_required:true,blind_close:true},
  sessions:[{id:s,operator_id:u,branch_id:branch,operator_name:'Operadora Ana',
   terminal:'CAIXA-01',opened_at:'2026-10-21T07:00:00Z',status:'open',
   opening_cash_cents:0,expected_cash_cents:null,counted_cash_cents:null,
   difference_cents:null,payments_by_method:null}]
 });
 const html=renderCashManagement({cash:snapshot,account:{userId:u},role:'cashier',pendingOffline:2});
 assert.match(html,/Movimentos offline por confirmar \(2\)/);
 assert.match(html,/data-shop-form="cash_offline_sync"/);
 assert.match(html,/não alteraram o saldo/i);
 assert.match(html,/name="physical_confirmed"/);
});

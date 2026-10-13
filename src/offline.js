// Offline authenticated cash sales. Encrypted IndexedDB vault, never a fake server commit.
// Pending sales remain provisional until confirmed by the backend; conflicts require review.
const DB_NAME='pronto-pos-secure-offline',VERSION=1,STORE='vault';
const RECORD='active';
const MAX_AGE=8*60*60*1000;
const ITERATIONS=240000;
let vault=null,key=null,writing=Promise.resolve();
const encode=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(raw);};
const decode=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));
const b64=buffer=>encode(new Uint8Array(buffer));
const db=()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open(DB_NAME,VERSION);
 request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
 request.onsuccess=()=>resolve(request.result);
 request.onerror=()=>reject(request.error);
});
async function record(action,value){
 const database=await db();
 try{return await new Promise((resolve,reject)=>{
  const tx=database.transaction(STORE,action==='get'?'readonly':'readwrite'),store=tx.objectStore(STORE);
  const req=action==='get'?store.get(RECORD):action==='delete'?store.delete(RECORD):store.put(value,RECORD);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
  tx.onerror=()=>reject(tx.error);
 });}finally{database.close();}
}
async function derive(passphrase,salt){
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function persist(){
 if(!vault||!key)throw Error('offline_locked');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=new TextEncoder().encode(JSON.stringify(vault));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
 const previous=await record('get');
 if(!previous?.salt)throw Error('offline_missing');
 await record('put',{v:1,salt:previous.salt,iv:b64(iv),data:b64(encrypted),pendingCount:vault.pending.length,userId:vault.userId});
}
function write(fn){
 const next=writing.then(fn,fn);
 writing=next.catch(()=>{});
 return next;
}
export function offlineUnlocked(){return !!(vault&&key);}
export function offlinePending(){return vault?.pending.length||0;}
export function offlinePendingItems(){return (vault?.pending||[]).map(({id,status,reason})=>({id,status,reason}));}
export function offlineSnapshot(){
 if(!offlineUnlocked())throw Error('offline_locked');
 if(Date.now()>vault.validUntil)throw Error('offline_expired');
 return vault.snapshot;
}
export async function hasOfflineVault(){try{return !!(await record('get'))?.data;}catch{return false;}}
export async function offlineVaultInfo(){const info=await record('get');return info?{pendingCount:info.pendingCount||0,userId:info.userId}:null;}
export async function enableOffline(passphrase,state,tenantId){
 if(typeof passphrase!=='string'||passphrase.length<12||passphrase.length>200)throw Error('offline_passphrase');
 if(!state?.auth?.id||!tenantId||!state.tenants.some(t=>t.id===tenantId))throw Error('offline_auth');
 if((await record('get'))?.pendingCount>0)throw Error('offline_pending');
 const salt=crypto.getRandomValues(new Uint8Array(16));
 key=await derive(passphrase,salt);
 vault={v:1,userId:state.auth.id,tenantId,verifiedAt:Date.now(),validUntil:Date.now()+MAX_AGE,snapshot:state,pending:[]};
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(vault)));
 await record('put',{v:1,salt:b64(salt),iv:b64(iv),data:b64(cipher),pendingCount:0,userId:vault.userId});
 return {tenantId,userId:vault.userId,validUntil:vault.validUntil};
}
export async function unlockOffline(passphrase,expectedUserId=null){
 const saved=await record('get');
 if(!saved?.data)throw Error('offline_not_configured');
 if(typeof passphrase!=='string'||!passphrase)throw Error('offline_locked');
 const candidate=await derive(passphrase,decode(saved.salt));
 let content;
 try{const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(saved.iv)},candidate,decode(saved.data));content=JSON.parse(new TextDecoder().decode(decrypted));}
 catch{throw Error('offline_bad_passphrase');}
 if(expectedUserId&&expectedUserId!==content.userId)throw Error('offline_wrong_user');
 if(Date.now()>content.validUntil)throw Error('offline_expired');
 if(!content?.snapshot?.auth||content.snapshot.auth.id!==content.userId||content.tenantId!==content.snapshot.tenants?.[0]?.id)throw Error('offline_invalid');
 vault=content;key=candidate;
 return vault.snapshot;
}
export async function rememberVerifiedSnapshot(state,tenantId){
 if(!offlineUnlocked()||vault.userId!==state?.auth?.id||vault.tenantId!==tenantId)return;
 if(vault.pending.length)return; // Never overwrite provisional sales before sync.
 return write(async()=>{
  vault.snapshot=state;vault.verifiedAt=Date.now();vault.validUntil=Date.now()+MAX_AGE;
  await persist();
 });
}
export function offlineSaleBody(old,next){
 if(!old||!next||!Array.isArray(old.sales)||!Array.isArray(next.sales))throw Error('offline_unsupported');
 const fresh=next.sales.filter(s=>!old.sales.some(x=>x.id===s.id));
 if(fresh.length!==1||next.sales.length!==old.sales.length+1)throw Error('offline_unsupported');
 const sale=fresh[0];
 if(sale.method!=='cash'||sale.customerId||sale.discount||!Number.isSafeInteger(sale.received)||sale.received<sale.total)throw Error('offline_cash_only');
 if(!Array.isArray(sale.lines)||!sale.lines.length||sale.lines.length>500)throw Error('offline_unsupported');
 return {id:sale.id,tenantId:sale.tenantId,cart:sale.lines.map(l=>({productId:l.productId,quantity:l.quantity})),method:'cash',received:sale.received,discount:0};
}
export async function queueOfflineSale(old,next,body){
 if(!offlineUnlocked()||Date.now()>vault.validUntil)throw Error('offline_locked');
 if(vault.userId!==old?.auth?.id||vault.tenantId!==body.tenantId)throw Error('offline_wrong_user');
 if(!navigator.locks?.request)throw Error('offline_browser_unsupported');
 return navigator.locks.request('pronto-offline-sales',()=>write(async()=>{
  if(vault.pending.some(p=>p.id===body.id))throw Error('offline_duplicate');
  if(vault.pending.length>=100)throw Error('offline_queue_full');
  const sale=next.sales.find(s=>s.id===body.id);
  if(!sale)throw Error('offline_unsupported');
  const local={...next,sales:next.sales.map(s=>s.id===body.id?{...s,syncStatus:'pending'}:s)};
  vault.pending.push({id:body.id,body,status:'pending',reason:''});
  vault.snapshot=local;
  await persist();return local;
 }));
}
export async function pendingSync(send){
 if(!offlineUnlocked())return {status:'locked',confirmed:0,pending:0};
 if(Date.now()>vault.validUntil)return {status:'expired',confirmed:0,pending:vault.pending.length};
 if(!navigator.onLine)return {status:'offline',confirmed:0,pending:vault.pending.length};
 let confirmed=0;
 return write(async()=>{
  while(vault.pending.length){
   const item=vault.pending[0];
   if(item.status==='conflict')break;
   let snapshot;
   try{snapshot=await send(item.body);}
   catch(error){
    // Unknown transport errors may have committed remotely: same UUID is retried safely.
    if(['stock','stock_expired_or_insufficient','idempotency_conflict','cash_not_open','product','permission','forbidden','business_suspended','license_expired','license_cancelled'].includes(error.message)){
     item.status='conflict';item.reason=error.message;await persist();
     return {status:'conflict',confirmed,pending:vault.pending.length,error:error.message};
    }
    await persist();return {status:'retry',confirmed,pending:vault.pending.length,error:error.message};
   }
   if(!snapshot?.sales?.some(s=>s.id===item.id)){item.status='conflict';item.reason='not_confirmed';await persist();return {status:'conflict',confirmed,pending:vault.pending.length,error:'not_confirmed'};}
   vault.pending.shift();confirmed++;
   // Keep the locally queued remainder intact while sending sequentially.
   if(!vault.pending.length){vault.snapshot=snapshot;vault.verifiedAt=Date.now();vault.validUntil=Date.now()+MAX_AGE;}
   await persist();
  }
  return {status:'ok',confirmed,pending:vault.pending.length};
 });
}
export async function discardRejectedSale(id,confirmedState){
 if(!offlineUnlocked()||!vault.pending.find(x=>x.id===id&&x.status==='conflict'))throw Error('offline_not_conflicted');
 // User must explicitly resolve a rejected provisional sale; never silently discard.
 return write(async()=>{
  vault.pending=vault.pending.filter(x=>x.id!==id);
  if(!vault.pending.length){vault.snapshot=confirmedState;vault.verifiedAt=Date.now();vault.validUntil=Date.now()+MAX_AGE;}
  await persist();return vault.pending.length;
 });
}
export async function eraseOffline(){
 vault=null;key=null;
 try{await record('delete');}catch{}
}

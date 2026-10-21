// Offline cash MOVEMENT drafts: encrypted, tenant scoped and never replayed automatically.
// They have no effect on ledger balances until the user explicitly sends them online.
// Same idempotency key is retained on retries.
const enc=new TextEncoder(),dec=new TextDecoder();
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const ub64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
const passOk=x=>typeof x==='string'&&x.length>=12&&x.length<=128;
const scopeKey=scope=>{
 if(!scope||![scope.userId,scope.businessId,scope.branchId].every(uuid))throw Error('cash_draft_scope');
 return 'pronto-cash-move-v1:'+scope.userId+':'+scope.businessId+':'+scope.branchId+':';
};
const validPayload=(p,scope)=>{
 if(!p||!uuid(p.session_id)||!uuid(p.idempotency_key)||!['in','out'].includes(p.direction)||
  !Number.isSafeInteger(p.amount_cents)||p.amount_cents<=0||p.amount_cents>999999999999||
  typeof p.reason!=='string'||p.reason.trim().length<3||p.reason.length>180||
  p.business_id!==scope.businessId||p.branch_id!==scope.branchId)throw Error('cash_draft_invalid');
 return p;
};
async function keyFor(pass,salt){
 const raw=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},
  raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export function offlineCashKeys(storage,scope){
 const prefix=scopeKey(scope),ids=[];
 for(let i=0;i<storage.length;i++){
  const k=storage.key(i);
  if(k?.startsWith(prefix)&&uuid(k.slice(prefix.length)))ids.push(k);
 }
 return ids;
}
export function hasOfflineCash(storage,scope){return offlineCashKeys(storage,scope).length>0;}
export async function saveOfflineCash(storage,scope,pass,payload){
 if(!passOk(pass))throw Error('cash_draft_passphrase');
 const prefix=scopeKey(scope),p=validPayload(payload,scope);
 const existing=offlineCashKeys(storage,scope);
 if(existing.length>=20&&!existing.includes(prefix+p.idempotency_key))throw Error('cash_draft_limit');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(prefix)},
  await keyFor(pass,salt),enc.encode(JSON.stringify(p)));
 const record=JSON.stringify({v:1,s:b64(salt),i:b64(iv),c:b64(new Uint8Array(encrypted))});
 storage.setItem(prefix+p.idempotency_key,record);
 return p.idempotency_key;
}
export async function restoreOfflineCash(storage,scope,pass,key){
 const prefix=scopeKey(scope);
 if(!passOk(pass)||typeof key!=='string'||!key.startsWith(prefix))throw Error('cash_draft_unlock_failed');
 const raw=storage.getItem(key);
 if(!raw||raw.length>6000)throw Error('cash_draft_missing');
 try{
  const env=JSON.parse(raw);if(env.v!==1)throw Error();
  const salt=ub64(env.s),iv=ub64(env.i),cipher=ub64(env.c);
  if(salt.length!==16||iv.length!==12||cipher.length<17)throw Error();
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(prefix)},
    await keyFor(pass,salt),cipher);
  const p=validPayload(JSON.parse(dec.decode(decrypted)),scope);
  if(prefix+p.idempotency_key!==key)throw Error();
  return p;
 }catch{throw Error('cash_draft_unlock_failed');}
}
export function clearOfflineCash(storage,scope,key){
 if(typeof key!=='string'||!key.startsWith(scopeKey(scope)))throw Error('cash_draft_scope');
 storage.removeItem(key);
}

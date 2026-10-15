// Offline-safe recovery of a checkout DRAFT, never a completed sale.
// This module never stores passwords or Supabase tokens. No background replay.
const enc=new TextEncoder(),dec=new TextDecoder();
const idRE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const methods=['cash','mpesa','emola','transfer'];
const maxEnvelope=40000,maxDraft=25000;
const b64=bytes=>{
 let output='';for(const n of bytes)output+=String.fromCharCode(n);
 return btoa(output);
};
const unb64=value=>Uint8Array.from(atob(value),ch=>ch.charCodeAt(0));
export function shopDraftKey(userId,businessId,branchId){
 if(![userId,businessId,branchId].every(id=>typeof id==='string'&&idRE.test(id)))throw Error('draft_scope');
 return 'pronto-pilot-draft-v1:'+userId+':'+businessId+':'+branchId;
}
function scoped(scope){
 const {userId,businessId,branchId}=scope||{};
 return {userId,businessId,branchId,key:shopDraftKey(userId,businessId,branchId)};
}
const passCheck=pass=>{
 if(typeof pass!=='string'||pass.length<12||pass.length>128)throw Error('draft_passphrase');
};
export function validateDraftContent(data,scope){
 const s=scoped(scope);
 if(!data||data.version!==1||data.userId!==s.userId||data.businessId!==s.businessId||data.branchId!==s.branchId)throw Error('draft_scope');
 if(!Array.isArray(data.cart)||data.cart.length>100||typeof data.method!=='string')throw Error('draft_payload');
 if(!['cash','mpesa','emola','transfer','mixed'].includes(data.method))throw Error('draft_payload');
 for(const line of data.cart){
  if(!idRE.test(line?.productId)||!Number.isFinite(line.quantity)||line.quantity<=0||line.quantity>1000000)throw Error('draft_payload');
 }
 if(typeof data.discount!=='string'||data.discount.length>30)throw Error('draft_payload');
 if(data.pending!==null&&data.pending!==undefined){
  const p=data.pending;
  if(!p||p.business_id!==s.businessId||p.branch_id!==s.branchId||
   !idRE.test(p.idempotency_key)||!idRE.test(p.session_id)||
   !Array.isArray(p.items)||!Array.isArray(p.allocations)||
   p.allocations.length<1||p.allocations.length>4||
   !p.allocations.every(x=>methods.includes(x.method)&&Number.isSafeInteger(x.amount_cents)&&x.amount_cents>0))
   throw Error('draft_payload');
 }
 return data;
}
async function derive(password,salt){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:250000},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptShopDraft(data,scope,password){
 const sc=scoped(scope);passCheck(password);
 const clean=validateDraftContent(data,scope);
 const plain=enc.encode(JSON.stringify(clean));
 if(plain.length>maxDraft)throw Error('draft_size');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await derive(password,salt);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(sc.key)},key,plain);
 return JSON.stringify({v:1,s:b64(salt),i:b64(iv),c:b64(new Uint8Array(cipher))});
}
export async function decryptShopDraft(blob,scope,password){
 const sc=scoped(scope);passCheck(password);
 if(typeof blob!=='string'||blob.length>maxEnvelope)throw Error('draft_invalid');
 try{
  const envelope=JSON.parse(blob);
  if(envelope.v!==1||typeof envelope.s!=='string'||typeof envelope.i!=='string'||typeof envelope.c!=='string')throw Error('draft_invalid');
  const salt=unb64(envelope.s),iv=unb64(envelope.i),cipher=unb64(envelope.c);
  if(salt.length!==16||iv.length!==12||cipher.length<17||cipher.length>maxDraft+20)throw Error('draft_invalid');
  const key=await derive(password,salt);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(sc.key)},key,cipher);
  if(plain.byteLength>maxDraft)throw Error('draft_invalid');
  return validateDraftContent(JSON.parse(dec.decode(plain)),scope);
 }catch{throw Error('draft_unlock_failed');}
}
export function makeShopDraft({scope,cart,method,discount,pending}){
 const s=scoped(scope);
 const data={version:1,userId:s.userId,businessId:s.businessId,branchId:s.branchId,
  cart:cart.map(x=>({productId:x.productId,quantity:x.quantity})),
  method,discount:String(discount??'0'),pending:pending||null,createdAt:new Date().toISOString()};
 return validateDraftContent(data,scope);
}
export async function saveShopDraft(storage,scope,password,data){
 const key=scoped(scope).key;
 const ciphertext=await encryptShopDraft(data,scope,password);
 storage.setItem(key,ciphertext);return key;
}
export async function restoreShopDraft(storage,scope,password){
 const raw=storage.getItem(scoped(scope).key);
 if(!raw)throw Error('draft_missing');
 return decryptShopDraft(raw,scope,password);
}
export function hasShopDraft(storage,scope){return storage.getItem(scoped(scope).key)!==null;}
export function clearShopDraft(storage,scope){storage.removeItem(scoped(scope).key);}

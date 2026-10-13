import {api,isRemote} from './auth.js';
import {seed} from './model.js';
let db, remoteState, selectedTenant;
export async function selectTenant(id){selectedTenant=id;remoteState=await api(`state?tenantId=${encodeURIComponent(id)}`);return remoteState;}
export async function open(){if(isRemote){remoteState=await api("state");return remoteState;}db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pronto-pos-demo',1);request.onupgradeneeded=()=>request.result.createObjectStore('data');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const existing=await read();if(!existing)await update(()=>seed());return read();}
export async function remoteAction(path,body){if(!isRemote)throw Error('not_remote');if(!navigator.onLine)throw Error('offline_remote');remoteState=await api(path,body);return remoteState;}
export function read(){if(isRemote)return api(selectedTenant?`state?tenantId=${encodeURIComponent(selectedTenant)}`:"state").then(s=>{remoteState=s;return s;});return new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly');const request=tx.objectStore('data').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export function update(mutator){if(isRemote)return remoteUpdate(mutator);return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');const store=tx.objectStore('data');let next;const request=store.get('state');request.onsuccess=()=>{try{next=mutator(request.result);store.put(next,'state');}catch(error){reject(error);tx.abort();}};tx.oncomplete=()=>{window.dispatchEvent(new Event('pos-updated'));resolve(next);};tx.onerror=()=>reject(tx.error);});}

async function remoteUpdate(mutator){
 if(!navigator.onLine)throw Error('offline_remote');
 const old=remoteState,next=mutator(old);let route,body;
 const business=next.tenants.find(t=>!old.tenants.some(x=>x.id===t.id));
 const member=next.members.find(m=>!old.members.some(x=>x.id===m.id));
 const product=next.products.find(p=>!old.products.some(x=>x.id===p.id));
 const sale=next.sales.find(s=>!old.sales.some(x=>x.id===s.id));
 const stock=next.products.find(p=>old.products.some(x=>x.id===p.id&&x.stock!==p.stock));
 if(business){route='businesses';body=business;}
 else if(member){route='members';body=member;}
 else if(product){route='products';body=product;}
 else if(sale){route='sales';body={id:sale.id,tenantId:sale.tenantId,cart:sale.lines.map(l=>({productId:l.productId,quantity:l.quantity})),method:sale.method,payments:sale.payments,discount:sale.discount||0,received:sale.received,deviceId:sale.deviceId};}
 else if(stock){route='stock';body={tenantId:stock.tenantId,productId:stock.id,quantity:stock.stock-old.products.find(p=>p.id===stock.id).stock};}
 else throw Error('unsupported_operation');
 remoteState=await api(route,body);return remoteState;
}

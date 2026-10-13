import {offlineUnlocked,offlineSnapshot,offlinePending,rememberVerifiedSnapshot,offlineSaleBody,queueOfflineSale,pendingSync} from './offline.js';
import {attachCashSale} from './cash.js';
import {api,isRemote,setActiveBranch} from './auth.js';
import {seed} from './model.js';
let db, remoteState, selectedTenant;
export async function selectTenant(id){setActiveBranch(null);sessionStorage.removeItem('pronto-branch');selectedTenant=id;remoteState=await api(`state?tenantId=${encodeURIComponent(id)}`);return remoteState;}
export async function selectBranch(id){
 if(!isRemote)throw Error('branch_requires_server');
 if(!navigator.onLine||offlinePending())throw Error('offline_pending');
 const previous=selectedTenant;
 setActiveBranch(id);
 try{
  const next=await api(`state?tenantId=${encodeURIComponent(id)}`);
  if(!next.branchGroup?.branches.some(b=>b.id===id&&b.active))throw Error('branch_forbidden');
  selectedTenant=id;remoteState=next;sessionStorage.setItem('pronto-branch',id);await rememberVerifiedSnapshot(next,id);return next;
 }catch(error){setActiveBranch(previous);throw error;}
}
export async function open(){if(isRemote){
  if(offlineUnlocked()&&!navigator.onLine){const local=offlineSnapshot();selectedTenant=local.tenants[0].id;remoteState=local;return local;}
  const saved=sessionStorage.getItem('pronto-branch');
  if(saved){
   try{
    setActiveBranch(saved);remoteState=await api(`state?tenantId=${encodeURIComponent(saved)}`);
    if(remoteState.branchGroup?.branches.some(b=>b.id===saved&&b.active)){selectedTenant=saved;await rememberVerifiedSnapshot(remoteState,saved);return remoteState;}
   }catch{}
   setActiveBranch(null);sessionStorage.removeItem('pronto-branch');selectedTenant=null;
  }
  remoteState=await api('state');selectedTenant=remoteState.tenants[0]?.id;await rememberVerifiedSnapshot(remoteState,selectedTenant);return remoteState;
 }db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pronto-pos-demo',1);request.onupgradeneeded=()=>request.result.createObjectStore('data');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const existing=await read();if(!existing)await update(()=>seed());return read();}
export async function remoteAction(path,body){if(!isRemote)throw Error('not_remote');if(!navigator.onLine)throw Error('offline_remote');remoteState=await api(path,body);await rememberVerifiedSnapshot(remoteState,selectedTenant);return remoteState;}
export function read(){if(isRemote){
  if(offlineUnlocked()&&(!navigator.onLine||offlinePending()))return Promise.resolve(offlineSnapshot()).then(s=>{remoteState=s;return s;});
  return api(selectedTenant?`state?tenantId=${encodeURIComponent(selectedTenant)}`:'state').then(async s=>{remoteState=s;await rememberVerifiedSnapshot(s,selectedTenant);return s;});
 }return new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly');const request=tx.objectStore('data').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export function update(mutator){if(isRemote)return remoteUpdate(mutator);return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');const store=tx.objectStore('data');let next;const request=store.get('state');request.onsuccess=()=>{try{next=mutator(request.result);store.put(next,'state');}catch(error){reject(error);tx.abort();}};tx.oncomplete=()=>{window.dispatchEvent(new Event('pos-updated'));resolve(next);};tx.onerror=()=>reject(tx.error);});}

async function remoteUpdate(mutator){
 const old=remoteState,next=mutator(old);let route,body;
 const cashSale=next.sales?.find(s=>!old.sales?.some(x=>x.id===s.id));
 if((!navigator.onLine||offlinePending())&&isRemote){
  if(!offlineUnlocked())throw Error('offline_remote');
  const saleBody=offlineSaleBody(old,next);
  const tentative=attachCashSale(next,{tenantId:cashSale.tenantId,userId:cashSale.userId,deviceId:cashSale.deviceId,role:old.auth?.role},cashSale.id);
  remoteState=await queueOfflineSale(old,tentative,saleBody);return remoteState;
 }
 const business=next.tenants.find(t=>!old.tenants.some(x=>x.id===t.id));
 const member=next.members.find(m=>!old.members.some(x=>x.id===m.id));
 const product=next.products.find(p=>!old.products.some(x=>x.id===p.id));
 const sale=next.sales.find(s=>!old.sales.some(x=>x.id===s.id));
 const stock=next.products.find(p=>old.products.some(x=>x.id===p.id&&x.stock!==p.stock));
 if(business){route='businesses';body=business;}
 else if(member){route='members';body=member;}
 else if(product){route='products';body=product;}
 else if(sale){route='sales';body={id:sale.id,tenantId:sale.tenantId,cart:sale.lines.map(l=>({productId:l.productId,quantity:l.quantity})),method:sale.method,payments:sale.method==='credit'?undefined:sale.payments,discount:sale.discount||0,customerId:sale.customerId||null,debtDueDate:sale.debtDueDate||null,received:sale.received,deviceId:sale.deviceId};}
 else if(stock){route='stock';body={tenantId:stock.tenantId,productId:stock.id,quantity:stock.stock-old.products.find(p=>p.id===stock.id).stock};}
 else throw Error('unsupported_operation');
 try{remoteState=await api(route,body);await rememberVerifiedSnapshot(remoteState,selectedTenant);return remoteState;}
 catch(error){
  if(route==='sales'&&offlineUnlocked()&&['Failed to fetch','fetch failed','server_unavailable','NetworkError when attempting to fetch resource.'].includes(error.message)){
   const tentative=attachCashSale(next,{tenantId:cashSale.tenantId,userId:cashSale.userId,deviceId:cashSale.deviceId,role:old.auth?.role},cashSale.id);
   remoteState=await queueOfflineSale(old,tentative,body);return remoteState;
  }
  throw error;
 }
}

export async function syncOfflineSales(){
 if(!isRemote)return {status:'demo',confirmed:0,pending:0};
 const result=await pendingSync(body=>api('sales',body));
 if(result.status==='ok'&&result.confirmed){
  remoteState=await api(selectedTenant?`state?tenantId=${encodeURIComponent(selectedTenant)}`:'state');
  await rememberVerifiedSnapshot(remoteState,selectedTenant);
 }
 return result;
}

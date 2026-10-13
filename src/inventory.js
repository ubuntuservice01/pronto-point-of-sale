// Inventory mutations shared by the authenticated API and the local demo.
// All financial values are integer cents; stock supports up to 3 decimals.
const discrete=new Set(['un','caixa','pacote','saco','rolo','par','conjunto']);
const own=(s,id,tenantId)=>{const p=(s.products||[]).find(p=>p.id===id&&p.tenantId===tenantId);if(!p)throw Error('product_not_found');return p;};
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=80;
const required=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
const revision=p=>Number.isSafeInteger(p.revision)&&p.revision>=0?p.revision:0;
const stockNumber=(v,unit,positive)=>{
 if(typeof v!=='number'||!Number.isFinite(v)||v<(positive?0.001:0)||v>100000000||Math.abs(v*1000-Math.round(v*1000))>0.00001||(discrete.has(unit)&&!Number.isInteger(v)))throw Error('invalid_quantity');
 return Math.round(v*1000)/1000;
};
const protect=(s,input,tenantId,actorId,type,signature)=>{
 const history=s.inventoryEvents||[];
 const old=history.find(e=>e.id===input.id);
 if(!old)return false;
 if(old.tenantId===tenantId&&old.actorId===actorId&&old.action===type&&old.signature===signature)return true;
 throw Error('operation_conflict');
};
const updateLog=(s,entry)=>({...s,inventoryEvents:[entry,...(s.inventoryEvents||[])]});
const signature=(input,keys)=>JSON.stringify(Object.fromEntries(keys.map(k=>[k,input[k]])));
function checks(input,actorId,reasonLimit=250){
 if(!validId(input?.id)||!validId(input.productId)||!validId(actorId)||!required(input.reason,reasonLimit))throw Error('invalid_inventory_request');
}
export function editInventoryProduct(state,tenantId,input,actorId){
 checks(input,actorId);
 const name=input.name?.trim(),category=input.category?.trim(),code=input.code?.trim();
 if(!required(name,100)||!required(category,60)||typeof code!=='string'||code.length>80||!Number.isSafeInteger(input.price)||input.price<=0||!Number.isFinite(input.min)||input.min<0||input.min>100000000||Math.abs(input.min*1000-Math.round(input.min*1000))>0.00001)throw Error('invalid_product');
 const nextFields={name,category,code,price:input.price,min:Math.round(input.min*1000)/1000};
 const request={...input,...nextFields};
 const sig=signature(request,['productId','expectedRevision','name','category','code','price','min','reason']);
 if(protect(state,input,tenantId,actorId,'edit',sig))return state;
 const p=own(state,input.productId,tenantId);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==revision(p))throw Error('revision_conflict');
 if(state.products.some(x=>x.tenantId===tenantId&&x.id!==p.id&&code&&x.code===code))throw Error('barcode_in_use');
 if(Object.entries(nextFields).every(([k,v])=>p[k]===v))throw Error('no_change');
 const before=Object.fromEntries(Object.keys(nextFields).map(k=>[k,p[k]]));
 const updated={...p,...nextFields,revision:revision(p)+1};
 const event={id:input.id,tenantId,productId:p.id,productName:updated.name,action:'edit',actorId,createdAt:new Date().toISOString(),reason:input.reason.trim(),before,after:nextFields,signature:sig};
 return updateLog({...state,products:state.products.map(x=>x.id===p.id&&x.tenantId===tenantId?updated:x)},event);
}
export function setInventoryStatus(state,tenantId,input,actorId){
 checks(input,actorId);
 if(typeof input.active!=='boolean')throw Error('invalid_status');
 const sig=signature(input,['productId','expectedRevision','active','reason']);
 if(protect(state,input,tenantId,actorId,'status',sig))return state;
 const p=own(state,input.productId,tenantId);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==revision(p))throw Error('revision_conflict');
 if((p.active!==false)===input.active)throw Error('no_change');
 const updated={...p,active:input.active,revision:revision(p)+1};
 return updateLog({...state,products:state.products.map(x=>x.id===p.id&&x.tenantId===tenantId?updated:x)},{id:input.id,tenantId,productId:p.id,productName:p.name,action:'status',actorId,createdAt:new Date().toISOString(),reason:input.reason.trim(),before:{active:p.active!==false},after:{active:input.active},signature:sig});
}
export function recordInventoryMovement(state,tenantId,input,actorId){
 checks(input,actorId,200);
 if(!['receive','adjust'].includes(input.kind))throw Error('invalid_movement');
 const sig=signature(input,['productId','kind','quantity','expectedStock','reason']);
 if(protect(state,input,tenantId,actorId,input.kind,sig))return state;
 const p=own(state,input.productId,tenantId);
 const amount=stockNumber(input.quantity,p.unit,input.kind==='receive');
 if(input.kind==='adjust'&&(typeof input.expectedStock!=='number'||!Number.isFinite(input.expectedStock)||input.expectedStock!==p.stock))throw Error('stock_conflict');
 const after=input.kind==='receive'?Math.round((p.stock+amount)*1000)/1000:amount;
 if(!Number.isFinite(after)||after>100000000)throw Error('invalid_quantity');
 const delta=Math.round((after-p.stock)*1000)/1000;
 if(delta===0)throw Error('no_change');
 const movement={id:input.id,tenantId,productId:p.id,productName:p.name,unit:p.unit,type:input.kind,reason:input.reason.trim(),before:p.stock,after,delta,actorId,userId:actorId,createdAt:new Date().toISOString()};
 const next={...state,products:state.products.map(x=>x.id===p.id&&x.tenantId===tenantId?{...x,stock:after}:x),stockMovements:[movement,...(state.stockMovements||[])]};
 return updateLog(next,{...movement,action:input.kind,signature:sig});
}

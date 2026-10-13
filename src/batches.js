import {normalizeExpiryDate,expiryInfo} from './expiry.js';
const q=v=>Math.round(v*1000)/1000;
const validQty=(n,unit,zero=false)=>typeof n==='number'&&Number.isFinite(n)&&n>=(zero?0:0.001)&&n<=100000000&&Math.abs(n*1000-Math.round(n*1000))<0.000001&&(!['un','caixa','pacote','saco','rolo','par','conjunto'].includes(unit)||Number.isInteger(n));
export const trackedBatches=(state,product)=> (state.stockBatches||[]).filter(b=>b.tenantId===product.tenantId&&b.productId===product.id);
export function legacyQty(state,product){
 const tracked=q(trackedBatches(state,product).reduce((n,b)=>n+b.quantity,0));
 const remainder=q(product.stock-tracked);
 if(remainder < -0.000001)throw Error('batch_stock_inconsistent');
 return Math.max(0,remainder);
}
export function productBatches(state,product){
 const tracked=trackedBatches(state,product);
 const old=legacyQty(state,product);
 return [...tracked.map(b=>({...b,source:'tracked'})),...(old? [{id:null,tenantId:product.tenantId,productId:product.id,number:'',expiryDate:product.expiryDate||'',quantity:old,source:'legacy'}]:[])];
}
const sortBatches=(a,b)=>{
 const ea=a.expiryDate||'9999-12-31',eb=b.expiryDate||'9999-12-31';
 return ea.localeCompare(eb)||String(a.number||'').localeCompare(String(b.number||''))||String(a.id||'').localeCompare(String(b.id||''));
};
export function sellableQty(state,product,at=new Date()){
 return q(productBatches(state,product).filter(b=>b.quantity>0&&(!b.expiryDate||expiryInfo(b.expiryDate,at).days>=0)).reduce((sum,b)=>sum+b.quantity,0));
}
export function allocateFEFO(state,product,amount,at=new Date()){
 if(!validQty(amount,product.unit))throw Error('quantity');
 let remaining=amount;
 const allocations=[];
 for(const batch of productBatches(state,product).filter(b=>b.quantity>0&&(!b.expiryDate||expiryInfo(b.expiryDate,at).days>=0)).sort(sortBatches)){
  if(remaining<=0)break;
  const taken=q(Math.min(remaining,batch.quantity));
  if(!taken)continue;
  allocations.push({batchId:batch.id,batchNumber:batch.number||'',expiryDate:batch.expiryDate||'',quantity:taken});
  remaining=q(remaining-taken);
 }
 if(remaining>0)throw Error('stock_expired_or_insufficient');
 return allocations;
}
function checkNumber(number){
 if(typeof number!=='string'||number.trim().length<1||number.trim().length>80)throw Error('batch_number');
 return number.trim();
}
export function addIncomingBatch(state,tenantId,product,{batchNumber,expiryDate,quantity}){
 if(product.tenantId!==tenantId)throw Error('product_not_found');
 if(!validQty(quantity,product.unit))throw Error('invalid_quantity');
 const number=checkNumber(batchNumber),date=normalizeExpiryDate(expiryDate);
 const batches=state.stockBatches||[];
 const existing=batches.find(b=>b.tenantId===tenantId&&b.productId===product.id&&b.number.toLowerCase()===number.toLowerCase());
 if(existing&&existing.expiryDate!==date)throw Error('batch_expiry_conflict');
 let batchId;
 let next;
 if(existing){
  batchId=existing.id;
  next=batches.map(b=>b.id===existing.id?{...b,quantity:q(b.quantity+quantity)}:b);
 }else{
  batchId=crypto.randomUUID();
  next=[...batches,{id:batchId,tenantId,productId:product.id,number,expiryDate:date,quantity,createdAt:new Date().toISOString()}];
 }
 return {stockBatches:next,batchId};
}
export function receiveBatch(state,tenantId,input,actorId){
 const product=(state.products||[]).find(p=>p.id===input.productId&&p.tenantId===tenantId);
 if(!product)throw Error('product_not_found');
 if(typeof input.id!=='string'||!input.id||input.id.length>80||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>200)throw Error('invalid_batch_movement');
 const old=(state.inventoryEvents||[]).find(e=>e.id===input.id);
 const signature=JSON.stringify([input.productId,input.batchNumber?.trim(),input.expiryDate||'',input.quantity,input.reason.trim()]);
 if(old){if(old.action==='batch_receive'&&old.tenantId===tenantId&&old.actorId===actorId&&old.signature===signature)return state;throw Error('operation_conflict');}
 const incoming=addIncomingBatch(state,tenantId,product,input),after=q(product.stock+input.quantity);
 if(after>100000000)throw Error('invalid_quantity');
 const event={id:input.id,tenantId,productId:product.id,productName:product.name,batchId:incoming.batchId,batchNumber:input.batchNumber.trim(),expiryDate:normalizeExpiryDate(input.expiryDate),action:'batch_receive',type:'batch_receive',before:product.stock,after,delta:input.quantity,unit:product.unit,actorId,reason:input.reason.trim(),createdAt:new Date().toISOString(),signature};
 return {...state,stockBatches:incoming.stockBatches,products:state.products.map(p=>p.id===product.id&&p.tenantId===tenantId?{...p,stock:after}:p),inventoryEvents:[event,...(state.inventoryEvents||[])],stockMovements:[event,...(state.stockMovements||[])]};
}
export function adjustProductBatch(state,tenantId,input,actorId){
 const p=(state.products||[]).find(p=>p.id===input.productId&&p.tenantId===tenantId);
 if(!p)throw Error('product_not_found');
 if(typeof input.id!=='string'||!input.id||input.id.length>80||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>200)throw Error('invalid_batch_movement');
 const sig=JSON.stringify([input.productId,input.batchId??null,input.quantity,input.expectedQuantity,input.reason.trim()]);
 const previous=(state.inventoryEvents||[]).find(e=>e.id===input.id);
 if(previous){if(previous.tenantId===tenantId&&previous.actorId===actorId&&previous.action==='batch_adjust'&&previous.signature===sig)return state;throw Error('operation_conflict');}
 const oldBatches=productBatches(state,p);
 const current=oldBatches.find(b=>b.id===(input.batchId||null));
 if(!current)throw Error('batch_not_found');
 if(typeof input.expectedQuantity!=='number'||input.expectedQuantity!==current.quantity)throw Error('stock_conflict');
 if(!validQty(input.quantity,p.unit,true))throw Error('invalid_quantity');
 const delta=q(input.quantity-current.quantity);
 if(delta===0)throw Error('no_change');
 const nextStock=q(p.stock+delta);
 if(nextStock<0||nextStock>100000000)throw Error('invalid_quantity');
 const nextBatches=current.id?(state.stockBatches||[]).map(b=>b.id===current.id?{...b,quantity:input.quantity}:b):(state.stockBatches||[]);
 const event={id:input.id,tenantId,productId:p.id,productName:p.name,batchId:current.id,batchNumber:current.number,expiryDate:current.expiryDate,action:'batch_adjust',type:'batch_adjust',before:current.quantity,after:input.quantity,delta,unit:p.unit,actorId,reason:input.reason.trim(),createdAt:new Date().toISOString(),signature:sig};
 return {...state,stockBatches:nextBatches,products:state.products.map(x=>x.id===p.id&&x.tenantId===tenantId?{...x,stock:nextStock}:x),inventoryEvents:[event,...(state.inventoryEvents||[])],stockMovements:[event,...(state.stockMovements||[])]};
}
export function afterBatchSale(state,lines){
 const decrements=new Map();
 for(const line of lines)for(const allocation of line.batchAllocations||[]){
  if(allocation.batchId)decrements.set(allocation.batchId,q((decrements.get(allocation.batchId)||0)+allocation.quantity));
 }
 return (state.stockBatches||[]).map(batch=>{
  const used=decrements.get(batch.id)||0;
  if(!used)return batch;
  if(used>batch.quantity)throw Error('batch_stock_inconsistent');
  return {...batch,quantity:q(batch.quantity-used)};
 });
}
export function afterBatchRefund(state,sale){
 const additions=new Map();
 for(const line of sale.lines||[])for(const allocation of line.batchAllocations||[]){
  if(allocation.batchId)additions.set(allocation.batchId,q((additions.get(allocation.batchId)||0)+allocation.quantity));
 }
 const originals=state.stockBatches||[];
 for(const id of additions.keys())if(!originals.some(b=>b.id===id&&b.tenantId===sale.tenantId))throw Error('batch_not_found');
 return originals.map(b=>additions.has(b.id)?{...b,quantity:q(b.quantity+additions.get(b.id))}:b);
}

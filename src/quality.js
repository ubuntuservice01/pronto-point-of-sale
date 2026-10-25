import {sellableQty} from './batches.js';
import {validateSaleQuantity} from './sale-by-value.js';
// Pure UI guards. Server-side validation remains mandatory.
export function cartIssues(cart,products,state){
 const byId=new Map(products.map(p=>[p.id,p])),seen=new Set(),issues=[];
 for(const line of cart||[]){
  const p=byId.get(line.productId);
  if(!p||p.active===false){issues.push({productId:line.productId,reason:'unavailable'});continue;}
  if(seen.has(line.productId)){issues.push({productId:line.productId,reason:'duplicate'});continue;}
  seen.add(line.productId);
  const q=line.quantity;
  try{validateSaleQuantity(p,q,state?sellableQty(state,p):p.stock);}
  catch{issues.push({productId:line.productId,reason:'quantity'});}
 }
 return issues;
}
export function filterSaleHistory(sales,{search='',method='all',status='all',from='',to=''}={}){
 const query=String(search||'').trim().toLocaleLowerCase();
 return (sales||[]).filter(s=>{
  if(method!=='all'&&s.method!==method&&!(method==='mixed'&&Array.isArray(s.payments)&&s.payments.length>1))return false;
  if(status==='refunded'&&!s.refundId)return false;
  if(status==='completed'&&s.refundId)return false;
  const date=String(s.createdAt||'').slice(0,10);
  if((from&&date<from)||(to&&date>to))return false;
  const content=[s.id,s.method,...(s.lines||[]).map(l=>l.name),...(s.lines||[]).map(l=>l.productId),s.customerId].filter(Boolean).join(' ').toLocaleLowerCase();
  return !query||content.includes(query);
 });
}

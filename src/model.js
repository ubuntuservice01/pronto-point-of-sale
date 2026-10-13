import {checkNewDebt,addSaleDebt} from './debts.js';
import {allocateFEFO,afterBatchSale} from './batches.js';
import {normalizeExpiryDate} from './expiry.js';
export const units=['un','m','m²','kg','g','l','ml','caixa','pacote','saco','rolo','par','conjunto'];
export const roles=['owner','manager','cashier','stock','finance'];
export const permissions={owner:['sell','stock','team','history','refund','discount','customers','purchases','expenses','reports','debts','alerts'],manager:['sell','stock','history','refund','discount','customers','purchases','expenses','reports','alerts'],cashier:['sell','history','customers','debts'],stock:['stock','purchases','alerts'],finance:['history','expenses','reports','debts']};
export const can=(role,action)=>(permissions[role]||[]).includes(action);
export function seed(){return {version:1,tenants:[{id:'t1',name:'Mercearia Boa Compra',type:'Mercearia',owner:'Gabriel'},{id:'t2',name:'Ferragem Horizonte',type:'Ferragem',owner:'Ana'}],products:[
{id:'p1',tenantId:'t1',name:'Arroz',category:'Alimentação',unit:'kg',price:8500,stock:48,min:10,code:'10001',emoji:'🍚'},
{id:'p2',tenantId:'t1',name:'Óleo alimentar',category:'Alimentação',unit:'l',price:15500,stock:24,min:6,code:'10002',emoji:'🫙'},
{id:'p3',tenantId:'t1',name:'Sabonete',category:'Higiene',unit:'un',price:4500,stock:8,min:10,code:'10003',emoji:'🧼'},
{id:'p4',tenantId:'t1',name:'Açúcar',category:'Alimentação',unit:'kg',price:7500,stock:35,min:8,code:'10004',emoji:'🥣'},
{id:'p5',tenantId:'t1',name:'Creme hidratante',category:'Cuidados pessoais',unit:'un',price:28000,stock:12,min:4,code:'10005',emoji:'🧴'},
{id:'p6',tenantId:'t2',name:'Cabo eléctrico',category:'Electricidade',unit:'m',price:6500,stock:100,min:15,code:'20001',emoji:'🔌'},
{id:'p7',tenantId:'t2',name:'Cimento 50 kg',category:'Construção',unit:'saco',price:48000,stock:30,min:5,code:'20002',emoji:'🧱'}],sales:[],members:[{id:'u1',tenantId:'t1',name:'Gabriel',role:'owner'},{id:'u2',tenantId:'t1',name:'Maria',role:'cashier'},{id:'u3',tenantId:'t2',name:'Ana',role:'owner'}]};}
export function createSale(state,{tenantId,role,cart,method,received,discount=0,payments,deviceId,id,userId,customerId=null,debtDueDate=null}){
 if(!can(role,'sell'))throw Error('permission');
 if(state.sales.some(s=>s.id===id))return state;
 if(!state.tenants.some(t=>t.id===tenantId)||!Array.isArray(cart)||!cart.length)throw Error('cart');
 const seen=new Set();
 const lines=cart.map(item=>{
  const p=state.products.find(p=>p.id===item.productId&&p.tenantId===tenantId);
  if(!p||p.active===false||seen.has(p.id))throw Error('product');
  seen.add(p.id);
  const qty=Number(item.quantity);
  if(!Number.isFinite(qty)||qty<=0||qty>p.stock)throw Error('stock');
  if(Math.abs(qty*1000-Math.round(qty*1000))>0.00001)throw Error('quantity');
  if(['un','caixa','pacote','saco','rolo','par','conjunto'].includes(p.unit)&&!Number.isInteger(qty))throw Error('quantity');
  return {productId:p.id,name:p.name,unit:p.unit,quantity:qty,batchAllocations:allocateFEFO(state,p,qty),price:p.price,cost:Number.isSafeInteger(p.cost)&&p.cost>=0?p.cost:null,total:Math.round(p.price*qty)};
 });
 if(customerId!==null&&customerId!==''&&!(state.customers||[]).some(c=>c.id===customerId&&c.tenantId===tenantId))throw Error('customer');
 const subtotal=lines.reduce((sum,line)=>sum+line.total,0);
 if(!Number.isSafeInteger(discount)||discount<0||discount>=subtotal)throw Error('discount');
 if(discount>0&&!can(role,'discount'))throw Error('permission');
 const total=subtotal-discount;
 const methods=['cash','mpesa','emola','transfer'];
 const isDebt=method==='credit'&&payments===undefined;
 let normalized;
 if(payments!==undefined){
  if(!Array.isArray(payments)||!payments.length||payments.length>methods.length)throw Error('payment');
  const used=new Set();
  normalized=payments.map(p=>{
   if(!p||!methods.includes(p.method)||used.has(p.method)||!Number.isSafeInteger(p.amount)||p.amount<=0)throw Error('payment');
   used.add(p.method);return {method:p.method,amount:p.amount};
  });
  if(normalized.reduce((sum,p)=>sum+p.amount,0)!==total)throw Error('payment_total');
 }else{
  if(!methods.includes(method)&&!isDebt)throw Error('payment');
  normalized=[{method,amount:total}];
 }
 if(isDebt)checkNewDebt(state,tenantId,customerId,total,debtDueDate);
 const cashAmount=normalized.find(p=>p.method==='cash')?.amount||0;
 if(cashAmount&&(!Number.isSafeInteger(received)||received<cashAmount))throw Error('received');
 const tender=isDebt?0:cashAmount?received:total;
 const sale={id,tenantId,deviceId,userId,customerId:customerId||null,debtDueDate:isDebt?debtDueDate:null,createdAt:new Date().toISOString(),lines,subtotal,discount,total,payments:normalized,method:normalized.length===1?normalized[0].method:'mixed',received:tender,change:cashAmount?received-cashAmount:0,syncStatus:'local'};
 const stockEvents=lines.map(line=>{
  const before=state.products.find(p=>p.id===line.productId&&p.tenantId===tenantId).stock;
  const after=Math.round((before-line.quantity)*1000)/1000;
  return {id:crypto.randomUUID(),tenantId,productId:line.productId,productName:line.name,unit:line.unit,action:'sale',type:'sale',referenceId:id,createdAt:sale.createdAt,actorId:userId||'demo',reason:'Venda #'+String(id).slice(0,10),before,after,delta:-line.quantity};
 });
 const afterSale={...state,products:state.products.map(p=>{const line=lines.find(l=>l.productId===p.id);return line?{...p,stock:Math.round((p.stock-line.quantity)*1000)/1000}:p;}),sales:[sale,...state.sales],stockBatches:afterBatchSale(state,lines),inventoryEvents:[...stockEvents,...(state.inventoryEvents||[])],stockMovements:[...stockEvents,...(state.stockMovements||[])]};
 return isDebt?addSaleDebt(afterSale,sale,debtDueDate):afterSale;
}
export function addProduct(state,tenantId,product){if(!state.tenants.some(t=>t.id===tenantId))throw Error('tenant');if(!product.name.trim()||!units.includes(product.unit)||!Number.isSafeInteger(product.price)||product.price<=0||!Number.isFinite(product.stock)||product.stock<0||!Number.isFinite(product.min)||product.min<0)throw Error('product');if(['un','caixa','pacote','saco','rolo','par','conjunto'].includes(product.unit)&&!Number.isInteger(product.stock))throw Error('quantity');if(product.code&&state.products.some(p=>p.tenantId===tenantId&&p.code===product.code))throw Error('code');return {...state,products:[...state.products,{...product,expiryDate:normalizeExpiryDate(product.expiryDate),id:crypto.randomUUID(),tenantId,active:true,revision:0}]};}

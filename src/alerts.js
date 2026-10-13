// Inventory alerts: pure, tenant-scoped, Mozambique-local calendar calculations.
// This is an in-app recommendation engine; it never purchases, discounts or notifies automatically.
import {productBatches,sellableQty} from './batches.js';
import {expiryInfo} from './expiry.js';
export const DEFAULT_ALERT_SETTINGS=Object.freeze({expiryDays:30,urgentDays:7,reorderDays:14,revision:0});
const round3=n=>Math.round(n*1000)/1000;
const integerUnits=new Set(['un','caixa','pacote','saco','rolo','par','conjunto']);
const epochDay=86400000;
export function alertSettings(state){
 const v=state?.alertSettings||{};
 return {...DEFAULT_ALERT_SETTINGS,...Object.fromEntries(Object.entries(DEFAULT_ALERT_SETTINGS).map(([k,defaultValue])=>[k,Number.isSafeInteger(v[k])?v[k]:defaultValue]))};
}
export function updateAlertSettings(state,input,actor){
 if(!['owner','manager'].includes(actor?.role))throw Error('permission');
 const old=alertSettings(state);
 const {expiryDays,urgentDays,reorderDays,expectedRevision,reason}=input||{};
 if(!Number.isSafeInteger(expiryDays)||expiryDays<1||expiryDays>180||!Number.isSafeInteger(urgentDays)||urgentDays<1||urgentDays>expiryDays||!Number.isSafeInteger(reorderDays)||reorderDays<1||reorderDays>90||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof reason!=='string'||!reason.trim()||reason.length>250)throw Error('alert_settings');
 if(old.revision!==expectedRevision)throw Error('revision_conflict');
 if(old.expiryDays===expiryDays&&old.urgentDays===urgentDays&&old.reorderDays===reorderDays)throw Error('no_change');
 const next={expiryDays,urgentDays,reorderDays,revision:old.revision+1};
 return {...state,alertSettings:next,alertEvents:[{id:crypto.randomUUID(),tenantId:actor.tenantId,actorId:actor.id,action:'settings',before:old,after:next,reason:reason.trim(),createdAt:new Date().toISOString()},...(state.alertEvents||[])]};
}
// Returns only quantities, never prices or customer information. Safe for inventory employees.
export function aggregateDemand(state,tenantId,at=new Date(),lookbackDays=30){
 const start=at.getTime()-lookbackDays*epochDay;
 const reversed=new Set((state.refunds||[]).filter(r=>r.tenantId===tenantId).map(r=>r.saleId));
 const counts=new Map();
 for(const sale of state.sales||[]){
  if(sale.tenantId!==tenantId||reversed.has(sale.id)||sale.refundId)continue;
  const date=Date.parse(sale.createdAt);
  if(!Number.isFinite(date)||date<start||date>at.getTime())continue;
  for(const line of sale.lines||[]){
   if(typeof line.productId!=='string'||!Number.isFinite(line.quantity)||line.quantity<=0)continue;
   counts.set(line.productId,round3((counts.get(line.productId)||0)+line.quantity));
  }
 }
 return {windowDays:lookbackDays,byProduct:Object.fromEntries(counts)};
}
function demandFor(state,tenantId,at){
 // Server snapshots supply aggregateDemand for stock-only staff; they do NOT receive sale receipts.
 if(state?.alertDemand?.windowDays===30&&state.alertDemand?.byProduct&&typeof state.alertDemand.byProduct==='object')return state.alertDemand;
 return aggregateDemand(state,tenantId,at);
}
export function suggestedReorder(product,available,sold,settings){
 const min=Number.isFinite(product.min)&&product.min>0?product.min:0;
 const avg=sold>0?sold/30:0;
 // No recorded sales => rely solely on merchant-defined minimum, not a fictitious forecast.
 const demandTarget=avg>0?avg*settings.reorderDays:0;
 const targetRaw=Math.max(min,demandTarget);
 const target=integerUnits.has(product.unit)?Math.ceil(targetRaw):Math.ceil(targetRaw*1000)/1000;
 const quantity=Math.max(0,round3(target-available));
 return {quantity,target,sold30:round3(sold),averageDaily:round3(avg),basis:avg>0?'sales_and_minimum':'minimum_only',windowDays:30,coverageDays:settings.reorderDays};
}
const typeSeverity={expired:0,out:1,today:1,urgent:2,low:3,soon:4};
export function inventoryAlerts(state,tenantId,{at=new Date()}={}){
 const config=alertSettings(state),demand=demandFor(state,tenantId,at);
 const products=(state.products||[]).filter(p=>p.tenantId===tenantId);
 const alerts=[],recommendations=[];
 for(const p of products){
  const batches=productBatches(state,p);
  for(const b of batches){
   if(!(b.quantity>0)||!b.expiryDate)continue;
   const days=expiryInfo(b.expiryDate,at).days;
   if(days>config.expiryDays)continue;
   const type=days<0?'expired':days===0?'today':days<=config.urgentDays?'urgent':'soon';
   const legacy=!b.id;
   alerts.push({id:'date:'+p.id+':'+(b.id||'legacy'),type,severity:typeSeverity[type],productId:p.id,productName:p.name,unit:p.unit,productActive:p.active!==false,batchId:b.id||null,batchNumber:legacy?'':b.number||'',legacy,expiryDate:b.expiryDate,days,quantity:b.quantity,available:sellableQty(state,p,at),minimum:p.min??0});
  }
  if(p.active===false)continue;
  const available=sellableQty(state,p,at);
  const sold=demand.byProduct?.[p.id]||0;
  const suggested=suggestedReorder(p,available,sold,config);
  if(available===0||available<=p.min){
   const type=available===0?'out':'low';
   alerts.push({id:'stock:'+p.id,type,severity:typeSeverity[type],productId:p.id,productName:p.name,unit:p.unit,productActive:true,quantity:available,physical:p.stock,minimum:p.min??0,available,reorder:suggested});
  }
  if(suggested.quantity>0)recommendations.push({productId:p.id,productName:p.name,unit:p.unit,available,physical:p.stock,minimum:p.min??0,...suggested});
 }
 alerts.sort((a,b)=>a.severity-b.severity||(a.days??9999)-(b.days??9999)||a.productName.localeCompare(b.productName,'pt'));
 recommendations.sort((a,b)=>(a.available<=a.minimum?-1:0)-(b.available<=b.minimum?-1:0)||b.quantity-a.quantity||a.productName.localeCompare(b.productName,'pt'));
 const counts={expired:0,today:0,urgent:0,soon:0,low:0,out:0};
 for(const a of alerts)counts[a.type]++;
 return {alerts,counts,total:alerts.length,expiredQuantity:round3(alerts.filter(a=>a.type==='expired').reduce((n,a)=>n+a.quantity,0)),recommendations,settings:config,asOf:at.toISOString()};
}

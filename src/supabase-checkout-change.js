// Change preview is advisory; the server remains the authority for a confirmed sale.
// All values are integer centavos to avoid floating-point currency rounding.
import {toCents} from './supabase-shop-core.js';
export function checkoutCashPreview({method,totalCents,receivedRaw='',cashPortionRaw='0'}={}){
 if(method!=='cash'&&method!=='mixed')return {state:'hidden'};
 if(!Number.isSafeInteger(totalCents)||totalCents<0)return {state:'invalid'};
 if(totalCents===0)return {state:'empty'};
 let cashDue=totalCents;
 if(method==='mixed'){
  try{cashDue=toCents(cashPortionRaw||'0');}
  catch{return {state:'invalid_split'};}
  if(cashDue>totalCents)return {state:'invalid_split'};
  if(cashDue===0)return {state:'no_cash'};
 }
 if(String(receivedRaw??'').trim()==='')return {state:'waiting',cashDue};
 let received;
 try{received=toCents(receivedRaw);}catch{return {state:'invalid',cashDue};}
 const diff=received-cashDue;
 return {state:diff<0?'short':diff===0?'exact':'change',
  cashDue,received,change:Math.max(0,diff),shortfall:Math.max(0,-diff)};
}

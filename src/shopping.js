import {inventoryAlerts} from './alerts.js';
const permitted=new Set(['owner','manager','stock']);
function checkActor(actor){if(!actor||!permitted.has(actor.role))throw Error('permission');}
const q=n=>Math.round(n*1000)/1000;
export function createShoppingList(state,tenantId,input,actor){
 checkActor(actor);
 if(actor.tenantId!==tenantId)throw Error('tenant');
 const id=input?.id,reason=input?.reason;
 if(typeof id!=='string'||id.length<8||id.length>80||typeof reason!=='string'||!reason.trim()||reason.length>250)throw Error('shopping_input');
 const saved=(state.shoppingLists||[]).find(l=>l.id===id);
 if(saved){
  if(saved.tenantId===tenantId&&saved.createdBy===actor.id&&saved.reason===reason.trim())return state;
  throw Error('shopping_conflict');
 }
 const selected=inventoryAlerts(state,tenantId).recommendations;
 if(!selected.length)throw Error('nothing_to_order');
 const items=selected.map(i=>({productId:i.productId,name:i.productName,unit:i.unit,quantity:i.quantity,available:i.available,basis:i.basis}));
 const list={id,tenantId,createdBy:actor.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'draft',revision:0,reason:reason.trim(),items};
 return {...state,shoppingLists:[list,...(state.shoppingLists||[])]};
}
export function updateShoppingList(state,tenantId,input,actor){
 checkActor(actor);if(actor.tenantId!==tenantId)throw Error('tenant');
 const list=(state.shoppingLists||[]).find(l=>l.id===input.id&&l.tenantId===tenantId);
 if(!list)throw Error('shopping_not_found');
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==list.revision)throw Error('revision_conflict');
 if(!['draft','ordered','closed'].includes(input.status))throw Error('shopping_status');
 if(list.status==='closed')throw Error('shopping_closed');
 if(list.status==='ordered'&&input.status==='draft')throw Error('shopping_status');
 if(!Array.isArray(input.items)||input.items.length!==list.items.length)throw Error('shopping_items');
 const updatedItems=list.items.map((item,i)=>{
  const current=input.items[i];
  if(!current||current.productId!==item.productId||typeof current.quantity!=='number'||!Number.isFinite(current.quantity)||current.quantity<0||current.quantity>100000000||Math.abs(current.quantity*1000-Math.round(current.quantity*1000))>0.000001)throw Error('shopping_items');
  return {...item,quantity:q(current.quantity)};
 });
 if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>250)throw Error('shopping_input');
 if(input.status===list.status&&updatedItems.every((i,n)=>i.quantity===list.items[n].quantity))throw Error('no_change');
 const updated={...list,items:updatedItems,status:input.status,revision:list.revision+1,updatedAt:new Date().toISOString(),updatedBy:actor.id};
 const event={id:crypto.randomUUID(),tenantId,listId:list.id,actorId:actor.id,fromStatus:list.status,status:updated.status,reason:input.reason.trim(),createdAt:updated.updatedAt};
 return {...state,shoppingLists:state.shoppingLists.map(l=>l.id===list.id?updated:l),shoppingEvents:[event,...(state.shoppingEvents||[])]};
}
export function shoppingListMessage(list,lang='pt'){
 const heading=lang==='en'?'PRONTO POS — Shopping list':'PRONTO POS — Lista de compras';
 return [heading,...list.items.filter(i=>i.quantity>0).map((i,n)=>`${n+1}. ${i.name}: ${i.quantity} ${i.unit}`),'',lang==='en'?'Please confirm prices and quantities before ordering.':'Confirme preços e quantidades antes de efectuar a encomenda.'].join('\n');
}

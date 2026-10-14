// Suspended carts are not completed sales and do not reserve any stock.
// Browser storage is scoped to a shop and operator. Authenticated accounts use
// sessionStorage until server-side suspended-sale storage is available.
export const heldSaleMethods = ['cash','mpesa','emola','transfer','mixed','credit'];
const maxHolds = 100;
const maxLines = 500;
const validText = value => typeof value === 'string' && value.length <= 128;
const validQuantity = value => Number.isFinite(value) && value > 0 && value <= 100000000;

export function heldSalesStorageKey(tenantId,userId) {
 if (!validText(tenantId)||!tenantId||!validText(userId)||!userId) throw Error('held_owner');
 return 'pronto-held-sales-v1:' + encodeURIComponent(tenantId) + ':' + encodeURIComponent(userId);
}
export function makeHeldSale({id,tenantId,userId,cart,products,method='cash',received='',discountText='0',mixed={},customerId='',debtDueDate='',now=new Date().toISOString()}) {
 if (!validText(id)||!id||!validText(tenantId)||!tenantId||!validText(userId)||!userId) throw Error('held_owner');
 if (!Array.isArray(cart)||cart.length<1||cart.length>maxLines || !heldSaleMethods.includes(method)) throw Error('held_cart');
 const list = cart.map(line => {
  if (!validText(line.productId)||!line.productId||!validQuantity(line.quantity)) throw Error('held_cart');
  const product=products.find(p => p.id === line.productId && p.tenantId === tenantId);
  if (!product) throw Error('held_product');
  return {productId:line.productId,quantity:line.quantity,name:product.name,unit:product.unit,price:product.price};
 });
 const subtotal=list.reduce((sum,line)=>sum+Math.round(line.price*line.quantity),0);
 const discount=Number(discountText);
 const discountCents=Number.isFinite(discount)&&discount>=0?Math.round(discount*100):0;
 return {
  id,tenantId,userId,createdAt:now,
  cart:list.map(({productId,quantity})=>({productId,quantity})),
  lines:list,subtotal,total:Math.max(0,subtotal-discountCents),
  method,received:String(received).slice(0,30),discountText:String(discountText).slice(0,30),
  mixed:Object.fromEntries(['cash','mpesa','emola','transfer'].map(m=>[m,String(mixed?.[m]||'').slice(0,30)])),
  selectedCustomerId:String(customerId||'').slice(0,128),
  debtDueDate:String(debtDueDate||'').slice(0,30)
 };
}
export function eligibleHeldSales(holds,tenantId,userId) {
 if (!Array.isArray(holds)) return [];
 const seen=new Set();
 return holds.filter(hold => {
  if (!hold||typeof hold!=='object'||hold.tenantId!==tenantId||hold.userId!==userId||!validText(hold.id)||!hold.id||seen.has(hold.id)) return false;
  if (!Array.isArray(hold.cart)||hold.cart.length===0||hold.cart.length>maxLines) return false;
  if (!hold.cart.every(line=>line&&validText(line.productId)&&line.productId&&validQuantity(line.quantity))) return false;
  seen.add(hold.id);
  return true;
 }).slice(-maxHolds);
}
export function loadHeldSales(storage,tenantId,userId) {
 try {const raw=storage.getItem(heldSalesStorageKey(tenantId,userId));return eligibleHeldSales(JSON.parse(raw||'[]'),tenantId,userId);}
 catch {return [];}
}
export function persistHeldSales(storage,tenantId,userId,holds) {
 const selected=eligibleHeldSales(holds,tenantId,userId);
 // Never silently drop a suspended sale due to maximum capacity.
 if (selected.length!==holds.length||selected.length>maxHolds) throw Error('held_invalid');
 storage.setItem(heldSalesStorageKey(tenantId,userId),JSON.stringify(selected));
 return selected;
}
export function heldSaleChanged(held,products) {
 return held.lines?.some(line=>{
  const p=products.find(product=>product.id===line.productId&&product.tenantId===held.tenantId);
  return !p||p.active===false||p.price!==line.price||p.unit!==line.unit||p.stock<line.quantity;
 })||false;
}

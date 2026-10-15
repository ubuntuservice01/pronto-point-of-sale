// Supabase merchant pilot domain helpers. No floating-point money is sent to the DB.
export const PAYMENT_METHODS=['cash','mpesa','emola','transfer'];
export const UNIT_OPTIONS=['un','m','m²','kg','g','l','ml','caixa','pacote','saco','rolo','par','conjunto'];
export const INTEGER_UNITS=['un','caixa','pacote','saco','rolo','par','conjunto'];
export const MONEY=(cents)=>new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100)+' MT';
export const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function toCents(raw){
 const s=String(raw??'').trim().replace(/\.(?=\d{3}(?:[.,]|$))/g,'').replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('amount_invalid');
 const [w,d='']=s.split('.');
 const cents=Number(w)*100+Number(d.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents>999999999999)throw Error('amount_invalid');
 return cents;
}
export function toQuantity(raw,unit){
 const s=String(raw??'').trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,3})?$/.test(s))throw Error('quantity_invalid');
 const q=Number(s);
 if(!Number.isFinite(q)||q<=0||q>1000000||(INTEGER_UNITS.includes(unit)&&!Number.isInteger(q)))throw Error('quantity_invalid');
 return q;
}
export function normalizeMerchantSnapshot(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.products)||!Array.isArray(raw.branches)||!Array.isArray(raw.cash_sessions)||!Array.isArray(raw.recent_sales))throw Error('supabase_response');
 const products=raw.products.map(p=>({
  id:p.id,code:String(p.code||''),name:String(p.name||''),category:String(p.category||''),
  unit:String(p.unit||''),priceCents:Number(p.price_cents),stock:Number(p.stock),minStock:Number(p.min_stock),photoPath:p.photo_path||null
 })).filter(p=>p.id&&p.name&&Number.isSafeInteger(p.priceCents)&&p.priceCents>0&&Number.isFinite(p.stock));
 return {businessId:raw.business_id,branchId:raw.branch_id,role:raw.role,products,
  branches:raw.branches.map(b=>({id:b.id,name:String(b.name||'')})),
  sessions:raw.cash_sessions.map(s=>({id:s.id,operatorId:s.operator_id,openedAt:s.opened_at,openingCash:Number(s.opening_cash_cents||0)})),
  sales:raw.recent_sales.map(s=>({id:s.id,amount:Number(s.total_cents),sellerId:s.seller_id,method:s.method,date:s.created_at})),
  generatedAt:raw.generated_at||null};
}
export function cartTotal(cart,products,discountCents=0){
 const byId=new Map(products.map(p=>[p.id,p]));
 const seen=new Set();
 let subtotal=0;
 for(const item of cart){
  const p=byId.get(item.productId);
  if(!p||seen.has(p.id))throw Error('product_unavailable');
  seen.add(p.id);
  const q=toQuantity(item.quantity,p.unit);
  if(q>p.stock)throw Error('stock_unavailable');
  subtotal+=Math.round(p.priceCents*q);
 }
 if(!Number.isSafeInteger(discountCents)||discountCents<0||(subtotal>0&&discountCents>=subtotal))throw Error('discount_invalid');
 return {subtotal,total:subtotal-discountCents};
}
export function makeSaleRequest({businessId,branchId,sessionId,cart,products,discount='0',allocations,idempotencyKey,cashReceived='0'}){
 if(!Array.isArray(cart)||!cart.length||!Array.isArray(allocations))throw Error('cart_empty');
 const discountCents=toCents(discount);
 const totals=cartTotal(cart,products,discountCents);
 const methods=new Set();let paid=0,cash=0;
 const selected=allocations.map(({method,amount,reference=''})=>{
  if(!PAYMENT_METHODS.includes(method)||methods.has(method))throw Error('payment_invalid');
  methods.add(method);
  const cents=toCents(amount);
  if(cents<=0)throw Error('payment_invalid');
  if(method==='cash')cash=cents;
  paid+=cents;
  return {method,amount_cents:cents,reference:String(reference).slice(0,128)};
 });
 if(!selected.length||selected.length>4||paid!==totals.total)throw Error('payment_mismatch');
 const received=toCents(cashReceived);
 if(cash>received)throw Error('cash_short');
 return {business_id:businessId,branch_id:branchId,session_id:sessionId,idempotency_key:idempotencyKey,
  items:cart.map(item=>({product_id:item.productId,quantity:item.quantity})),
  discount_cents:discountCents,cash_received_cents:received,allocations:selected};
}

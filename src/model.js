export const units=['un','m','m²','kg','g','l','ml','caixa','pacote','saco','rolo','par','conjunto'];
export const roles=['owner','manager','cashier','stock','finance'];
export const permissions={owner:['sell','stock','team','history'],manager:['sell','stock','history'],cashier:['sell','history'],stock:['stock'],finance:['history']};
export const can=(role,action)=>(permissions[role]||[]).includes(action);
export function seed(){return {version:1,tenants:[{id:'t1',name:'Mercearia Boa Compra',type:'Mercearia',owner:'Gabriel'},{id:'t2',name:'Ferragem Horizonte',type:'Ferragem',owner:'Ana'}],products:[
{id:'p1',tenantId:'t1',name:'Arroz',category:'Alimentação',unit:'kg',price:8500,stock:48,min:10,code:'10001',emoji:'🍚'},
{id:'p2',tenantId:'t1',name:'Óleo alimentar',category:'Alimentação',unit:'l',price:15500,stock:24,min:6,code:'10002',emoji:'🫙'},
{id:'p3',tenantId:'t1',name:'Sabonete',category:'Higiene',unit:'un',price:4500,stock:8,min:10,code:'10003',emoji:'🧼'},
{id:'p4',tenantId:'t1',name:'Açúcar',category:'Alimentação',unit:'kg',price:7500,stock:35,min:8,code:'10004',emoji:'🥣'},
{id:'p5',tenantId:'t1',name:'Creme hidratante',category:'Cuidados pessoais',unit:'un',price:28000,stock:12,min:4,code:'10005',emoji:'🧴'},
{id:'p6',tenantId:'t2',name:'Cabo eléctrico',category:'Electricidade',unit:'m',price:6500,stock:100,min:15,code:'20001',emoji:'🔌'},
{id:'p7',tenantId:'t2',name:'Cimento 50 kg',category:'Construção',unit:'saco',price:48000,stock:30,min:5,code:'20002',emoji:'🧱'}],sales:[],members:[{id:'u1',tenantId:'t1',name:'Gabriel',role:'owner'},{id:'u2',tenantId:'t1',name:'Maria',role:'cashier'},{id:'u3',tenantId:'t2',name:'Ana',role:'owner'}]};}
export function createSale(state,{tenantId,role,cart,method,received,deviceId,id,userId}){
if(!can(role,'sell'))throw Error('permission');
if(state.sales.some(s=>s.id===id))return state;
if(!state.tenants.some(t=>t.id===tenantId)||!cart.length)throw Error('cart');
const seen=new Set();
const lines=cart.map(item=>{const p=state.products.find(p=>p.id===item.productId&&p.tenantId===tenantId);if(!p||seen.has(p.id))throw Error('product');seen.add(p.id);const qty=Number(item.quantity);if(!Number.isFinite(qty)||qty<=0||qty>p.stock)throw Error('stock');if(['un','caixa','pacote','saco','rolo','par','conjunto'].includes(p.unit)&&!Number.isInteger(qty))throw Error('quantity');return {productId:p.id,name:p.name,unit:p.unit,quantity:qty,price:p.price,total:Math.round(p.price*qty)};});
const total=lines.reduce((sum,line)=>sum+line.total,0);
if(!['cash','mpesa','emola','transfer'].includes(method))throw Error('payment');
if(method==='cash'&&(!Number.isSafeInteger(received)||received<total))throw Error('received');
const sale={id,tenantId,deviceId,userId,createdAt:new Date().toISOString(),lines,total,method,received:method==='cash'?received:total,change:method==='cash'?received-total:0,syncStatus:'local'};
return {...state,products:state.products.map(p=>{const line=lines.find(l=>l.productId===p.id);return line?{...p,stock:Math.round((p.stock-line.quantity)*1000)/1000}:p;}),sales:[sale,...state.sales]};
}
export function addProduct(state,tenantId,product){if(!state.tenants.some(t=>t.id===tenantId))throw Error('tenant');if(!product.name.trim()||!units.includes(product.unit)||!Number.isSafeInteger(product.price)||product.price<=0||!Number.isFinite(product.stock)||product.stock<0||!Number.isFinite(product.min)||product.min<0)throw Error('product');if(['un','caixa','pacote','saco','rolo','par','conjunto'].includes(product.unit)&&!Number.isInteger(product.stock))throw Error('quantity');if(product.code&&state.products.some(p=>p.tenantId===tenantId&&p.code===product.code))throw Error('code');return {...state,products:[...state.products,{...product,id:crypto.randomUUID(),tenantId}]};}

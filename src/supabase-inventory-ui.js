// Authenticated inventory administration and alerts. Snapshot from protected RPC.
import {esc,MONEY,UNIT_OPTIONS} from './supabase-shop-core.js';
const qty=x=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:3}).format(Number(x)||0);
const str=x=>String(x??'');
const field=(name,label,value='',attrs='')=>'<label>'+esc(label)+'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'></label>';
const box=(title,body,note='')=>'<section class="shop-box"><h3>'+esc(title)+'</h3>'+(note?'<p class="shop-help">'+esc(note)+'</p>':'')+body+'</section>';
export function normalizeInventorySnapshot(raw){
 if(!raw||!Array.isArray(raw.products)||!Array.isArray(raw.batches)||!Array.isArray(raw.movements)||!Array.isArray(raw.suggestions))throw Error('inventory_snapshot_invalid');
 return {
  products:raw.products.map(p=>({id:p.id,name:str(p.name),code:str(p.code),category:str(p.category),
   unit:str(p.unit),priceCents:Number(p.price_cents),stock:Number(p.stock),minStock:Number(p.min_stock),
   revision:Number(p.revision),active:p.active===true,photoPath:p.photo_path||null})),
  batches:raw.batches.map(b=>({id:b.id,productId:b.product_id,lot:str(b.lot_number),
   expiry:b.expires_on,qty:Number(b.qty),unitCost:Number(b.unit_cost_cents||0)})),
  movements:raw.movements.map(m=>({id:m.id,productId:m.product_id,kind:m.kind,
   delta:Number(m.qty_delta),reason:str(m.reason),date:m.created_at})),
  suggestions:raw.suggestions.map(x=>({productId:x.product_id,name:str(x.name),
   available:Number(x.available_qty),minimum:Number(x.min_stock),sold30:Number(x.sold_last_30_days),
   suggested:Number(x.suggested_qty),low:x.low_stock===true})),
  today:raw.today,generatedAt:raw.generated_at
 };
}
export function inventoryAlerts(inventory,days=30){
 if(!inventory)return {low:[],expiring:[],expired:[],suggestions:[]};
 const d=new Date(String(inventory.today)+'T12:00:00Z');
 const dateLimit=new Date(d.getTime()+Math.max(1,Math.min(365,days))*86400000).toISOString().slice(0,10);
 return {
  low:inventory.suggestions.filter(x=>x.low),
  expiring:inventory.batches.filter(x=>x.expiry&&x.expiry>=inventory.today&&x.expiry<=dateLimit),
  expired:inventory.batches.filter(x=>x.expiry&&x.expiry<inventory.today),
  suggestions:inventory.suggestions.filter(x=>x.suggested>0)
 };
}
const options=items=>items.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+esc(p.code)+'</option>').join('');
export function renderInventoryView({view,inventory,role,selectedProductId='',alertDays=30,query=''}) {
 if(!inventory)return box('Inventário','<p></p>');
 const products=inventory.products.filter(p=>(p.name+' '+p.code).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const chosen=inventory.products.find(p=>p.id===selectedProductId);
 const alert=inventoryAlerts(inventory,alertDays);
 if(view==='alerts'||view==='shopping_list'){
  const table=alert.suggestions.map(x=>{
   const p=inventory.products.find(p=>p.id===x.productId);
   return '<tr><td>'+esc(x.name)+'</td><td>'+qty(x.available)+' '+esc(p?.unit||'')+'</td>'+
    '<td>'+qty(x.sold30)+'</td><td><strong>'+qty(x.suggested)+'</strong></td></tr>';
  }).join('');
  return '<div class="shop-two">'+box('Alertas inteligentes',
   '<label>Dias de antecedência<select id="shop-alert-days">'+[7,15,30,60,90].map(v=>
    '<option value="'+v+'"'+(v===alertDays?' selected':'')+'>'+v+' dias</option>').join('')+'</select></label>'+
   '<p class="credit-warning">'+alert.low.length+' artigo(s) com stock baixo · '+alert.expiring.length+
   ' lote(s) a vencer · '+alert.expired.length+' lote(s) vencido(s).</p>'+
   '<h4>Stock baixo</h4>'+alert.low.slice(0,100).map(x=>'<div class="credit-line">'+esc(x.name)+
    ' · Disponível '+qty(x.available)+' / mínimo '+qty(x.minimum)+'</div>').join('')+
   '<h4>Validades próximas</h4>'+alert.expiring.map(x=>'<div class="credit-line">'+
    esc(inventory.products.find(p=>p.id===x.productId)?.name||'Produto')+' · '+esc(x.expiry)+
    ' · '+qty(x.qty)+'</div>').join('')+
   '<h4>Produtos vencidos</h4>'+alert.expired.map(x=>'<div class="credit-line">'+
    esc(inventory.products.find(p=>p.id===x.productId)?.name||'Produto')+' · '+esc(x.expiry)+
    ' · '+qty(x.qty)+' (não disponível para venda)</div>').join(''),
   'A validade e disponibilidade são verificadas pelo servidor; o utilizador deve separar produtos vencidos fisicamente.')+
   box('Lista automática de compras',
    '<p class="shop-help">Sugestões para cerca de 14 dias de vendas, considerando o consumo dos últimos 30 dias, stock disponível não vencido e stock mínimo. É uma estimativa, não uma encomenda.</p>'+
    '<div class="credit-list"><table class="shop-table"><thead><tr><th>Produto</th><th>Disponível</th><th>Vendas 30 dias</th><th>Comprar</th></tr></thead><tbody>'+table+'</tbody></table></div>'+
    '<button type="button" data-inventory-export>Exportar sugestões CSV</button>',
    'Reveja e confirme quantidades antes de comprar. O sistema não envia encomendas automaticamente.')+'</div>';
 }
 return '<div class="shop-two">'+box('Produtos e inventário',
  '<label>Pesquisar produto<input id="shop-inventory-search" type="search" value="'+esc(query)+'" placeholder="Nome ou código"></label>'+
  '<div class="credit-list">'+products.slice(0,300).map(p=>
   '<button type="button" class="credit-list-item" data-inventory-select="'+esc(p.id)+'"><strong>'+
   esc(p.name)+'</strong><small>'+esc(p.code)+' · '+qty(p.stock)+' '+esc(p.unit)+
   ' · '+(p.active?'Activo':'Inactivo')+'</small></button>').join('')+'</div>'+
  '<h4>Movimentos de stock</h4>'+inventory.movements.slice(0,50).map(m=>
   '<div class="credit-line">'+esc(inventory.products.find(p=>p.id===m.productId)?.name||'Produto')+
   ' · '+qty(m.delta)+' · '+esc(m.kind)+' · '+esc(m.reason)+'</div>').join(''),
  'Inventário autorizado por filial. Todas as alterações ficam registadas.')+
  box(chosen?'Gerir '+chosen.name:'Seleccionar produto',chosen?
   '<form data-shop-form="photo_upload" class="shop-form">'+
    '<h4>Fotografia do produto</h4>'+
    '<input type="hidden" name="product_id" value="'+esc(chosen.id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(chosen.revision)+'">'+
    (chosen.photoPath?'<img class="shop-product-photo shop-photo-preview" data-shop-product-photo="'+esc(chosen.photoPath)+'" alt="Fotografia de '+esc(chosen.name)+'" loading="lazy">':'')+
    '<label>Escolher imagem ou fotografar (JPEG, PNG ou WebP até 3 MB)'+
    '<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" required></label>'+
    '<button class="shop-submit" type="submit">Guardar fotografia</button></form>'+
   (['owner','manager'].includes(role)?
    '<form data-shop-form="product_update" class="shop-form"><input type="hidden" name="product_id" value="'+esc(chosen.id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(chosen.revision)+'">'+
    field('name','Nome',chosen.name,'required maxlength="200"')+
    field('category','Categoria',chosen.category,'required maxlength="100"')+
    '<label>Unidade<select name="unit">'+UNIT_OPTIONS.map(u=>'<option value="'+esc(u)+'"'+(u===chosen.unit?' selected':'')+'>'+esc(u)+'</option>').join('')+'</select></label>'+
    field('price','Preço de venda (MT)',(chosen.priceCents/100).toFixed(2),'required type="number" min="0.01" step="0.01"')+
    field('min_stock','Stock mínimo',chosen.minStock,'required type="number" min="0" step="0.001"')+
    '<label><input type="checkbox" name="active" '+(chosen.active?'checked':'')+'> Activo para venda</label>'+
    '<button class="shop-submit" type="submit">Guardar alterações</button></form>':'')+
   '<h4>Conferência e ajuste físico</h4><form data-shop-form="inventory_count" class="shop-form">'+
    '<input type="hidden" name="product_id" value="'+esc(chosen.id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(chosen.revision)+'">'+
    field('counted_qty','Quantidade contada',chosen.stock,'required type="number" min="0" step="0.001"')+
    field('reason','Motivo da conferência','','required minlength="3" maxlength="180"')+
    '<button class="shop-submit" type="submit">Confirmar inventário físico</button></form>'+
   '<form data-shop-form="inventory_adjust" class="shop-form"><h4>Ajuste de stock com motivo</h4>'+
    '<input type="hidden" name="product_id" value="'+esc(chosen.id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(chosen.revision)+'">'+
    field('delta','Quantidade (+ entrada; - quebra)','','required type="number" step="0.001"')+
    field('reason','Justificação','','required minlength="3" maxlength="180"')+
    '<label>Validade em caso de entrada<input type="date" name="expires_on"></label>'+
    '<button class="shop-submit" type="submit">Registar ajuste</button></form>'+
   '<h4>Lotes disponíveis</h4>'+inventory.batches.filter(b=>b.productId===chosen.id)
    .map(b=>'<div class="credit-line">'+esc(b.lot||'Sem número')+' · '+qty(b.qty)+
     ' · Validade '+esc(b.expiry||'Sem data')+'</div>').join(''):
   '<p class="shop-help">Escolha um produto à esquerda.</p>',
  'As alterações de preços exigem proprietário ou gerente. Não altere a unidade de um artigo com stock ou histórico.')+'</div>';
}
export function shoppingListCSV(inventory){
 const rows=[['Produto','Disponível','Vendido_30_dias','Quantidade_sugerida']];
 for(const x of inventoryAlerts(inventory).suggestions)rows.push([x.name,String(x.available),String(x.sold30),String(x.suggested)]);
 return '\uFEFF'+rows.map(row=>row.map(value=>{const raw=String(value);const safe=/^[\s]*[=+@\-\t\r]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');
}

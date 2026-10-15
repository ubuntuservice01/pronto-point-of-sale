// Inventory transfers between branches: dispatched stock becomes "in transit" until
// the destination confirms receipt. No sale/payment is created by this workflow.
import {esc} from './supabase-shop-core.js';
const qty=n=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:3}).format(Number(n)||0);
const formField=(name,label,html)=>'<label>'+esc(label)+html+'</label>';
const opts=items=>'<option value="">Seleccione</option>'+items.map(x=>
 '<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
export function normalizeTransferSnapshot(raw){
 if(!raw||!Array.isArray(raw.transfers))throw Error('transfer_snapshot_invalid');
 return {transfers:raw.transfers.map(t=>({
  id:t.id,sourceBranchId:t.source_branch_id,targetBranchId:t.target_branch_id,
  status:t.status,reason:String(t.reason||''),createdAt:t.created_at,receivedAt:t.received_at,
  lines:Array.isArray(t.lines)?t.lines.map(l=>({
   productId:l.product_id,name:String(l.product_name||''),code:String(l.product_code||''),
   quantity:Number(l.quantity)||0,lot:String(l.lot_number||'')
  })):[]
 }))};
}
export function transferFormRows(products,count){
 return Array.from({length:Math.min(10,Math.max(1,count))},(_,i)=>
  '<div class="finance-purchase-line"><strong>Artigo '+(i+1)+'</strong>'+
  formField('product_id_'+i,'Produto de origem',
   '<select name="product_id_'+i+'" required>'+opts(products.map(p=>({
    id:p.id,name:p.name+' · '+p.code+' (disponível '+qty(p.stock)+' '+p.unit+')'
   })))+'</select>')+
  formField('quantity_'+i,'Quantidade a transferir',
   '<input type="number" name="quantity_'+i+'" min="0.001" step="0.001" required>')+
  '</div>').join('');
}
export function renderTransfersView({snapshot,branches=[],branchId='',products=[],
 role='owner',lineCount=1,pendingTransfer=null}={}){
 if(!snapshot)return '<section class="shop-box"><h3>Transferências</h3><p>A consultar stock em trânsito…</p></section>';
 const canWrite=['owner','manager','stock'].includes(role);
 const eligible=branches.filter(b=>b.id!==branchId&&b.active!==false);
 const names=new Map(branches.map(b=>[b.id,b.name]));
 const history=snapshot.transfers;
 const outgoing=history.filter(t=>t.status==='in_transit'&&t.sourceBranchId===branchId);
 const incoming=history.filter(t=>t.status==='in_transit'&&t.targetBranchId===branchId);
 const format=t=>{
  const source=names.get(t.sourceBranchId)||'Filial origem';
  const target=names.get(t.targetBranchId)||'Filial destino';
  return '<article class="credit-debt-item"><strong>'+esc(source)+' → '+esc(target)+'</strong>'+
   '<span class="credit-tag">'+esc(t.status==='in_transit'?'Em trânsito':t.status==='received'?'Recebida':'Cancelada')+'</span>'+
   '<p>'+t.lines.map(l=>esc(l.name)+' · '+qty(l.quantity)).join('; ')+'</p>'+
   '<small>'+esc(t.reason)+' · '+esc(String(t.createdAt||'').slice(0,16))+'</small>'+
   (canWrite&&t.status==='in_transit'?
    '<div class="credit-debt-actions">'+
    (t.targetBranchId===branchId?'<button type="button" data-transfer-receive="'+esc(t.id)+'">Confirmar recepção</button>':'')+
    (t.sourceBranchId===branchId?'<button type="button" data-transfer-cancel="'+esc(t.id)+'">Cancelar expedição</button>':'')+
    '</div>':'')+'</article>';
 };
 return '<div class="shop-two"><section class="shop-box"><h3>Transferir stock</h3>'+
  '<p class="shop-help">O envio retira imediatamente os artigos da origem. O destino só os recebe após confirmação. Não é uma venda e não altera o caixa.</p>'+
  (pendingTransfer?'<div class="shop-pending"><strong>Expedição por confirmar</strong>'+
   '<p>Consulte o histórico. Se precisar reenviar, será usada a mesma referência para evitar duplicação.</p>'+
   '<button type="button" data-transfer-clear>Descartar referência após conferência</button></div>':'')+
  (canWrite?'<form data-shop-form="transfer_send" class="shop-form">'+
   '<label>Filial de destino<select name="target_branch_id" required>'+
   opts(eligible.map(b=>({id:b.id,name:b.name})))+'</select></label>'+
   '<div class="transfer-form-lines">'+transferFormRows(products,lineCount)+'</div>'+
   '<button type="button" data-transfer-add>+ Adicionar artigo</button>'+
   formField('reason','Motivo da transferência',
    '<input name="reason" required minlength="3" maxlength="250" placeholder="Reposição de stock">')+
   '<label><input type="checkbox" name="confirmed" required> Confirmei as quantidades e o destino</label>'+
   '<button class="shop-submit" type="submit" '+(!eligible.length?'disabled':'')+'>Expedir para a outra filial</button></form>':
   '<p class="shop-help">A consulta está disponível. Só proprietário, gerente ou responsável de stock pode expedir e receber.</p>')+
  '</section><section class="shop-box"><h3>Movimentos entre filiais</h3>'+
   '<p class="shop-help">A receber nesta filial: '+incoming.length+' · A enviar: '+outgoing.length+
    '. Artigos em trânsito não estão disponíveis para venda.</p>'+
   (history.length?history.map(format).join(''):'<p class="shop-help">Ainda não há transferências registadas.</p>')+
  '</section></div>';
}

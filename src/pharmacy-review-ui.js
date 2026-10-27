// Pharmacy reviews: per-sale request queue, approved by an independently verified professional.
// No patient name or prescription photographs are sent or stored.
import {esc} from './supabase-shop-core.js';
export const rxItems=(cart,products)=>cart.filter(i=>products.some(p=>p.id===i.productId&&p.requiresPrescription===true));
export function renderPharmacyReviews(snapshot){
 if(!snapshot)return '<section class="shop-box"><h3>Validação de receitas</h3><p class="shop-help">A carregar os pedidos autorizados da filial…</p></section>';
 const approved=snapshot.can_approve===true;
 const pending=Array.isArray(snapshot.requests)?snapshot.requests:[];
 return '<section class="shop-box"><h3>💊 Validação de receitas</h3>'+
  '<p class="shop-help">Cada pedido está associado a uma venda preparada por um vendedor e expira após 30 minutos. Consulte a receita física antes de validar. Não registe nome ou dados clínicos do paciente.</p>'+
  '<p class="'+(approved?'shop-help':'shop-error')+'">'+
   (approved?'Profissional verificado para este estabelecimento. Pode validar os pedidos apresentados.':
   'A autorização está reservada a profissionais cuja habilitação tenha sido verificada pelo Super Administrador.')+'</p>'+
  (pending.length?pending.map(q=>'<article class="credit-debt-item">'+
    '<strong>'+esc(q.name||'Medicamento')+'</strong>'+
    '<small> · Quantidade '+esc(q.quantity)+' · Pedido '+esc(q.sale_key)+'</small>'+
    '<p class="shop-help">Expira: '+esc(q.expires_at||'')+' · '+(q.approved?'Autorizado — vendedor pode concluir':'Por validar')+'</p>'+
    (approved&&!q.approved?'<form data-shop-form="pharmacy_approve" class="shop-form">'+
      '<input name="sale_key" type="hidden" value="'+esc(q.sale_key)+'">'+
      '<input name="product_id" type="hidden" value="'+esc(q.product_id)+'">'+
      '<label>Referência da receita verificada (sem dados pessoais)<input name="prescription_reference" required maxlength="100" minlength="4" autocomplete="off" placeholder="Número de referência documental"></label>'+
      '<label class="shop-confirm"><input type="checkbox" name="checked" required> Confirmei pessoalmente a receita e a adequação desta dispensação.</label>'+
      '<button class="shop-submit" type="submit">Autorizar este medicamento</button></form>':'')+
   '</article>').join(''):'<p class="shop-help">Não existem pedidos pendentes nesta filial.</p>')+
  '<button type="button" data-shop-pharmacy-refresh class="secondary">Actualizar pedidos</button></section>';
}

// Pharmacy traceability: only business-scoped summaries are displayed.
// No patient data or prescription reference leaves the server.
import {esc} from './supabase-shop-core.js';

const qty=n=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:3}).format(Number(n)||0);
const state=(lot,today)=>{
 if(lot.held)return ['Bloqueado','shop-error'];
 if(!lot.expires_on)return ['Sem validade','shop-error'];
 if(lot.expires_on<=today)return ['Vencido','shop-error'];
 const days=Math.floor((Date.parse(lot.expires_on+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 return days<=30?['Até 30 dias','shop-low']:days<=60?['31–60 dias','shop-low']:days<=90?['61–90 dias','shop-low']:['Disponível','shop-help'];
};
export function renderPharmacyTrace(snapshot,{from='',to='',role='stock'}={}){
 if(!snapshot)return '<section class="shop-box"><h3>Rastreabilidade farmacêutica</h3><p class="shop-help">A carregar dados da filial…</p></section>';
 const lots=Array.isArray(snapshot.lots)?snapshot.lots:[];
 const disp=Array.isArray(snapshot.dispensations)?snapshot.dispensations:[];
 const totals=snapshot.totals||{};
 const editable=['owner','manager'].includes(role);
 const summary=[
 ['Movimentos de saída',totals.sale_movements],
 ['Quantidade dispensada',totals.sale_quantity],
 ['Saídas com receita',totals.rx_dispensed],
 ['Lotes bloqueados',totals.held_batches],
 ['Lotes vencidos',totals.expired_batches]
 ];
 const badge=summary.map(([label,value])=>'<div class="shop-box"><small>'+esc(label)+'</small><strong style="display:block;font-size:1.4rem">'+esc(qty(value))+'</strong></div>').join('');
 const lotRows=lots.map(b=>{
  const [label,klass]=state(b,snapshot.today);
  const current=Number(b.qty)>0;
  return '<article class="credit-debt-item">'+
    '<strong>'+esc(b.product_name)+'</strong> <small>'+esc(b.product_code||'')+'</small>'+
    '<p class="shop-help">Lote: <strong>'+esc(b.lot_number||'Sem número')+'</strong> · Validade: '+esc(b.expires_on||'Sem data')+
    ' · Stock: '+esc(qty(b.qty))+'</p>'+
    '<p class="'+klass+'"><strong>'+label+'</strong>'+
    (b.held?' · Motivo: '+esc(b.hold_reason||''):'')+'</p>'+
    (editable?(b.held?'<form data-shop-form="pharmacy_lot_action" class="shop-form">'+
      '<input type="hidden" name="batch_id" value="'+esc(b.batch_id)+'">'+
      '<input type="hidden" name="operation" value="release">'+
      '<label>Justificação do desbloqueio<textarea name="reason" rows="2" minlength="12" maxlength="500" required></textarea></label>'+
      '<button class="secondary" type="submit" '+(!b.expires_on||b.expires_on<=snapshot.today?'disabled':'')+'>Desbloquear lote</button></form>':
      current?'<form data-shop-form="pharmacy_lot_action" class="shop-form">'+
      '<input type="hidden" name="batch_id" value="'+esc(b.batch_id)+'">'+
      '<input type="hidden" name="operation" value="hold">'+
      '<label>Motivo do bloqueio (recolha, suspeita ou qualidade)<textarea name="reason" rows="2" minlength="12" maxlength="500" required></textarea></label>'+
      '<button class="shop-submit" type="submit">Bloquear este lote para venda e transferência</button></form>':''):'')+
    '</article>';
 }).join('');
 const events=disp.map(e=>'<tr><td>'+esc(String(e.date||'').slice(0,19).replace('T',' '))+'</td>'+
  '<td>'+esc(e.product_name)+'</td><td>'+esc(e.lot_number||'—')+'</td>'+
  '<td>'+esc(qty(e.quantity))+'</td><td>'+esc(e.requires_prescription?'Receita validada':'Sem marcação de receita')+'</td>'+
  '<td>'+esc(e.approved_by||'—')+'</td></tr>').join('');
 return '<div class="shop-two"><section class="shop-box"><h3>💊 Rastreabilidade farmacêutica</h3>'+
   '<p class="shop-help">Movimentos e lotes da filial actual. O bloqueio preventivo impede novas vendas e transferências do lote identificado, sem eliminar o stock físico. Não substitui o procedimento de recolha oficial.</p>'+
   '<form data-shop-form="pharmacy_trace_filter" class="shop-form">'+
   '<label>Desde<input type="date" name="from" value="'+esc(from||snapshot.from)+'" required></label>'+
   '<label>Até<input type="date" name="to" value="'+esc(to||snapshot.to)+'" required></label>'+
   '<button class="shop-submit" type="submit">Actualizar relatório</button></form>'+
   '<div class="shop-totals">'+badge+'</div>'+
   '<button type="button" class="secondary" data-pharmacy-trace-csv>Exportar histórico CSV</button>'+
   '<p class="shop-help">Até 150 movimentos mais recentes no período e 200 lotes com stock ou bloqueio. As contagens abrangem todo o período seleccionado.</p></section>'+
   '<section class="shop-box"><h3>Controlo de lotes ('+lots.length+')</h3>'+
   (lotRows||'<p class="shop-help">Sem lotes com stock ou bloqueio nesta filial.</p>')+'</section>'+
   '<section class="shop-box"><h3>Histórico de saídas ('+disp.length+')</h3>'+
   '<div class="credit-list"><table class="shop-table"><thead><tr><th>Data</th><th>Medicamento</th><th>Lote</th><th>Qt.</th><th>Autorização</th><th>Profissional</th></tr></thead><tbody>'+
   events+'</tbody></table></div>'+
   (!disp.length?'<p class="shop-help">Sem saídas registadas no período.</p>':'')+
   '</section></div>';
}
export function pharmacyTraceCSV(snapshot){
 if(!snapshot||!Array.isArray(snapshot.dispensations))throw Error('pharmacy_trace_missing');
 const head=['Data','Venda','Medicamento','Lote','Validade','Quantidade','Receita validada','Profissional responsável'];
 const rows=snapshot.dispensations.map(x=>[
  String(x.date||''),String(x.sale_id||''),String(x.product_name||''),
  String(x.lot_number||''),String(x.expires_on||''),
  String(x.quantity||0),x.requires_prescription?'Sim':'Não',String(x.approved_by||'')
 ]);
 const safe=value=>{
  const str=String(value).replace(/^[\s]*[=+\-@\t\r]/,match=>"'"+match);
  return '"'+str.replace(/"/g,'""')+'"';
 };
 return '\uFEFF'+[head,...rows].map(x=>x.map(safe).join(';')).join('\r\n');
}

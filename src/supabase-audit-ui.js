// Owner-only audit history. The RPC deliberately excludes arbitrary/raw payload
// which can contain customer PII, payment details or security metadata.
import {esc} from './supabase-shop-core.js';
export function normalizeAuditSnapshot(raw){
 if(!raw||!Array.isArray(raw.events)||!Number.isInteger(raw.page)||
  typeof raw.has_more!=='boolean')throw Error('audit_snapshot_invalid');
 return {
  page:raw.page,hasMore:raw.has_more,limit:Number(raw.limit)||50,
  events:raw.events.filter(e=>e&&e.id&&e.event).map(e=>({
   id:String(e.id),event:String(e.event),actor:String(e.actor_name||'Operador'),
   createdAt:e.created_at,targetId:e.target_id?String(e.target_id):null
  }))
 };
}
const eventNames={
 'team.staff_assigned':'Colaborador associado',
 'team.role_change':'Função de colaborador alterada',
 'team.suspend':'Acesso de colaborador suspenso',
 'team.reactivate':'Acesso de colaborador reactivado',
 'stock.transfer_send':'Transferência de stock expedida',
 'stock.transfer_receive':'Transferência de stock recebida',
 'stock.transfer_cancel':'Transferência de stock cancelada',
 'stock.csv_import':'Produtos importados por CSV',
 'finance.purchase_receive':'Compra de mercadorias',
 'finance.purchase_payment':'Pagamento a fornecedor',
 'finance.expense_add':'Despesa registada',
 'finance.expense_schedule_save':'Despesa recorrente programada',
 'pos.return_confirm':'Devolução registada',
 'pos.cash_move':'Movimento de caixa',
 'pos.hold_save':'Venda suspensa',
 'pos.hold_delete':'Venda suspensa eliminada'
};
const fmtDate=d=>{
 const value=new Date(d);
 return Number.isFinite(value.getTime())?value.toLocaleString('pt-PT',{timeZone:'Africa/Maputo',dateStyle:'short',timeStyle:'short'}):'—';
};
export function filterAuditEvents(snapshot,search=''){
 if(!snapshot)return[];
 const q=String(search).trim().toLocaleLowerCase();
 if(!q)return snapshot.events;
 return snapshot.events.filter(e=>(eventNames[e.event]||e.event).toLocaleLowerCase().includes(q)||
  e.actor.toLocaleLowerCase().includes(q)||e.event.toLocaleLowerCase().includes(q));
}
export function renderAuditView({audit=null,search=''}={}){
 if(!audit)return '<section class="shop-box"><h3>Histórico de actividades</h3><p></p></section>';
 const rows=filterAuditEvents(audit,search);
 return '<section class="shop-box"><h3>Histórico de actividades</h3>'+
 '<p class="shop-help">Consulta restrita ao proprietário desta empresa. Mostra quem realizou alterações importantes, sem expor palavras-passe, PIN, contactos dos clientes ou dados internos dos pagamentos.</p>'+
 '<label>Pesquisar nesta página<input id="shop-audit-search" type="search" value="'+esc(search)+'" placeholder="Evento ou colaborador"></label>'+
 '<div class="audit-history" role="table" aria-label="Actividades registadas">'+
 (rows.length?rows.map(e=>'<article class="audit-record" role="row">'+
  '<strong>'+esc(eventNames[e.event]||e.event)+'</strong>'+
  '<small>'+esc(fmtDate(e.createdAt))+' · '+esc(e.actor)+'</small>'+
  (e.targetId?'<span>Referência: '+esc(e.targetId.slice(0,8))+'</span>':'')+
  '</article>').join(''):'<p class="shop-help">Sem actividades nesta página para os filtros seleccionados.</p>')+
 '</div><div class="audit-pagination">'+
 '<button type="button" data-audit-prev '+(audit.page===0?'disabled':'')+'>Anterior</button>'+
 '<span>Página '+(audit.page+1)+'</span>'+
 '<button type="button" data-audit-next '+(!audit.hasMore?'disabled':'')+'>Seguinte</button>'+
 '<button type="button" data-audit-export>Exportar CSV desta página</button>'+
 '</div><p class="shop-help">A pesquisa e a exportação abrangem apenas os registos desta página. Os eventos são imutáveis para o comerciante.</p></section>';
}
const cell=value=>{
 let s=String(value??'').replace(/[\r\n]+/g,' ').replace(/"/g,'""');
 if(/^[\s]*[=+@-]/.test(s))s="'"+s;
 return '"'+s+'"';
};
export function auditCSV(audit){
 if(!audit)throw Error('audit_snapshot_invalid');
 const headings=['Data','Actividade','Colaborador','Referência'];
 return '\uFEFF'+headings.map(cell).join(';')+'\r\n'+
 audit.events.map(e=>[fmtDate(e.createdAt),eventNames[e.event]||e.event,e.actor,e.targetId||'']
  .map(cell).join(';')).join('\r\n');
}

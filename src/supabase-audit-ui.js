// Owner-only audit history. The RPC deliberately excludes arbitrary/raw payload
// which can contain customer PII, payment details or security metadata.
import {esc,MONEY} from './supabase-shop-core.js';
const fieldLabels={
 price_cents:'Preço',unit:'Unidade',stock:'Stock',min_stock:'Stock mínimo',
 active:'Activo',allow_fractional:'Venda fraccionada',status:'Estado',role:'Perfil',
 amount_cents:'Valor',total_cents:'Total',balance_cents:'Saldo',
 credit_limit_cents:'Limite de crédito',credit_blocked:'Crédito bloqueado',
 opening_cash_cents:'Fundo de abertura',counted_cash_cents:'Valor contado',
 opening_required:'Abertura obrigatória',blind_close:'Fecho cego',
 schedule_enabled:'Horário activo',start_time:'Início do horário',end_time:'Fim do horário',
 manual_mode:'Controlo manual',qty_delta:'Variação do stock',quantity:'Quantidade',qty:'Quantidade',
 due_on:'Vencimento',next_due_on:'Próxima data',repeat_months:'Repetição em meses',
 expires_at:'Validade',cancelled:'Cancelado',reversed_at:'Data de reversão',
 close_type:'Tipo de fecho',emergency_difference_cents:'Diferença de caixa'
};
const entityLabels={products:'Produto',customers:'Cliente',suppliers:'Fornecedor',
 expenses:'Despesa',expense_schedules:'Lembrete de despesa',purchases:'Compra',
 cash_sessions:'Sessão de caixa',cash_policies:'Regra de caixa',cash_movements:'Movimento de caixa',
 debts:'Dívida',debt_payments:'Cobrança',memberships:'Colaborador',
 staff_access_rules:'Acesso de colaborador',document_settings:'Modelo de documento',
 branches:'Filial',businesses:'Empresa',sales:'Venda',refunds:'Devolução',
 stock_transfers:'Transferência de stock',stock_movements:'Movimento de stock',
 subscriptions:'Subscrição',held_sales:'Venda suspensa'};
const safeScalar=x=>x===null||['string','number','boolean'].includes(typeof x);
const changesFor=e=>{
 if(typeof e.event!=='string'||!e.event.startsWith('record.'))return[];
 const before=e.before&&typeof e.before==='object'&&!Array.isArray(e.before)?e.before:{};
 const after=e.after&&typeof e.after==='object'&&!Array.isArray(e.after)?e.after:{};
 const changed=Array.isArray(e.changed_fields)?e.changed_fields:[];
 return changed.filter(key=>Object.hasOwn(fieldLabels,key)&&
  safeScalar(before[key])&&safeScalar(after[key])).slice(0,6).map(key=>({
  field:key,label:fieldLabels[key],before:before[key]??null,after:after[key]??null
 }));
};
const eventTitle=name=>{
 if(eventNames[name])return eventNames[name];
 const match=/^record\.([a-z_]+)\.(insert|update|delete)$/.exec(name);
 if(!match)return name;
 return (entityLabels[match[1]]||match[1])+' — '+({insert:'criado(a)',update:'alterado(a)',delete:'eliminado(a)'})[match[2]];
};
const valueLabel=(value,field)=>value===null?'—':typeof value==='boolean'?(value?'Sim':'Não'):
 field.endsWith('_cents')&&Number.isFinite(Number(value))?MONEY(Number(value)):
 String(value);
const describeChanges=e=>e.changes.map(x=>x.label+': '+valueLabel(x.before,x.field)+' → '+
 valueLabel(x.after,x.field)).join(' · ');
export function normalizeAuditSnapshot(raw){
 if(!raw||!Array.isArray(raw.events)||!Number.isInteger(raw.page)||
  typeof raw.has_more!=='boolean')throw Error('audit_snapshot_invalid');
 return {
  page:raw.page,hasMore:raw.has_more,limit:Number(raw.limit)||50,
  events:raw.events.filter(e=>e&&e.id&&e.event).map(e=>({
   id:String(e.id),event:String(e.event),actor:String(e.actor_name||'Operador'),
   actorId:e.actor_id?String(e.actor_id):null,
   createdAt:e.created_at,targetId:e.target_id?String(e.target_id):null,
   changes:changesFor(e)
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
 return snapshot.events.filter(e=>eventTitle(e.event).toLocaleLowerCase().includes(q)||
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
  '<strong>'+esc(eventTitle(e.event))+'</strong>'+
  '<small>'+esc(fmtDate(e.createdAt))+' · '+esc(e.actor)+'</small>'+
  (e.actorId?'<small>ID do operador: '+esc(e.actorId.slice(0,8))+'</small>':'')+
  (e.targetId?'<span>Referência: '+esc(e.targetId.slice(0,8))+'</span>':'')+
  (e.changes.length?'<span class="audit-change-summary">'+esc(describeChanges(e))+'</span>':'')+
  '<small>Rasto electrónico: '+esc(e.id)+'</small>'+
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
 const headings=['Data','Actividade','Colaborador','ID do operador','Referência','Alterações','Rasto electrónico'];
 return '\uFEFF'+headings.map(cell).join(';')+'\r\n'+
 audit.events.map(e=>[fmtDate(e.createdAt),eventTitle(e.event),e.actor,e.actorId||'',e.targetId||'',describeChanges(e),e.id]
  .map(cell).join(';')).join('\r\n');
}

// Ubuntu Service administration: real-data charts and tenant-safe controls.
// All write permissions are re-verified by guarded server RPCs.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('pt-MZ',{style:'currency',currency:'MZN'}).format((Number(n)||0)/100);
const roleName={owner:'Proprietário',manager:'Gerente',cashier:'Caixa',stock:'Stock',finance:'Financeiro'};
const time=v=>{if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('pt-MZ',{timeZone:'Africa/Maputo'}):'—';};
const badge=(name,kind='neutral')=>'<span class="admin360-badge admin360-'+kind+'">'+escape(name)+'</span>';
const button=(op,id,label,kind='neutral',extra='')=>'<button type="button" data-admin-operation="'+escape(op)+'" data-admin-id="'+escape(id)+'" class="admin360-btn admin360-'+kind+'" '+extra+'>'+escape(label)+'</button>';
const input=(name,value='',attrs='')=>'<input name="'+name+'" value="'+escape(value)+'" '+attrs+'>';
const hidden=(name,value)=>'<input type="hidden" name="'+name+'" value="'+escape(value)+'">';
const roles=selected=>'<select name="role">'+Object.entries(roleName).map(([id,title])=>'<option value="'+id+'" '+(selected===id?'selected':'')+'>'+title+'</option>').join('')+'</select>';
const form=(action,fields,label,kind='save')=>'<form data-admin-control="'+escape(action)+'" class="admin360-edit-form">'+fields+
 '<button class="admin360-btn admin360-'+kind+'" type="submit">'+escape(label)+'</button></form>';
const section=(name,body)=>'<section class="pronto-admin-panel admin360-panel"><h3>'+escape(name)+'</h3>'+body+'</section>';

export function admin360Metrics(data,insights={},at=new Date()){
 const shops=data.businesses||[],payments=insights.payments||[],plans=data.plans||[];
 const active=shops.filter(b=>b.status==='active'&&!insights.businesses?.some(x=>x.id===b.id&&(x.archived_at||x.removed_at)));
 const license=shops.filter(b=>b.expiresAt&&!b.licenseCancelled&&new Date(b.expiresAt)>at);
 const collected=Number(insights.payments_total_cents)||0;
 const expiring=license.filter(b=>new Date(b.expiresAt).getTime()-at.getTime()<=7*864e5);
 const byPlan=plans.map(p=>({name:p.name,count:shops.filter(b=>b.planId===p.id).length}));
 const byMonth=Array.from({length:6},(_,i)=>{
  const d=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth()-(5-i),1));
  const count=shops.filter(s=>s.createdAt&&new Date(s.createdAt)<=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))).length;
  return {name:d.toLocaleDateString('pt-PT',{timeZone:'UTC',month:'short'}),count};
 });
 return {total:shops.length,active:active.length,suspended:shops.length-active.length,
  operators:shops.reduce((v,s)=>v+(s.operators||0),0),licenses:license.length,
  expiring:expiring.length,collected,payments:payments.length,byPlan,byMonth};
}
const barChart=(title,rows,caption='')=>{
 const max=Math.max(1,...rows.map(x=>x.count));
 return section(title,'<div class="admin360-chart" role="img" aria-label="'+escape(title)+'">'+
 rows.map(r=>'<div class="admin360-barline"><span>'+escape(r.name)+'</span>'+
 '<div class="admin360-track"><div class="admin360-fill" style="width:'+Math.round(100*r.count/max)+'%"></div></div>'+
 '<strong>'+r.count+'</strong></div>').join('')+'</div>'+
 (caption?'<p class="admin360-muted">'+escape(caption)+'</p>':''));
};
export function renderAdmin360Overview(data,insights={}){
 const m=admin360Metrics(data,insights);
 return '<div class="admin360-headline">Controlo central da Ubuntu Service <span>'+badge('Dados reais','good')+'</span></div>'+
 '<div class="admin360-kpis">'+[
  [m.total,'Comerciantes','store'],[m.active,'Lojas activas','check'],[m.suspended,'Suspensos/arquivados','alert'],
  [m.operators,'Colaboradores','users'],[m.licenses,'Licenças válidas','shield'],[m.expiring,'Licenças a vencer em 7 dias','alert']
 ].map(([n,label])=>'<article><span>'+escape(label)+'</span><strong>'+n+'</strong></article>').join('')+'</div>'+
 '<div class="admin360-chart-grid">'+barChart('Evolução dos comerciantes',m.byMonth,'Total acumulado dos comerciantes existentes, por mês.')+
 barChart('Distribuição por planos',m.byPlan.length?m.byPlan:[{name:'Sem planos',count:0}])+'</div>'+
 '<div class="admin360-quicknav"><h3>Acções rápidas</h3>'+
 ['businesses','members','licenses','plans','finance','audit'].map((x,i)=>'<button type="button" data-admin-navigate="'+x+'" class="admin360-btn">'+
 ['Gerir comerciantes','Gerir utilizadores','Licenças','Planos','Cobranças da Ubuntu','Histórico de auditoria'][i]+'</button>').join('')+'</div>';
}
export function renderAdmin360Businesses(data,insights={}){
 const markers=new Map((insights.businesses||[]).map(b=>[b.id,b]));
 const branches=insights.branches||[];
 return section('Controlo de comerciantes', '<p class="admin360-muted">Editar, suspender, reactivar, arquivar ou retirar da lista. O histórico de vendas e caixa nunca é apagado.</p>'+
 (data.businesses||[]).map(b=>{
  const mark=markers.get(b.id)||{};
  const removed=!!mark.removed_at,archived=!!mark.archived_at;
  const rows=branches.filter(x=>x.business_id===b.id);
  return '<details class="admin360-shop" data-business-entry data-search="'+escape([b.name,b.phone,b.address,b.id].join(' '))+'">'+
   '<summary><strong>'+escape(b.name)+'</strong><span>'+
    badge(removed?'Retirado':archived?'Arquivado':b.status==='active'?'Activo':'Suspenso',
     removed||archived||b.status!=='active'?'warn':'good')+' · '+b.operators+' colaborador(es)</span></summary>'+
   '<div class="admin360-shop-actions">'+
    (!removed&&!archived?
      (b.status==='active'?button('business_suspend',b.id,'Suspender','danger'):button('business_activate',b.id,'Reactivar','positive'))+
      button('business_archive',b.id,'Arquivar','warn')+button('business_remove',b.id,'Eliminar da lista','danger'):
     button('business_restore',b.id,'Restaurar','positive'))+
     '</div>'+
   form('business_edit',hidden('business_id',b.id)+
     '<label>Nome'+input('name',b.name,'required minlength="2" maxlength="120"')+'</label>'+
     '<label>Telefone'+input('phone',b.phone,'maxlength="60"')+'</label>'+
     '<label>Localização'+input('address',b.address,'maxlength="250"')+'</label>','Guardar alterações')+
   '<details class="admin360-subpanel"><summary>Filiais ('+rows.length+')</summary>'+
    (rows.length?rows.map(br=>form('branch_edit',hidden('business_id',b.id)+hidden('branch_id',br.id)+
      '<label>Filial'+input('name',br.name,'required maxlength="120"')+'</label>'+
      '<label><input name="active" type="checkbox" '+(br.active?'checked':'')+'> Filial activa</label>','Guardar filial')).join(''):
      '<p>Sem filiais disponíveis.</p>')+'</details>'+
   '<p class="admin360-muted">Acesso e licenças podem ser interrompidos separadamente nas respectivas áreas.</p></details>';
 }).join('')+'</div>');
}
export function renderAdmin360Members(data){
 const members=(data.businesses||[]).flatMap(b=>b.members.map(m=>({...m,businessId:b.id,businessName:b.name})));
 return section('Gestão de contas e perfis',members.length?members.map(m=>
  '<details class="admin360-shop"><summary><strong>'+escape(m.name||m.email)+'</strong> '+
   badge(m.active?'Activo':'Bloqueado',m.active?'good':'danger')+
   ' <small>'+escape(m.businessName)+' · '+escape(roleName[m.role]||m.role)+'</small></summary>'+
   '<div class="admin360-shop-actions">'+button(m.active?'member_deactivate':'member_reactivate',m.businessId+'|'+m.userId,
     m.active?'Bloquear acesso':'Reactivar acesso',m.active?'danger':'positive')+'</div>'+
   form('member_edit',hidden('business_id',m.businessId)+hidden('user_id',m.userId)+
     '<label>Nome'+input('display_name',m.name||m.email,'required minlength="2" maxlength="120"')+'</label>'+
     '<label>Perfil'+roles(m.role)+'</label>','Actualizar colaborador')+
   '<details class="admin360-subpanel"><summary>Recuperar acesso — gerar senha provisória</summary>'+
   '<p class="admin360-muted">Confirme a identidade e, para funcionários, a autorização do proprietário. A senha antiga nunca é apresentada.</p>'+
   '<form class="admin360-recovery-form" data-admin-password-reset>'+
    hidden('business_id',m.businessId)+hidden('user_id',m.userId)+
    '<label>Motivo do atendimento<textarea name="reason" minlength="10" maxlength="500" required placeholder="Ex.: Proprietário confirmou a identidade do funcionário por telefone"></textarea></label>'+
    '<label class="admin360-recovery-check"><input type="checkbox" name="identity_verified" required> Confirmei a identidade e a autorização para recuperar esta conta.</label>'+
    '<button type="submit" class="admin360-btn admin360-warn">Repor palavra-passe</button>'+
   '</form></details>'+
   '</details>').join(''):'<p>Nenhuma conta associada.</p>');
}
export function renderAdmin360Licenses(data){
 return section('Suspensões e renovações', (data.businesses||[]).map(b=>
  '<div class="admin360-listrow"><div><strong>'+escape(b.name)+'</strong><small>'+escape(b.planName||'Sem plano')+
  ' · vence '+time(b.expiresAt)+'</small></div>'+(!b.licenseCancelled&&b.planId?
  button('license_cancel',b.id,'Cancelar licença','danger'):
  badge(b.licenseCancelled?'Cancelada':'Sem licença','warn'))+'</div>').join(''));
}
export function renderAdmin360Plans(data){
 return section('Editar e activar/desactivar planos',
 (data.plans||[]).map(p=>'<details class="admin360-shop"><summary><strong>'+escape(p.name)+'</strong>'+
 badge(p.active?'Disponível':'Inactivo',p.active?'good':'warn')+'</summary>'+
 '<div class="admin360-shop-actions">'+button('plan_toggle',p.id,p.active?'Desactivar plano':'Activar plano',p.active?'danger':'positive')+'</div>'+
 form('plan_edit',hidden('plan_id',p.id)+
 '<label>Nome'+input('name',p.name,'required minlength="2" maxlength="100"')+'</label>'+
 '<label>Preço (MT)'+input('price_mzn',(p.priceCents/100).toFixed(2),'type="number" step="0.01" min="0" required')+'</label>'+
 '<label>Duração (dias)'+input('duration_days',p.durationDays,'type="number" step="1" min="1" max="3660" required')+'</label>','Guardar plano')+
 '<p class="admin360-muted">A alteração não modifica licenças e cobranças anteriores.</p></details>').join(''));
}
export function renderAdmin360Finance(data,insights){
 const payments=insights.payments||[];
 return '<div class="admin360-kpis"><article><span>Recebimentos confirmados manualmente</span><strong>'+
 money(insights.payments_total_cents||0)+'</strong></article><article><span>Registos recentes</span><strong>'+payments.length+
 '</strong></article></div>'+
 section('Registar pagamento recebido',
 '<p class="admin360-muted">Registe apenas valores efectivamente recebidos pela Ubuntu. Este formulário não confirma automaticamente M-Pesa nem e-Mola.</p>'+
 form('payment_record',
 '<label>Comerciante<select name="business_id" required><option value="">Seleccionar loja</option>'+
 (data.businesses||[]).map(b=>'<option value="'+escape(b.id)+'">'+escape(b.name)+'</option>').join('')+'</select></label>'+
 '<label>Plano (opcional)<select name="plan_id"><option value="">Não especificado</option>'+
 (data.plans||[]).map(p=>'<option value="'+escape(p.id)+'">'+escape(p.name)+'</option>').join('')+'</select></label>'+
 '<label>Valor recebido (MT)'+input('amount_mzn','','type="number" min="0.01" step="0.01" required')+'</label>'+
 '<label>Meio<select name="method"><option value="mpesa">M-Pesa</option><option value="emola">e-Mola</option>'+
 '<option value="bank">Banco</option><option value="cash">Dinheiro</option><option value="other">Outro</option></select></label>'+
 '<label>Referência comprovada'+input('external_reference','','required minlength="4" maxlength="160"')+'</label>'+
 '<label>Justificação'+input('reason','','required minlength="8" maxlength="500"')+'</label>',
 'Registar recebimento'))+
 section('Últimos recebimentos',payments.length?payments.map(p=>
 '<div class="admin360-listrow"><div><strong>'+escape((data.businesses||[]).find(b=>b.id===p.business_id)?.name||'Comerciante')+
 '</strong><small>'+time(p.paid_at)+' · '+escape(p.method)+' · Ref. '+escape(p.reference)+'</small></div>'+
 '<strong>'+money(p.amount_cents)+'</strong></div>').join(''):'<p>Ainda não existem cobranças confirmadas.</p>');
}
export function renderAdmin360Audit(data,insights){
 const events=insights.events||[];
 return section('Histórico de intervenções administrativas',
 '<button type="button" data-admin-export="audit" class="admin360-btn">Exportar CSV</button>'+
 '<p class="admin360-muted">Histórico das últimas 250 intervenções deste módulo. Nenhum registo pode ser apagado por aqui.</p>'+
 (events.length?events.map(ev=>
 '<div class="admin360-listrow"><div><strong>'+escape(ev.action)+'</strong><small>'+
 time(ev.created_at)+' · '+escape((data.businesses||[]).find(b=>b.id===ev.business_id)?.name||'Plataforma')+
 ' · '+escape(ev.reason)+'</small></div>'+badge('Registado','good')+'</div>').join(''):'<p>Ainda não existem intervenções registadas neste módulo.</p>'));
}
export function renderAdmin360Security(data,insights){
 return section('Centro de segurança e emergência',
 '<p>As acções críticas são acessíveis na ficha de cada comerciante e nos perfis. O bloqueio de acesso é aplicado no servidor.</p>'+
 '<div class="admin360-quicknav"><button data-admin-navigate="businesses" type="button" class="admin360-btn admin360-danger">Suspender estabelecimentos</button>'+
 '<button data-admin-navigate="members" type="button" class="admin360-btn admin360-danger">Bloquear utilizadores</button>'+
 '<button data-admin-navigate="licenses" type="button" class="admin360-btn">Interromper licenças</button>'+
 '<button data-admin-navigate="audit" type="button" class="admin360-btn">Consultar auditoria</button></div>'+
 '<p class="admin360-muted">Eliminar da lista é reversível e conserva vendas, clientes, caixa, auditoria e documentação financeira.</p>');
}
export function admin360AuditCSV(insights){
 const safe=x=>'"'+String(x??'').replace(/"/g,'""').replace(/^[=+\-@]/,"'$&")+'"';
 const rows=(insights.events||[]).map(x=>[x.created_at,x.action,x.business_id,x.actor_id,x.reason]
  .map(safe).join(';'));
 return '\ufeff'+[['Data','Acção','Comerciante','Responsável','Motivo'].map(safe).join(';'),...rows].join('\r\n');
}

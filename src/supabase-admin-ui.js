import {ADMIN_TABS,adminSummary,licenseState,matchAdminBusiness} from './supabase-admin-model.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const date=s=>{
 if(!s)return '—';
 const d=new Date(s);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('pt-PT',{timeZone:'Africa/Maputo',day:'2-digit',month:'2-digit',year:'numeric'}).format(d):'—';
};
const currency=cents=>new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100)+' MT';
const status=s=>({active:'Activo',suspended:'Suspenso',unassigned:'Sem licença',cancelled:'Cancelada',expired:'Expirada'})[s]||'—';
const badge=s=>'<span class="pronto-admin-chip pronto-admin-'+esc(s)+'">'+esc(status(s))+'</span>';
const empty=(title,help)=>'<div class="pronto-admin-empty"><strong>'+esc(title)+'</strong><p>'+esc(help)+'</p></div>';
const sub='Nesta fase, os dados apresentados são lidos do Supabase. O cadastro, a edição e a suspensão serão activados apenas após a conclusão da API administrativa segura.';
const tabs=[
 ['overview','Visão geral','layout-dashboard'],['businesses','Comerciantes','store'],
 ['licenses','Licenças','shield-check'],['plans','Planos','package'],['security','Segurança','lock-keyhole']
];

export function renderUbuntuAdminShell(account){
 return '<div class="pronto-admin-shell">'+
  '<aside class="pronto-admin-sidebar"><div class="pronto-admin-brand"><img src="/icon.svg" alt=""><span><strong>Pronto POS</strong><small>Ubuntu Service, Lda.</small></span></div>'+
  '<div class="pronto-admin-user"><span class="pronto-admin-avatar">U</span><div><strong>Super Administrador</strong><small>'+esc(account.email)+'</small></div></div>'+
  '<nav class="pronto-admin-nav" aria-label="Administração Ubuntu">'+tabs.map(([key,label])=>
   '<button type="button" data-admin-tab="'+key+'" aria-current="'+(key==='overview'?'page':'false')+'">'+esc(label)+'</button>').join('')+'</nav>'+
  '<div class="pronto-admin-sidebar-bottom"><span class="pronto-admin-secure">Acesso validado por Supabase Auth</span>'+
  '<button type="button" class="secondary" id="pronto-admin-logout">Terminar sessão</button></div></aside>'+
  '<div class="pronto-admin-workspace"><header class="pronto-admin-topbar"><div><span>UBUNTU SERVICE</span><h1>Administração Pronto POS</h1></div>'+
  '<div class="pronto-admin-top-actions"><label class="pronto-admin-search" id="pronto-admin-search-wrap" hidden><span class="pronto-admin-sr-only">Pesquisar comerciantes</span><input id="pronto-admin-search" autocomplete="off" placeholder="Pesquisar comerciante ou contacto"></label><span class="pronto-admin-live">Consulta protegida</span>'+
  '<button type="button" class="secondary" id="pronto-admin-refresh">Actualizar dados</button></div></header>'+
  '<main class="pronto-admin-main"><div id="pronto-admin-message" role="status" aria-live="polite"></div>'+
  '<div id="pronto-admin-content"></div></main></div></div>';
}

const title=(name,description)=>'<div class="pronto-admin-page-title"><h2>'+esc(name)+'</h2><p>'+esc(description)+'</p></div>';
const stats=(value,label,info='')=>'<article class="pronto-admin-stat"><small>'+esc(label)+'</small><strong>'+value+'</strong>'+(info?'<span>'+esc(info)+'</span>':'')+'</article>';
export function renderUbuntuAdminTab(key,data,{query='',now=new Date()}={}){
 if(!ADMIN_TABS.includes(key))throw Error('admin_tab');
 const summary=adminSummary(data,now);
 if(key==='overview'){
  return title('Visão geral','Empresas e licenças registadas na base Supabase do Pronto POS.')+
   '<section class="pronto-admin-stats" aria-label="Estatísticas administrativas">'+
   stats(summary.total,'Comerciantes registados')+stats(summary.activeBusinesses,'Empresas activas')+
   stats(summary.activeLicenses,'Licenças activas')+stats(summary.expiredLicenses+summary.cancelledLicenses,'Licenças vencidas ou canceladas')+
   stats(summary.branches,'Filiais')+stats(summary.operators,'Colaboradores activos')+'</section>'+
   '<section class="pronto-admin-grid"><article class="pronto-admin-panel"><h3>Estado das licenças</h3>'+
   '<div class="pronto-admin-status-grid"><p>Sem licença <strong>'+summary.unassignedLicenses+'</strong></p>'+
   '<p>Expiradas <strong>'+summary.expiredLicenses+'</strong></p><p>Canceladas <strong>'+summary.cancelledLicenses+'</strong></p></div></article>'+
   '<article class="pronto-admin-panel"><h3>Próximas etapas</h3>'+
   '<p>Cadastro real de comerciantes, activação de licenças e configuração de colaboradores dependem de operações seguras no servidor.</p>'+
   '<p class="pronto-admin-note">Não estão disponíveis operações de alteração ou acesso às vendas dos comerciantes neste painel.</p></article></section>';
 }
 if(key==='businesses'){
  const rows=data.businesses.filter(b=>matchAdminBusiness(b,query));
  return title('Comerciantes','Empresas registadas no Supabase, sem exposição de vendas ou contas de caixa.')+
   '<section class="pronto-admin-panel"><h3>Lista de comerciantes <span class="pronto-admin-count">'+rows.length+'</span></h3>'+
   (rows.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Empresa</th><th>Estado</th><th>Filiais</th><th>Colaboradores</th><th>Criada em</th></tr></thead><tbody>'+
   rows.map(b=>'<tr><td><strong>'+esc(b.name)+'</strong><small>'+esc(b.phone||b.address||'Sem contacto registado')+'</small></td><td>'+badge(b.status)+'</td><td>'+b.branches+'</td><td>'+b.operators+'</td><td>'+date(b.createdAt)+'</td></tr>').join('')+'</tbody></table></div>':
   empty('Nenhum comerciante encontrado',query?'Experimente outro nome, contacto ou código.':'O cadastro de comerciantes será activado na fase seguinte.'))+
   '<p class="pronto-admin-note">'+esc(sub)+'</p></section>';
 }
 if(key==='licenses'){
  return title('Licenças e subscrições','Situação de licenças atribuídas aos comerciantes, em modo de consulta.')+
   '<section class="pronto-admin-panel"><h3>Licenças por empresa</h3>'+
   (data.businesses.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Licença</th><th>Validade</th></tr></thead><tbody>'+
    data.businesses.map(b=>'<tr><td><strong>'+esc(b.name)+'</strong></td><td>'+esc(b.planName||'Não atribuído')+'</td><td>'+badge(licenseState(b,now))+'</td><td>'+date(b.expiresAt)+'</td></tr>').join('')+'</tbody></table></div>':
    empty('Ainda não existem licenças','Cadastre uma empresa e atribua-lhe um plano na fase de provisionamento.'))+
   '<p class="pronto-admin-note">'+esc(sub)+'</p></section>';
 }
 if(key==='plans'){
  return title('Planos comerciais','Condições dos planos definidos na base de dados, apenas para consulta.')+
   '<section class="pronto-admin-panel"><h3>Planos disponíveis <span class="pronto-admin-count">'+data.plans.length+'</span></h3>'+
   (data.plans.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Plano</th><th>Preço</th><th>Duração</th><th>Estado</th></tr></thead><tbody>'+
    data.plans.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong></td><td>'+currency(p.priceCents)+'</td><td>'+p.durationDays+' dias</td><td>'+badge(p.active?'active':'suspended')+'</td></tr>').join('')+'</tbody></table></div>':
    empty('Nenhum plano configurado','A definição e alteração de planos ficará disponível após a API administrativa estar pronta.'))+
   '<p class="pronto-admin-note">'+esc(sub)+'</p></section>';
 }
 return title('Segurança e preparação','Estado técnico da migração para operação comercial.')+
  '<section class="pronto-admin-panel"><h3>Protecção de acesso</h3>'+
  '<div class="pronto-admin-check"><strong>Identidade do Super Administrador</strong><span>Verificada por autenticação e função protegida no Supabase</span></div>'+
  '<div class="pronto-admin-check"><strong>Leitura administrativa</strong><span>Empresas e contratos; sem acesso directo a vendas e caixas</span></div>'+
  '<div class="pronto-admin-check"><strong>Escritas financeiras</strong><span>Bloqueadas nesta fase; devem ser transaccionais no servidor</span></div>'+
  '<div class="pronto-admin-check"><strong>Sessão</strong><span>Credenciais temporárias só na memória desta página; actualizar a página exige novo login</span></div>'+
  '<div class="pronto-admin-check"><strong>Próxima fase</strong><span>Cadastro seguro de comerciantes, planos, licenças e utilizadores, com auditoria</span></div></section>';
}
export function ubuntuAdminTabTitle(key){return tabs.find(([id])=>id===key)?.[1]||'Administração';}

import {renderAdmin360Overview,renderAdmin360Businesses,renderAdmin360Members,renderAdmin360Licenses,renderAdmin360Plans,renderAdmin360Finance,renderAdmin360Audit,renderAdmin360Security} from './supabase-admin-360.js';
import {ADMIN_TABS,adminSummary,licenseState,matchAdminBusiness} from './supabase-admin-model.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const date=s=>{
 if(!s)return '—';
 const d=new Date(s);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('pt-PT',{timeZone:'Africa/Maputo',day:'2-digit',month:'2-digit',year:'numeric'}).format(d):'—';
};
const currency=cents=>{const whole=String(Math.floor(cents/100)).replace(/\B(?=(\d{3})+(?!\d))/g,'.');return whole+','+String(cents%100).padStart(2,'0')+' MT';};
const status=s=>({active:'Activo',suspended:'Suspenso',unassigned:'Sem licença',cancelled:'Cancelada',expired:'Expirada'})[s]||'—';
const badge=s=>'<span class="pronto-admin-chip pronto-admin-'+esc(s)+'">'+esc(status(s))+'</span>';
const empty=(title,help)=>'<div class="pronto-admin-empty"><strong>'+esc(title)+'</strong><p>'+esc(help)+'</p></div>';
const sub='Registos, associações e licenças são protegidos por permissões e histórico de alterações.';
const tabs=[
 ['overview','Visão geral','layout-dashboard'],['businesses','Comerciantes','store'],['members','Utilizadores','users'],
 ['licenses','Licenças','shield-check'],['plans','Planos','package'],['finance','Financeiro','wallet'],['audit','Auditoria','clipboard-list'],['security','Segurança','lock-keyhole']
];

export function renderUbuntuAdminShell(account){
 return '<div class="pronto-admin-shell">'+
  '<aside class="pronto-admin-sidebar"><div class="pronto-admin-brand"><img src="/icon.svg" alt=""><span><strong>Pronto POS</strong><small>Ubuntu Service, Lda.</small></span></div>'+
  '<div class="pronto-admin-user"><span class="pronto-admin-avatar">U</span><div><strong>Super Administrador</strong><small>'+esc(account.email)+'</small></div></div>'+
  '<nav class="pronto-admin-nav" aria-label="Administração Ubuntu">'+tabs.map(([key,label])=>
   '<button type="button" data-admin-tab="'+key+'" aria-current="'+(key==='overview'?'page':'false')+'">'+esc(label)+'</button>').join('')+'</nav>'+
  '<div class="pronto-admin-sidebar-bottom"><span class="pronto-admin-secure">Acesso protegido</span>'+
  '<button type="button" class="secondary" id="pronto-admin-logout">Terminar sessão</button></div></aside>'+
  '<div class="pronto-admin-workspace"><header class="pronto-admin-topbar"><div><span>UBUNTU SERVICE</span><h1>Administração Pronto POS</h1></div>'+
  '<div class="pronto-admin-top-actions"><label class="pronto-admin-search" id="pronto-admin-search-wrap" hidden><span class="pronto-admin-sr-only">Pesquisar comerciantes</span><input id="pronto-admin-search" autocomplete="off" placeholder="Pesquisar comerciante ou contacto"></label><span class="pronto-admin-live">Sistema ligado</span>'+
  '<button type="button" class="secondary" id="pronto-admin-refresh">Actualizar dados</button></div></header>'+
  '<main class="pronto-admin-main"><div id="pronto-admin-message" role="status" aria-live="polite"></div>'+
  '<div id="pronto-admin-content"></div></main></div></div>';
}

const title=(name,description)=>'<div class="pronto-admin-page-title"><h2>'+esc(name)+'</h2><p>'+esc(description)+'</p></div>';
const stats=(value,label,info='')=>'<article class="pronto-admin-stat"><small>'+esc(label)+'</small><strong>'+value+'</strong>'+(info?'<span>'+esc(info)+'</span>':'')+'</article>';
export function renderUbuntuAdminTab(key,data,{query='',now=new Date(),insights={}}={}){
 if(!ADMIN_TABS.includes(key))throw Error('admin_tab');
 if(key==='overview')return title('Painel de controlo','Gestão integral da plataforma e dos seus comerciantes.')+renderAdmin360Overview(data,insights);
 if(key==='businesses')return title('Comerciantes','Administrar lojas, filiais e respectivos estados.')+
  renderAdmin360Businesses({...data,businesses:data.businesses.filter(b=>matchAdminBusiness(b,query))},insights);
 if(key==='members')return title('Utilizadores e acessos','Criar, editar, bloquear e reactivar perfis.')+renderAdmin360Members(data);
 if(key==='licenses')return title('Licenças e subscrições','Atribuir, renovar ou cancelar licenças.')+renderAdmin360Licenses(data);
 if(key==='plans')return title('Planos comerciais','Definir e gerir as condições comerciais.')+renderAdmin360Plans(data);
 if(key==='finance')return title('Cobranças da Ubuntu','Apenas pagamentos efectivamente recebidos e registados.')+renderAdmin360Finance(data,insights);
 if(key==='audit')return title('Auditoria','Operações e intervenções administrativas registadas.')+renderAdmin360Audit(data,insights);
 if(key==='security')return title('Controlo e segurança','Bloqueios e suspensão dos serviços.')+renderAdmin360Security(data,insights);

 const summary=adminSummary(data,now);
 if(key==='overview'){
  return title('Visão geral','Empresas e licenças registadas no Pronto POS.')+
   '<section class="pronto-admin-stats" aria-label="Estatísticas administrativas">'+
   stats(summary.total,'Comerciantes registados')+stats(summary.activeBusinesses,'Empresas activas')+
   stats(summary.activeLicenses,'Licenças activas')+stats(summary.expiredLicenses+summary.cancelledLicenses,'Licenças vencidas ou canceladas')+
   stats(summary.branches,'Filiais')+stats(summary.operators,'Colaboradores activos')+'</section>'+
   '<section class="pronto-admin-grid"><article class="pronto-admin-panel"><h3>Estado das licenças</h3>'+
   '<div class="pronto-admin-status-grid"><p>Sem licença <strong>'+summary.unassignedLicenses+'</strong></p>'+
   '<p>Expiradas <strong>'+summary.expiredLicenses+'</strong></p><p>Canceladas <strong>'+summary.cancelledLicenses+'</strong></p></div></article>'+
   '<article class="pronto-admin-panel"><h3>Começar a utilizar</h3>'+
   '<p>1. Em Comerciantes, registe a mercearia. 2. Em Planos, crie um plano de teste. 3. Em Utilizadores, crie o proprietário com o email dele, copie a senha gerada e envie-a por mensagem privada. 4. Em Licenças, atribua o plano à mercearia. 5. O proprietário entra, define o PIN e começa a cadastrar produtos.</p>'+
   '<p class="pronto-admin-note">Não estão disponíveis operações de alteração ou acesso às vendas dos comerciantes neste painel.</p></article></section>';
 }
 if(key==='businesses'){
  const rows=data.businesses.filter(b=>matchAdminBusiness(b,query));
  return title('Comerciantes','Empresas registadas, sem exposição das vendas ou contas de caixa.')+
   '<section class="pronto-admin-panel"><h3>Lista de comerciantes <span class="pronto-admin-count">'+rows.length+'</span></h3>'+
   (rows.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Empresa</th><th>Estado</th><th>Filiais</th><th>Colaboradores</th><th>Criada em</th></tr></thead><tbody>'+
   rows.map(b=>'<tr><td><strong>'+esc(b.name)+'</strong><small>'+esc(b.phone||b.address||'Sem contacto registado')+'</small></td><td>'+badge(b.status)+'</td><td>'+b.branches+'</td><td>'+b.operators+'</td><td>'+date(b.createdAt)+'</td></tr>').join('')+'</tbody></table></div>':
   empty('Nenhum comerciante encontrado',query?'Experimente outro nome, contacto ou código.':'Utilize o formulário «Registar comerciante» abaixo para criar a primeira loja.'))+
   '<p class="pronto-admin-note">'+esc(sub)+'</p></section>';
 }
 if(key==='members')return title('Utilizadores e perfis','Criar acessos com palavra-passe inicial para entregar directamente ao utilizador.');
 if(key==='licenses'){
  return title('Licenças e subscrições','Consulte as licenças e atribua ou renove planos através do formulário protegido.')+
   '<section class="pronto-admin-panel"><h3>Licenças por empresa</h3>'+
   (data.businesses.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Licença</th><th>Validade</th></tr></thead><tbody>'+
    data.businesses.map(b=>'<tr><td><strong>'+esc(b.name)+'</strong></td><td>'+esc(b.planName||'Não atribuído')+'</td><td>'+badge(licenseState(b,now))+'</td><td>'+date(b.expiresAt)+'</td></tr>').join('')+'</tbody></table></div>':
    empty('Ainda não existem licenças','Cadastre uma empresa e atribua-lhe um plano na fase de provisionamento.'))+
   '<p class="pronto-admin-note">'+esc(sub)+'</p></section>';
 }
 if(key==='plans'){
  return title('Planos comerciais','Consulte planos existentes ou crie um novo plano no formulário abaixo.')+
   '<section class="pronto-admin-panel"><h3>Planos disponíveis <span class="pronto-admin-count">'+data.plans.length+'</span></h3>'+
   (data.plans.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Plano</th><th>Preço</th><th>Duração</th><th>Estado</th></tr></thead><tbody>'+
    data.plans.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong></td><td>'+currency(p.priceCents)+'</td><td>'+p.durationDays+' dias</td><td>'+badge(p.active?'active':'suspended')+'</td></tr>').join('')+'</tbody></table></div>':
    empty('Nenhum plano configurado','Utilize o formulário abaixo para criar um plano comercial.'))+
   '<p class="pronto-admin-note">'+esc(sub)+'</p></section>';
 }
 return title('Segurança e preparação','Estado técnico da migração para operação comercial.')+
  '<section class="pronto-admin-panel"><h3>Protecção de acesso</h3>'+
  '<div class="pronto-admin-check"><strong>Identidade do Super Administrador</strong><span>Confirmada por autenticação e permissões do sistema</span></div>'+
  '<div class="pronto-admin-check"><strong>Leitura administrativa</strong><span>Empresas e contratos; sem acesso directo a vendas e caixas</span></div>'+
  '<div class="pronto-admin-check"><strong>Operações financeiras</strong><span>Bloqueadas nesta fase; devem ser transaccionais no servidor</span></div>'+
  '<div class="pronto-admin-check"><strong>Sessão</strong><span>As credenciais de sessão ficam apenas na memória desta página; actualizar a página exige novo login</span></div>'+
  '<div class="pronto-admin-check"><strong>Próxima fase</strong><span>Validar o fluxo completo com a primeira mercearia e respectivo proprietário</span></div></section>';
}
export function ubuntuAdminTabTitle(key){return tabs.find(([id])=>id===key)?.[1]||'Administração';}

import {prontoSupabaseConfig} from './pronto-supabase-config.js';
import {createProntoIdentity} from './supabase-identity.js';
import {mountUbuntuAdminDashboard} from './supabase-admin-dashboard.js';
import {mountSupabaseMerchantPilot} from './supabase-shop-dashboard.js';
import {mountProntoPinGate} from './supabase-pin-lock.js';
import {extractRecoveryFromHash,mountPasswordRecovery} from './supabase-recovery-ui.js';

// A read-only identity test; the operational POS remains on the existing server.
export function startSupabaseIdentityCheck(root=document.querySelector('#app')) {
 if(!root)throw Error('auth_root');
 const client=createProntoIdentity(prontoSupabaseConfig);
 const recovery=extractRecoveryFromHash(location,history);
 const beginRecovery=(token,kind='recovery')=>mountPasswordRecovery({root,client,token,kind,onBack:form});
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[char]);
 const shell=content=>{
  root.innerHTML='<section class="login-shell pronto-auth-test"><div class="login-brand"><img src="/icon.svg" alt=""><h1>Pronto POS</h1><p>Verificação de acesso Supabase</p></div><div class="panel login-panel">'+content+'</div><footer>Ubuntu Service, Lda. · Ambiente de validação</footer></section>';
 };
 const form=()=>{
  shell('<h2>Verificar identidade e permissões</h2>'+
  '<p>Entre com a sua conta Supabase. Depois, utilize o seu PIN pessoal de 5 dígitos para desbloquear o Pronto POS.</p>'+
  '<form id="pronto-auth-check-form">'+
   '<label>Email da conta Supabase<input type="email" name="email" autocomplete="username" maxlength="254" required></label>'+
   '<label>Palavra-passe<input type="password" name="password" autocomplete="current-password" maxlength="200" required></label>'+
   '<p id="pronto-auth-check-error" role="alert" aria-live="polite"></p>'+
   '<button class="primary full" type="submit">Entrar e verificar acesso</button>'+
  '</form>'+
  '<p class="form-hint">As credenciais não são guardadas neste navegador. Apenas contas previamente criadas pela Ubuntu Service podem ser verificadas.</p>'+
  '<button type="button" class="secondary full" id="recovery-request">Esqueceu-se da palavra-passe?</button>'+
  '<a class="demo-link" href="/?demo=1">Voltar à demonstração</a>');
  root.querySelector('#recovery-request').onclick=()=>beginRecovery(null);
  const node=root.querySelector('#pronto-auth-check-form');
  node.addEventListener('submit',async event=>{
   event.preventDefault();
   const button=node.querySelector('button'),error=node.querySelector('#pronto-auth-check-error');
   button.disabled=true;error.textContent='';
   const data=new FormData(node);
   try{
    const account=await client.signIn(String(data.get('email')||''),String(data.get('password')||''));
    node.reset();await ready(account);
   }catch(e){
    const messages={
     supabase_rate_limit:'Demasiadas tentativas. Aguarde e volte a tentar.',
     supabase_unauthorized:'Não foi possível autenticar. Confira a conta e as permissões.',
     supabase_invalid_credentials:'Introduza o email e a palavra-passe.',
     supabase_unavailable:'Não foi possível contactar o serviço Supabase.'
    };
    error.textContent=messages[e.message]||'Não foi possível verificar a conta. Confira as credenciais e a ligação.';
    button.disabled=false;
   }
  });
 };
 const ready=async account=>{
  const admin=account.ubuntuAdmin===true;
  const staffAccess=!admin&&!account.grants.length?await client.myAccessStatus():null;
  if(admin||account.grants.length){
   // A five-digit PIN protects an *already authenticated* Supabase session.
   // Every operator chooses their own PIN; it is never supplied by the merchant.
   let gate;
   const leave=()=>{gate?.cleanup();form();};
   gate=await mountProntoPinGate({
    root,client,account,onLogout:form,
    open:()=>admin?
     mountUbuntuAdminDashboard({root,client,account,onLogout:leave}):
     mountSupabaseMerchantPilot({root,client,account,onLogout:leave})
   });
   return;
  }
  const grants=account.grants.length?
   '<div class="pronto-auth-grants">'+account.grants.map(grant=>
     '<article><strong>'+escape(grant.name)+'</strong><small>Perfil: '+escape(grant.role)+'</small></article>'
    ).join('')+'</div>':
    '<p class="held-sale-warning">'+(admin?'O Super Administrador não precisa de uma associação comercial para exercer funções administrativas.':''+(staffAccess?.reason==='outside_schedule'?'Fora do horário de trabalho. Aguarde a abertura programada.':staffAccess?.reason==='blocked'?'O seu acesso foi bloqueado pelo proprietário. Contacte o responsável.':'Esta conta não tem acesso disponível neste momento. Contacte o responsável.')+'')+'</p>';
  shell('<h2>'+ (admin?'Super Administrador — Ubuntu Service':'Identidade verificada') +'</h2>'+
   '<p>Conta: <strong>'+escape(account.email)+'</strong></p>'+
   (admin?'<p class="pronto-super-admin-status"><strong>Perfil confirmado:</strong> Super Administrador Ubuntu Service, Lda.</p><p class="form-hint">A verificação está activa. Os módulos de administração de comerciantes, licenças e subscrições serão ligados à nova base apenas depois da validação das operações seguras.</p>':'')+
   '<h3>Empresas autorizadas</h3>'+grants+
   '<p class="form-hint">Este teste consulta permissões reais através das políticas RLS. As operações comerciais continuam no backend existente.</p>'+
   '<button id="pronto-auth-check-logout" type="button" class="secondary full">Terminar sessão de teste</button>');
  root.querySelector('#pronto-auth-check-logout').onclick=async()=>{
   const button=root.querySelector('#pronto-auth-check-logout');button.disabled=true;
   await client.signOut();form();
  };
 };
 if(recovery.token)beginRecovery(recovery.token,recovery.kind);
 else form();
}

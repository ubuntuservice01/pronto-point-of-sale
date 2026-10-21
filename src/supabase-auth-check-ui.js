import {prontoSupabaseConfig} from './pronto-supabase-config.js';
import {startProntoLoading} from './ui/pronto-loading.js';
import {createProntoIdentity} from './supabase-identity.js';
import {mountUbuntuAdminDashboard} from './supabase-admin-dashboard.js';
import {mountSupabaseMerchantPilot} from './supabase-shop-dashboard.js';
import {mountProntoPinGate} from './supabase-pin-lock.js';
import {extractRecoveryFromHash,mountPasswordRecovery} from './supabase-recovery-ui.js';

// Authenticated public entrypoint. All merchant writes use checked Supabase RPCs.
export function startSupabaseIdentityCheck(root=document.querySelector('#app')) {
 if(!root)throw Error('auth_root');
 const client=createProntoIdentity(prontoSupabaseConfig);
 const recovery=extractRecoveryFromHash(location,history);
 const beginRecovery=(token,kind='recovery')=>mountPasswordRecovery({root,client,token,kind,onBack:form});
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[char]);
 const shell=content=>{
  root.innerHTML='<section class="login-shell pronto-auth-test">'+
   '<div class="pronto-login-layout">'+
    '<div class="pronto-login-left">'+
     '<div class="login-brand">'+
      '<div class="pronto-brand-row"><img src="/icon.svg" alt="" width="54" height="54">'+
       '<div><h1>Pronto <span>POS</span></h1><p>Menos complicações, mais negócio.</p></div></div>'+
     '</div>'+
     '<div class="panel login-panel">'+content+'</div>'+
     '<footer>Um sistema da Ubuntu Service, Lda.</footer>'+
    '</div>'+
    '<aside class="pronto-login-right" aria-label="Antes e depois de usar o Pronto POS">'+
     '<img src="/login-antes-depois.webp" alt="Antes: comerciante com caderno molhado pela chuva. Depois: comerciante feliz a confirmar uma venda no Pronto POS." loading="eager" decoding="async">'+
    '</aside>'+
   '</div>'+
  '</section>';
 };
 let staffWaitTimer=null;
 const form=()=>{
  if(staffWaitTimer){clearInterval(staffWaitTimer);staffWaitTimer=null;}
  shell('<div class="pronto-login-heading"><span class="pronto-login-eyebrow">Acesso à sua loja</span>'+
   '<h2>Bem-vindo</h2>'+
   '<p>Entre para gerir a sua loja com facilidade.</p></div>'+
  '<form id="pronto-auth-check-form">'+
   '<label for="pronto-login-email">Email de acesso</label>'+
   '<div class="pronto-field"><span class="pronto-field-icon" aria-hidden="true">✉</span>'+
    '<input id="pronto-login-email" type="email" name="email" placeholder="email@exemplo.co.mz" autocomplete="username" maxlength="254" required></div>'+
   '<label for="pronto-login-password">Palavra-passe</label>'+
   '<div class="pronto-field"><span class="pronto-field-icon" aria-hidden="true">♧</span>'+
    '<input id="pronto-login-password" type="password" name="password" placeholder="Introduza a sua palavra-passe" autocomplete="current-password" maxlength="200" required>'+
    '<button type="button" id="pronto-toggle-password" class="pronto-password-toggle" aria-label="Mostrar palavra-passe" aria-pressed="false">Mostrar</button></div>'+
   '<div class="pronto-login-helpers"><button type="button" class="pronto-recovery-link" id="recovery-request">Esqueceu-se da palavra-passe?</button></div>'+
   '<p id="pronto-auth-check-error" role="alert" aria-live="polite"></p>'+
   '<button class="primary full pronto-login-submit" type="submit">Entrar <span aria-hidden="true">→</span></button>'+
  '</form>'+
  '<div class="pronto-login-security"><span aria-hidden="true">✓</span> Acesso seguro para proprietários e colaboradores.</div>');
  root.querySelector('#recovery-request').onclick=()=>beginRecovery(null);
  root.querySelector('#pronto-toggle-password').onclick=()=>{
   const field=root.querySelector('#pronto-login-password');
   const button=root.querySelector('#pronto-toggle-password');
   const show=field.type==='password';
   field.type=show?'text':'password';
   button.textContent=show?'Ocultar':'Mostrar';
   button.setAttribute('aria-label',show?'Ocultar palavra-passe':'Mostrar palavra-passe');
   button.setAttribute('aria-pressed',String(show));
   field.focus();
  };
  const node=root.querySelector('#pronto-auth-check-form');
  node.addEventListener('submit',async event=>{
   event.preventDefault();
   const button=node.querySelector('button'),error=node.querySelector('#pronto-auth-check-error');
   button.disabled=true;error.textContent='';
   const data=new FormData(node);
   const loading=startProntoLoading();
   try{
    const account=await client.signIn(String(data.get('email')||''),String(data.get('password')||''));
    node.reset();await ready(account,false);
    await loading.finish();
   }catch(e){
    loading.cancel();
    const messages={
     supabase_rate_limit:'Demasiadas tentativas. Aguarde e volte a tentar.',
     supabase_unauthorized:'Não foi possível autenticar. Confira a conta e as permissões.',
     supabase_invalid_credentials:'Introduza o email e a palavra-passe.',
     supabase_unavailable:'Não foi possível ligar ao sistema. Verifique a internet.'
    };
    error.textContent=messages[e.message]||'Não foi possível verificar a conta. Confira as credenciais e a ligação.';
    button.disabled=false;
   }
  });
 };
 const ready=async(account,restored=false)=>{
  const admin=account.ubuntuAdmin===true;
  const staffAccess=!admin&&!account.grants.length?await client.myAccessStatus():null;
  if(admin||account.grants.length){
   // A five-digit PIN protects an *already authenticated* Supabase session.
   // Every operator chooses their own PIN; it is never supplied by the merchant.
   let gate;
   const leave=()=>{gate?.cleanup();form();};
   gate=await mountProntoPinGate({
    root,client,account,onLogout:form,allowReloadResume:restored,
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
   (admin?'<p class="pronto-super-admin-status"><strong>Perfil confirmado:</strong> Super Administrador Ubuntu Service, Lda.</p><p class="form-hint">A sua conta tem acesso à gestão das lojas e respectivos utilizadores.</p>':'')+
   '<h3>Empresas autorizadas</h3>'+grants+
   '<p class="form-hint">O acesso à sua conta é protegido.</p>'+
   '<button id="pronto-auth-check-logout" type="button" class="secondary full">Terminar sessão</button>');
  if(staffAccess&&['outside_schedule','blocked','suspended'].includes(staffAccess.reason)){
   if(staffWaitTimer)clearInterval(staffWaitTimer);
   staffWaitTimer=setInterval(async()=>{
    try{
     const latest=await client.myAccessStatus();
     if(latest.allowed){
      clearInterval(staffWaitTimer);staffWaitTimer=null;
      await ready(await client.account());
     }
    }catch{/* Stay on blocked screen if network is unavailable. */}
   },5000);
  }
  root.querySelector('#pronto-auth-check-logout').onclick=async()=>{
   const button=root.querySelector('#pronto-auth-check-logout');button.disabled=true;
   await client.signOut();form();
  };
 };
 const bootstrap=async()=>{
  const loading=startProntoLoading();
  if(recovery.token){loading.cancel();beginRecovery(recovery.token,recovery.kind);return;}
  try{
   const account=await client.restoreSession();
   if(account)await ready(account,true);
   else form();
   await loading.finish(); // Display 100% only after login/PIN or screen is ready.
  }catch(error){
   loading.cancel(); // Never claim 100% on network or login errors.
   if(['supabase_unavailable','supabase_rate_limit'].includes(error.message)){
    // Keep the saved session; allow the user to retry without re-entering a password.
    root.innerHTML='<section class="login-shell pronto-auth-test">'+
     '<div class="panel login-panel"><h2>Ligação indisponível</h2>'+
     '<p>A sua sessão está guardada. Verifique a Internet e tente novamente.</p>'+
     '<button type="button" class="primary full" id="pronto-session-retry">Tentar novamente</button>'+
     '</div></section>';
    root.querySelector('#pronto-session-retry').onclick=()=>void bootstrap();
   }else form();
  }
 };
 void bootstrap();
}

import {prontoSupabaseConfig} from './pronto-supabase-config.js';
import {startProntoLoading} from './ui/pronto-loading.js';
import {createProntoIdentity,normalizeMozambiquePhone} from './supabase-identity.js';
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
 const registration=(alreadySignedIn=false)=>{
  // Only an explicit true means this account is already authenticated.
  const resuming=alreadySignedIn===true;
  shell('<div class="pronto-login-heading"><span class="pronto-login-eyebrow">10 dias grátis</span><h2>Registar o meu negócio</h2><p>Crie a sua loja gratuitamente. Sem cartão bancário.</p></div>'+
   '<form id="pronto-self-register" class="pronto-register-form">'+
   '<label>O seu nome<input name="owner_name" required minlength="2" maxlength="120" autocomplete="name"></label>'+
   '<label>Nome do negócio<input name="business_name" required minlength="2" maxlength="120" placeholder="Mercearia da Ana"></label>'+
   '<label>Tipo de negócio<select name="industry" required><option value="Mercearia">Mercearia</option><option value="Farmácia">Farmácia</option><option value="Loja">Loja</option><option value="Restaurante">Restaurante</option><option value="Outro comércio">Outro comércio</option></select></label>'+
   '<label>Telemóvel (também serve para iniciar sessão)<input name="phone" required minlength="9" maxlength="30" inputmode="tel" autocomplete="tel" placeholder="84 123 4567"></label>'+
   '<label>WhatsApp<input name="whatsapp" required minlength="7" maxlength="30" inputmode="tel"></label>'+
   '<label>Localização<input name="address" maxlength="160" placeholder="Distrito, província"></label>'+
   '<label>Email<input name="email" required type="email" maxlength="254" autocomplete="email"></label>'+
   '<label>Palavra-passe<input name="password" required type="password" minlength="12" maxlength="128" autocomplete="new-password"></label>'+
   '<label>Confirmar palavra-passe<input name="confirm" required type="password" minlength="12" maxlength="128" autocomplete="new-password"></label>'+
   '<label class="pronto-register-consent"><input name="accept_terms" type="checkbox" required> Aceito os termos de utilização e a política de privacidade.</label>'+
   '<label class="pronto-register-consent"><input name="marketing_consent" type="checkbox"> Autorizo receber novidades e ofertas no WhatsApp.</label>'+
   '<p id="pronto-register-error" role="alert" aria-live="polite"></p>'+
   '<button class="primary full" type="submit">Criar negócio e iniciar teste</button></form>'+
   '<button class="secondary full" type="button" id="pronto-register-back">Já tenho conta · Entrar</button>');
  root.querySelector('#pronto-register-back').onclick=form;
  if(resuming){
   for(const field of ['email','password','confirm']){const input=root.querySelector('[name="'+field+'"]');if(input){input.required=false;input.closest('label').hidden=true;}}
   root.querySelector('.pronto-login-heading p').textContent='Complete os dados para activar o seu teste de 10 dias.';
  }
  const node=root.querySelector('#pronto-self-register');
  node.addEventListener('submit',async event=>{
   event.preventDefault();const f=new FormData(node),button=node.querySelector('[type="submit"]'),error=root.querySelector('#pronto-register-error');
   const email=String(f.get('email')||'').trim().toLowerCase(),password=String(f.get('password')||'');
   if(!resuming&&password!==f.get('confirm')){error.textContent='As palavras-passe não coincidem.';return;}
   const profile={owner_name:String(f.get('owner_name')||'').trim(),business_name:String(f.get('business_name')||'').trim(),
    phone:String(f.get('phone')||'').trim(),whatsapp:String(f.get('whatsapp')||'').trim(),industry:String(f.get('industry')||''),
    address:String(f.get('address')||'').trim(),accept_terms:f.get('accept_terms')==='on',
    marketing_consent:f.get('marketing_consent')==='on'};
   if(!normalizeMozambiquePhone(profile.phone)){error.textContent='Introduza um número de telemóvel moçambicano válido (por exemplo, 84 123 4567).';return;}
   button.disabled=true;error.textContent='';
   let stage='identidade';
   try{
    // Auth-first flow supports verified-email projects. Retry on login is safe.
    if(!resuming){
     const result=await client.selfServiceSignUp(email,password,profile.owner_name);
     if(result.needsEmailConfirmation){
      error.textContent='A confirmação de e-mail ainda está activa nas definições do Supabase. Desactive «Confirm Email» em Authentication → Providers → Email para permitir a entrada imediata.';
      button.disabled=false;return;
     }
    }
    stage='negócio';
    await client.registerSelfServiceBusiness(profile);
    stage='acesso';
    await ready(await client.account(),false);
   }catch(e){
    const errors={
     supabase_rate_limit:'Muitas tentativas de registo. Aguarde alguns minutos.',
     registration_disabled:'O registo de novos utilizadores está desactivado no servidor. Contacte o suporte do Pronto POS.',
     registration_email_exists:'Este e-mail já está registado. Utilize Entrar ou Recuperar palavra-passe.',
     registration_email_invalid:'Este endereço de e-mail não foi aceite. Verifique os dados.',
     registration_weak_password:'A palavra-passe foi recusada. Use pelo menos 12 caracteres e evite palavras-passe comuns.',
     registration_invalid:'Verifique o nome, e-mail e palavra-passe.',
     registration_failed:'O servidor recusou a criação da conta. Verifique se o registo de utilizadores está activo.',
     registration_response_invalid:'O servidor não confirmou a criação da conta. Use Entrar para verificar antes de repetir.',
     supabase_unavailable:'Não foi possível comunicar com o servidor. Verifique a ligação.',
     registration_network:'Não foi possível contactar o serviço de registo. Verifique a ligação e tente novamente.',
     verify_email_first:'Confirme o endereço de e-mail e volte a entrar para activar a loja.',
     account_already_registered:'Este utilizador já está associado a um negócio. Entre normalmente.',
     trial_unavailable:'O teste gratuito está temporariamente indisponível. Contacte o suporte.',
     invalid_phone:'O número de telemóvel deve ser um número moçambicano válido.',
     phone_already_registered:'Este número já está associado a uma conta. Entre com o número e a sua palavra-passe.',
     phone_login_unavailable:'O acesso por telemóvel está temporariamente indisponível.',
     terms_required:'Aceite os termos de utilização para activar a loja.',
     invalid_registration:'Verifique o nome, o nome do negócio, o telemóvel e o WhatsApp (mínimo 7 dígitos).',
     login_required:'A sessão terminou. Entre com o seu e-mail para concluir o registo da loja.'
    };
    const fallback=stage==='negócio'?'A conta foi criada, mas a loja ainda não foi activada. Entre com o seu e-mail e conclua o registo.':
     stage==='acesso'?'A loja foi criada, mas o painel não abriu. Entre com o seu e-mail para continuar.':
     'O registo não foi concluído. Nenhuma loja foi criada. Verifique os dados e tente novamente.';
    error.textContent=(errors[e.message]||fallback)+' [Etapa: '+stage+']';
    button.disabled=false;
   }
  });
 };
 const form=()=>{
  if(staffWaitTimer){clearInterval(staffWaitTimer);staffWaitTimer=null;}
  shell('<div class="pronto-login-heading"><span class="pronto-login-eyebrow">Acesso à sua loja</span>'+
   '<h2>Bem-vindo</h2>'+
   '<p>Entre para gerir a sua loja com facilidade.</p></div>'+
  '<form id="pronto-auth-check-form">'+
   '<label for="pronto-login-email">E-mail ou número de telemóvel</label>'+
   '<div class="pronto-field"><span class="pronto-field-icon" aria-hidden="true">✉</span>'+
    '<input id="pronto-login-email" type="text" name="email" placeholder="84 123 4567 ou email@exemplo.co.mz" autocomplete="username" maxlength="254" required></div>'+
   '<label for="pronto-login-password">Palavra-passe</label>'+
   '<div class="pronto-field"><span class="pronto-field-icon" aria-hidden="true">♧</span>'+
    '<input id="pronto-login-password" type="password" name="password" placeholder="Introduza a sua palavra-passe" autocomplete="current-password" maxlength="200" required>'+
    '<button type="button" id="pronto-toggle-password" class="pronto-password-toggle" aria-label="Mostrar palavra-passe" aria-pressed="false">Mostrar</button></div>'+
   '<div class="pronto-login-helpers"><button type="button" class="pronto-recovery-link" id="recovery-request">Esqueceu-se da palavra-passe?</button></div>'+
   '<p id="pronto-auth-check-error" role="alert" aria-live="polite"></p>'+
   '<button class="primary full pronto-login-submit" type="submit">Entrar <span aria-hidden="true">→</span></button>'+
  '</form>'+
  '<button type="button" class="secondary full" id="pronto-show-register">Registar o meu negócio · 10 dias grátis</button>'+
  '<div class="pronto-login-security"><span aria-hidden="true">✓</span> Acesso seguro para proprietários e colaboradores.</div>');
  root.querySelector('#pronto-show-register').onclick=()=>registration(false);
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
    const account=await client.signIn(String(data.get('email')||'').trim(),String(data.get('password')||''));
    node.reset();await ready(account,false);
    await loading.finish();
   }catch(e){
    loading.cancel();
    const messages={
     supabase_rate_limit:'Demasiadas tentativas. Aguarde e volte a tentar.',
     supabase_unauthorized:'Não foi possível autenticar. Confira a conta e as permissões.',
     supabase_invalid_credentials:'Número/e-mail ou palavra-passe incorrectos.',
     phone_login_unavailable:'O acesso por telemóvel não está disponível neste momento. Tente pelo e-mail.',
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
  if(!admin&&!account.grants.length&&staffAccess?.reason!=='blocked'&&staffAccess?.reason!=='outside_schedule'&&staffAccess?.reason!=='suspended'){
   shell('<h2>Conta confirmada</h2><p>Finalize o registo do seu negócio e active os 10 dias gratuitos.</p>'+
    '<button type="button" class="primary full" id="pronto-complete-registration">Registar o meu negócio</button>'+
    '<button type="button" class="secondary full" id="pronto-self-logout">Terminar sessão</button>');
   root.querySelector('#pronto-complete-registration').onclick=()=>registration(true);
   root.querySelector('#pronto-self-logout').onclick=async()=>{await client.signOut();form();};
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

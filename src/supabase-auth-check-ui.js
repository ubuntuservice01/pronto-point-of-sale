import {prontoSupabaseConfig} from './pronto-supabase-config.js';
import {startProntoLoading} from './ui/pronto-loading.js';
import {createProntoIdentity,normalizeMozambiquePhone} from './supabase-identity.js';
import {mountUbuntuAdminDashboard} from './supabase-admin-dashboard.js';
import {mountSupabaseMerchantPilot} from './supabase-shop-dashboard.js';
import {mountProntoPinGate} from './supabase-pin-lock.js';
import {extractRecoveryFromHash,mountPasswordRecovery} from './supabase-recovery-ui.js';
import {confirmSelfServiceActivation} from './self-service-activation.js';

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
 // Business details typed before a failed activation stay in memory only (never
 // storage, never e-mail/password) so a retry after login does not retype them.
 let pendingProfile=null,pendingEmail='';
 const forgetPending=()=>{pendingProfile=null;pendingEmail='';};
 const loginToFinish=email=>{
  form();
  const emailInput=root.querySelector('#pronto-login-email');
  if(emailInput&&email)emailInput.value=email;
  root.querySelector(email?'#pronto-login-password':'#pronto-login-email')?.focus();
 };
 const activated=({businessName,expiresAt,trialDays})=>{
  const until=new Date(expiresAt).toLocaleDateString('pt-PT',{day:'2-digit',month:'long',year:'numeric',timeZone:'Africa/Maputo'});
  shell('<div class="pronto-activation-success" role="status" aria-live="polite">'+
   '<span class="pronto-activation-check" aria-hidden="true">✓</span>'+
   '<span class="pronto-login-eyebrow">Negócio activado</span>'+
   '<h2 tabindex="-1">A sua loja está pronta</h2>'+
   '<p><strong>'+escape(businessName)+'</strong> foi criada e o teste gratuito de '+trialDays+' dias está activo.</p>'+
   '<p class="pronto-activation-until">Teste válido até <strong>'+escape(until)+'</strong></p>'+
   '<p id="pronto-activation-error" role="alert"></p>'+
   '<button type="button" class="primary full" id="pronto-activation-continue">Continuar · criar o meu PIN</button></div>');
  root.querySelector('.pronto-activation-success h2')?.focus();
  const button=root.querySelector('#pronto-activation-continue');
  button.onclick=async()=>{
   button.disabled=true;
   try{await ready(await client.account(),false);}
   catch{root.querySelector('#pronto-activation-error').textContent='A loja está activa, mas não foi possível abrir o painel. Verifique a ligação e tente novamente.';button.disabled=false;}
  };
 };
 const registration=(alreadySignedIn=false)=>{
  // Only an explicit true means this account is already authenticated.
  const resuming=alreadySignedIn===true;
  // Once this browser holds the new account's session, only the shop activation
  // may be repeated: a second signup would collide with the account just created.
  let identityReady=resuming;
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
  const node=root.querySelector('#pronto-self-register');
  const activationOnly=(hint)=>{
   node.dataset.activationOnly='true';
   for(const field of ['email','password','confirm']){const input=node.querySelector('[name="'+field+'"]');if(input){input.required=false;input.value='';input.closest('label').hidden=true;}}
   root.querySelector('.pronto-login-heading h2').textContent='Activar o meu negócio';
   root.querySelector('.pronto-login-heading p').textContent=hint;
   node.querySelector('[type="submit"]').textContent=resuming&&!node.dataset.retried?'Activar negócio e teste de 10 dias':'Repetir activação do negócio';
  };
  if(resuming){
   activationOnly('A sua conta já existe. Complete os dados para activar o seu teste de 10 dias.');
   if(pendingProfile)for(const [key,value] of Object.entries(pendingProfile)){
    const input=node.elements[key];if(!input)continue;
    if(input.type==='checkbox')input.checked=value===true;else input.value=value;
   }
  }
  node.addEventListener('submit',async event=>{
   event.preventDefault();const f=new FormData(node),button=node.querySelector('[type="submit"]'),error=root.querySelector('#pronto-register-error');
   const email=String(f.get('email')||'').trim().toLowerCase(),password=String(f.get('password')||'');
   if(!identityReady&&password!==f.get('confirm')){error.textContent='As palavras-passe não coincidem.';return;}
   const profile={owner_name:String(f.get('owner_name')||'').trim(),business_name:String(f.get('business_name')||'').trim(),
    phone:String(f.get('phone')||'').trim(),whatsapp:String(f.get('whatsapp')||'').trim(),industry:String(f.get('industry')||''),
    address:String(f.get('address')||'').trim(),accept_terms:f.get('accept_terms')==='on',
    marketing_consent:f.get('marketing_consent')==='on'};
   if(!normalizeMozambiquePhone(profile.phone)){error.textContent='Introduza um número de telemóvel moçambicano válido (por exemplo, 84 123 4567).';return;}
   button.disabled=true;error.textContent='';
   pendingProfile=profile;if(email)pendingEmail=email;
   let stage='identidade',alreadyRegistered=false;
   try{
    // Auth-first flow supports verified-email projects. Retry on login is safe.
    if(!identityReady){
     const result=await client.selfServiceSignUp(email,password,profile.owner_name);
     if(result.needsEmailConfirmation){
      error.textContent='O registo foi iniciado. Confirme o e-mail recebido para continuar.';
      const loginButton=root.querySelector('#pronto-register-back');
      loginButton.textContent='Já confirmei o e-mail · Entrar e activar';
      loginButton.onclick=()=>loginToFinish(email);
      button.disabled=false;return;
     }
     identityReady=true;
    }
    stage='negócio';
    let created=null;
    try{created=await client.registerSelfServiceBusiness(profile);}
    catch(e){
     // An earlier attempt may have committed although its answer was lost.
     // Verify that shop instead of creating, or claiming, a second one.
     if(e.message!=='account_already_registered')throw e;
     alreadyRegistered=true;
    }
    stage='confirmação';
    const confirmed=await confirmSelfServiceActivation(client,{expectedBusinessId:alreadyRegistered?null:String(created?.business_id||'')});
    forgetPending();
    activated(confirmed);
   }catch(e){
    const errors={
     supabase_rate_limit:'Muitas tentativas de registo. Aguarde alguns minutos.',
     registration_disabled:'O registo de novos utilizadores está desactivado no servidor. Contacte o suporte do Pronto POS.',
     registration_email_exists:'Este e-mail já está registado. Toque em «Já tenho conta · Entrar». Se não souber a palavra-passe, escolha «Esqueceu-se da palavra-passe?».',
     registration_conflict:'Não foi possível registar novamente este e-mail. Se já tem conta, toque em «Já tenho conta · Entrar» e conclua o registo do negócio. Se não tem conta, verifique os dados.',
     registration_email_invalid:'Este endereço de e-mail não foi aceite. Verifique os dados.',
     registration_weak_password:'A palavra-passe foi recusada. Use pelo menos 12 caracteres e evite palavras-passe comuns.',
     registration_invalid:'Verifique o nome, e-mail e palavra-passe.',
     registration_failed:'Não foi possível criar a conta. Tente novamente ou contacte o suporte do Pronto POS.',
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
     login_required:'A sessão terminou. Entre com o seu e-mail para concluir o registo da loja.',
     supabase_unauthorized:'A sessão terminou. Entre com o seu e-mail ou telemóvel para concluir a activação da loja.'
    };
    const fallback=stage==='negócio'?'A conta foi criada, mas a loja ainda não foi activada. Corrija os dados se necessário e toque em «Repetir activação do negócio».':
     stage==='confirmação'?(alreadyRegistered&&e.message==='activation_unconfirmed'?errors.account_already_registered:
      'Ainda não foi possível confirmar a loja e o teste de 10 dias. Nada foi duplicado. Toque em «Repetir activação do negócio» para verificar novamente.'):
      'O registo não foi concluído. Nenhuma loja foi criada. Verifique os dados e tente novamente.';
    const known=stage==='confirmação'&&!['supabase_unauthorized','login_required'].includes(e.message)?null:errors[e.message];
    error.textContent=(known||fallback)+' [Etapa: '+stage+']';
    if(identityReady){
     // The account exists from here on: never offer a new signup again.
     node.dataset.retried='true';
     activationOnly('A sua conta já foi criada. Falta apenas activar o negócio e o teste de 10 dias.');
     if(['login_required','supabase_unauthorized','verify_email_first'].includes(e.message)){
      const loginButton=root.querySelector('#pronto-register-back');
      loginButton.textContent='Entrar para concluir a activação →';
      loginButton.onclick=()=>loginToFinish(pendingEmail);
     }
    }
    if(stage==='identidade'&&['registration_email_exists','registration_conflict'].includes(e.message)){
     const loginButton=root.querySelector('#pronto-register-back');
     loginButton.textContent='Entrar na conta existente →';
     loginButton.onclick=()=>loginToFinish(email);
    }
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
  '<a class="pronto-learn-more" href="/apresentacao/index.html">Conheça as vantagens e os planos do Pronto POS →</a>'+
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
   shell('<h2>Conta confirmada</h2><p>A sua conta existe, mas o negócio ainda não foi activado. Conclua apenas a activação para começar os 10 dias gratuitos.</p>'+
    '<button type="button" class="primary full" id="pronto-complete-registration">Activar o meu negócio</button>'+
    '<button type="button" class="secondary full" id="pronto-self-logout">Terminar sessão</button>');
   root.querySelector('#pronto-complete-registration').onclick=()=>registration(true);
   root.querySelector('#pronto-self-logout').onclick=async()=>{forgetPending();await client.signOut();form();};
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
   forgetPending();await client.signOut();form();
  };
 };
 const bootstrap=async()=>{
  const loading=startProntoLoading();
  if(recovery.token){loading.cancel();beginRecovery(recovery.token,recovery.kind);return;}
  try{
   const account=await client.restoreSession();
   if(account)await ready(account,true);
   else if(new URLSearchParams(location.search).get('register')==='1')registration(false);
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

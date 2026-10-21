// Supabase Auth recovery screen. Tokens are consumed only in memory and
// removed from the URL before rendering any account or password forms.
const content=(form)=>'<section class="login-shell"><div class="login-brand"><img src="/icon.svg" alt=""><h1>Pronto POS</h1><p>Recuperação de acesso</p></div><div class="panel login-panel">'+form+
 '</div><footer>Ubuntu Service, Lda.</footer></section>';

export function extractRecoveryFromHash(locationObj,historyObj){
 const params=new URLSearchParams((locationObj.hash||'').replace(/^#/,''));
 const kind=['recovery','invite'].includes(params.get('type'))?params.get('type'):null;
 const token=kind?params.get('access_token'):null;
 const error=params.get('error')||null;
 if(params.has('access_token')||params.has('refresh_token')||error){
  // Prevent secrets from leaking into copied URLs, logs or future navigation.
  historyObj.replaceState(null,'',locationObj.pathname+locationObj.search);
 }
 return {token,error,kind};
}
export function mountPasswordRecovery({root,client,token,onBack,kind='recovery'}){
 const back=()=>onBack();
 if(token){
  root.innerHTML=content('<h2>'+(kind==='invite'?'Activar conta de colaborador':'Definir nova palavra-passe')+'</h2>'+
   '<p>'+(kind==='invite'?'Confirme a sua identidade através do convite e defina a palavra-passe inicial. Depois poderá criar o PIN pessoal de cinco dígitos.':'Introduza uma palavra-passe forte para a sua conta.')+'</p>'+
   '<form id="recovery-confirm-form">'+
   '<label>Nova palavra-passe<input type="password" name="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>'+
   '<label>Confirmar palavra-passe<input type="password" name="confirm" minlength="12" maxlength="128" autocomplete="new-password" required></label>'+
   '<p id="recovery-message" role="status" aria-live="polite"></p>'+
   '<button type="submit" class="primary full">Guardar nova palavra-passe</button>'+
   '</form><button type="button" class="secondary full" id="recovery-back">Voltar ao login</button>');
  const form=root.querySelector('#recovery-confirm-form');
  form.addEventListener('submit',async e=>{
   e.preventDefault();
   const values=new FormData(form),pass=String(values.get('password')||''),confirm=String(values.get('confirm')||'');
   const msg=root.querySelector('#recovery-message');
   if(pass!==confirm){msg.textContent='As palavras-passe não coincidem.';return;}
   if(pass.length<12){msg.textContent='Utilize pelo menos 12 caracteres.';return;}
   const btn=form.querySelector('button');btn.disabled=true;
   try{
    await client.completePasswordRecovery(token,pass);
    form.reset();
    root.innerHTML=content('<h2>Palavra-passe actualizada</h2><p>Já pode entrar com a nova palavra-passe.</p>'+
     '<button type="button" class="primary full" id="recovery-finished">Ir para o login</button>');
    root.querySelector('#recovery-finished').onclick=back;
   }catch{
    msg.textContent='Não foi possível concluir a recuperação. O link pode ter expirado. Solicite outro.';
    btn.disabled=false;
   }
  });
  root.querySelector('#recovery-back').onclick=back;
  return;
 }
 root.innerHTML=content('<h2>Esqueceu-se da palavra-passe?</h2>'+
  '<p>Indique o email da conta. Se existir e o serviço de email estiver configurado, receberá instruções para recuperar o acesso.</p>'+
  '<form id="recovery-request-form"><label>Email<input type="email" name="email" maxlength="254" autocomplete="email" required></label>'+
  '<p id="recovery-message" role="status" aria-live="polite"></p>'+
  '<button type="submit" class="primary full">Solicitar recuperação</button></form>'+
  '<button type="button" id="recovery-back" class="secondary full">Voltar ao login</button>');
 const form=root.querySelector('#recovery-request-form');
 form.addEventListener('submit',async e=>{
  e.preventDefault();const email=String(new FormData(form).get('email')||'');
  const btn=form.querySelector('button'),msg=root.querySelector('#recovery-message');
  btn.disabled=true;
  try{
   const redirect=new URL(location.pathname,location.origin);
   redirect.searchParams.set('mode','supabase');
   redirect.searchParams.set('reset-password','1');
   await client.requestPasswordRecovery(email,redirect.href);
   // The same message for unknown addresses, to limit account enumeration.
   msg.textContent='Se este email estiver registado e o serviço de envio estiver activo, receberá uma ligação de recuperação.';
  }catch(e){
   msg.textContent=e.message==='supabase_rate_limit'?'Demasiadas tentativas. Aguarde alguns minutos.':
    'Não foi possível processar o pedido neste momento. Confirme a ligação e o serviço de email.';
  }finally{btn.disabled=false;}
 });
 root.querySelector('#recovery-back').onclick=back;
}

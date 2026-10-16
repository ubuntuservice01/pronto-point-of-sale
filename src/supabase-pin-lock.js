// Trusted-screen PIN gate for sessions already authenticated with Supabase Auth.
// Not a replacement for Supabase Auth / MFA and not a cold-start login credential.
const valid=value=>typeof value==='string'&&/^[0-9]{5}$/.test(value);
export const PIN_IDLE_MS=180000;
export function pinError(result){
 if(result?.reason==='incorrect_pin')return 'PIN incorrecto. Restam '+(result.remaining_attempts??'?')+' tentativas.';
 if(result?.reason==='temporarily_blocked'){
  const mins=Math.max(1,Math.ceil((Number(result.retry_after_seconds)||900)/60));
  return 'Acesso temporariamente bloqueado. Aguarde cerca de '+mins+' minuto'+(mins===1?'':'s')+'.';
 }
 if(result?.reason==='already_configured')return 'Esta conta já possui um PIN. Termine a sessão e volte a entrar.';
 if(result?.reason==='not_configured')return 'Esta conta ainda não possui PIN. Termine a sessão e entre novamente.';
 return 'Não foi possível validar o PIN. Verifique a ligação e tente novamente.';
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pinScreen({mode='unlock',email='',message=''}={}){
 const setup=mode==='create',change=mode==='change',recover=mode==='recover';
 const title=setup?'Criar PIN de 5 dígitos':change?'Alterar PIN':recover?'Recuperar PIN':'Ecrã bloqueado';
 const subtitle=setup?'O PIN pertence à sua conta e será usado para desbloquear este dispositivo.':
  change?'Introduza o PIN actual e escolha um novo PIN.':
  recover?'Confirme a sua palavra-passe da conta Supabase para definir um novo PIN pessoal.':
  'Introduza o seu PIN para continuar sem perder o trabalho.';
 const fields=setup||change||recover?
  '<form id="pronto-pin-form" autocomplete="off">'+
   (recover?'<label>Palavra-passe da conta<input name="password" type="password" autocomplete="current-password" maxlength="200" required></label>':'')+
   (change?'<label>PIN actual<input name="current" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>':'')+
   '<label>Novo PIN<input name="new" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>'+
   '<label>Confirmar PIN<input name="confirm" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>'+
   '<button class="pronto-pin-primary" type="submit">'+(setup?'Activar PIN':recover?'Recuperar PIN':'Alterar PIN')+'</button></form>':
  '<form id="pronto-pin-form" autocomplete="off">'+
   '<div class="pronto-pin-dots" aria-hidden="true">'+Array.from({length:5},()=>'<span></span>').join('')+'</div>'+
   '<label class="pronto-pin-input-label">PIN<input id="pronto-pin-entry" name="pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" maxlength="5" minlength="5" required aria-label="Introduza o PIN de cinco dígitos"></label>'+
   '<div class="pronto-pin-keypad">'+['1','2','3','4','5','6','7','8','9','Limpar','0','⌫'].map(key=>
    '<button type="button" data-pin-key="'+escape(key)+'" aria-label="'+(key==='⌫'?'Apagar último número':escape(key))+'">'+escape(key)+'</button>').join('')+'</div>'+
   '<button class="pronto-pin-primary" type="submit">Desbloquear</button></form>';
 return '<section class="pronto-pin-panel" role="dialog" aria-modal="true" aria-labelledby="pronto-pin-title">'+
 '<div class="pronto-pin-brand"><img src="/icon.svg" alt=""><strong>Pronto POS</strong></div>'+
 '<div class="pronto-pin-lock-icon" aria-hidden="true">🔒</div>'+
 '<h2 id="pronto-pin-title">'+title+'</h2><p class="pronto-pin-intro">'+subtitle+'</p>'+
 '<p class="pronto-pin-account">'+escape(email)+'</p>'+fields+
 '<p class="pronto-pin-message" id="pronto-pin-message" role="alert" aria-live="polite">'+escape(message)+'</p>'+
 (mode==='unlock'||mode==='change'?'<button class="pronto-pin-exit" type="button" id="pronto-pin-forgot">Esqueci o PIN</button>':'')+
 '<button class="pronto-pin-exit" type="button" id="pronto-pin-signout">Sair e iniciar sessão novamente</button>'+
 '<small>O PIN não substitui a palavra-passe da conta nem autoriza operações offline.</small></section>';
}
export async function mountProntoPinGate({
 root,client,account,open,onLogout,
 idleMs=PIN_IDLE_MS,
 doc=document,win=window
}){
 if(!root||!account?.userId||typeof client?.sessionPin!=='function')throw Error('pin_gate_invalid');
 const controller=new AbortController();
 const {signal}=controller;
 let overlay=null,toolbar=null,timer=null,opened=false,locking=false,destroyed=false,processing=false;
 const cleanup=()=>{
  destroyed=true;controller.abort();
  if(timer!==null)win.clearTimeout(timer);
  overlay?.remove();toolbar?.remove();overlay=null;toolbar=null;
  root.inert=false;root.removeAttribute('aria-hidden');
 };
 const signout=async()=>{
  cleanup();
  try{await client.signOut();}finally{onLogout();}
 };
 const resetIdle=()=>{
  if(destroyed||locking||!opened)return;
  if(timer!==null)win.clearTimeout(timer);
  timer=win.setTimeout(()=>show('unlock'),idleMs);
 };
 const show=mode=>{
  if(destroyed||processing&&mode==='unlock')return;
  locking=true;client.lockScreen();
  if(timer!==null)win.clearTimeout(timer);timer=null;
  root.inert=true;root.setAttribute('aria-hidden','true');
  toolbar?.remove();toolbar=null;
  if(!overlay){
   overlay=doc.createElement('div');
   overlay.className='pronto-pin-backdrop';
   doc.body.appendChild(overlay);
  }
  overlay.innerHTML=pinScreen({mode,email:account.email});
  const form=overlay.querySelector('#pronto-pin-form');
  const alert=overlay.querySelector('#pronto-pin-message');
  const entry=overlay.querySelector('#pronto-pin-entry');
  const submit=form.querySelector('[type="submit"]');
  function updateDots(){
   const n=entry?.value.length||0;
   overlay.querySelectorAll('.pronto-pin-dots span').forEach((dot,i)=>dot.classList.toggle('entered',i<n));
  }
  if(entry){
   entry.addEventListener('input',()=>{
    entry.value=entry.value.replace(/\D/g,'').slice(0,5);
    updateDots();
   },{signal});
   overlay.querySelectorAll('[data-pin-key]').forEach(button=>{
    button.addEventListener('click',()=>{
     const key=button.dataset.pinKey;
     entry.value=key==='Limpar'?'':key==='⌫'?entry.value.slice(0,-1):(entry.value+key).slice(0,5);
     updateDots();entry.focus();
    },{signal});
   });
  }
  overlay.querySelector('#pronto-pin-signout').addEventListener('click',()=>void signout(),{signal});
  overlay.querySelector('#pronto-pin-forgot')?.addEventListener('click',()=>show('recover'),{signal});
  form.addEventListener('submit',async e=>{
   e.preventDefault();
   if(processing||destroyed)return;
   const values=new FormData(form);
   const pin=mode==='unlock'?String(values.get('pin')||''):String(values.get('new')||'');
   const current=String(values.get('current')||'');
   if(!valid(pin)||mode==='change'&&!valid(current)){
    alert.textContent='O PIN deve conter exactamente cinco números.';return;
   }
   if(mode!=='unlock'&&pin!==String(values.get('confirm')||'')){
    alert.textContent='Os PINs não coincidem.';return;
   }
   processing=true;submit.disabled=true;alert.textContent='A validar no Supabase…';
   try{
    const result=mode==='recover'?await client.recoverPinWithPassword({
     password:String(values.get('password')||''),pin
    }):await client.sessionPin(mode==='unlock'?'verify':mode,pin,mode==='change'?current:null);
    if(result?.ok!==true){alert.textContent=pinError(result);return;}
    if(mode==='create'||mode==='change'||mode==='recover'){
     const check=await client.sessionPin('verify',pin);
     if(check?.ok!==true){alert.textContent=pinError(check);return;}
    }
    if(!opened){await open();opened=true;}
    close();
   }catch(error){
    if(error.message==='pin_recovery_password_incorrect'){
     alert.textContent='Palavra-passe incorrecta. Utilize a mesma que usa para iniciar sessão.';
    }else if(error.message==='pin_recovery_same_pin'){
     alert.textContent='Escolha um PIN diferente do anterior.';
    }else if(error.message==='supabase_rate_limit'){
     alert.textContent='Demasiadas tentativas. Aguarde um minuto e tente novamente.';
    }else if(error.message==='supabase_unauthorized'){
     alert.textContent='A sessão expirou. Termine a sessão e entre novamente.';
    }else{
     alert.textContent='Falha na ligação ao Supabase. Não foi possível desbloquear.';
    }
   }finally{processing=false;if(submit.isConnected)submit.disabled=false;}
  },{signal});
  win.setTimeout(()=>{if(!destroyed)form.querySelector('input')?.focus();},0);
 };
 const close=()=>{
  if(destroyed)return;
  overlay?.remove();overlay=null;
  root.inert=false;root.removeAttribute('aria-hidden');locking=false;
  toolbar=doc.createElement('div');toolbar.className='pronto-pin-controls';
  toolbar.innerHTML='<button type="button" data-pin-lock>🔒 Bloquear</button><button type="button" data-pin-change>Alterar PIN</button>';
  doc.body.appendChild(toolbar);
  toolbar.querySelector('[data-pin-lock]').onclick=()=>show('unlock');
  toolbar.querySelector('[data-pin-change]').onclick=()=>show('change');
  resetIdle();
 };
 // Screen was obscured, device slept or another app was opened: lock immediately.
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&opened&&!locking)show('unlock');},{signal});
 win.addEventListener('pagehide',()=>{if(opened&&!locking)show('unlock');},{signal});
 for(const type of ['pointerdown','keydown','touchstart','wheel']){
  doc.addEventListener(type,resetIdle,{signal,passive:true});
 }
 try{
  const status=await client.sessionPin('status');
  if(destroyed)return {cleanup,lock:()=>{}};
  if(status.configured){show('unlock');}
  else{show('create');}
 }catch(error){
  cleanup();throw error;
 }
 return {cleanup,lock:()=>{if(opened&&!locking)show('unlock');}};
}

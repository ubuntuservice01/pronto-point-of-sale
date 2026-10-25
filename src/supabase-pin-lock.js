// Trusted-screen PIN gate for sessions already authenticated with Supabase Auth.
import {clearPinContinuity,rememberPinContinuity,canResumePinContinuity} from './pronto-pin-continuity.js';
import {pinCityBackdrop,readPinKPIs,clearPinKPIs} from './pin-city-ui.js';
import {MONEY} from './supabase-shop-core.js';
// Not a replacement for Supabase Auth / MFA and not a cold-start login credential.
const valid=value=>typeof value==='string'&&/^[0-9]{5}$/.test(value);
export const PIN_FOOTER_TEXT='Plataforma desenvolvida pela Ubuntu Service Limitada — Criando pontes entre o físico e o digital.';
// Number-row and Numpad presses both expose their character through event.key.
// Ignore shortcuts and composition so the keyboard handler stays PIN-only.
export function pinKeyboardKey(event){
 if(!event||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return null;
 const key=String(event.key||'');
 return /^[0-9]$/.test(key)||['Backspace','Delete','Escape','Enter'].includes(key)?key:null;
}
export function editUnlockPin(value,key){
 const current=String(value??'').replace(/[^0-9]/g,'').slice(0,5);
 if(/^[0-9]$/.test(key))return (current+key).slice(0,5);
 if(key==='Backspace')return current.slice(0,-1);
 if(key==='Delete'||key==='Escape')return '';
 return current;
}
// A locked checkout can retain focus on a price/quantity input behind the overlay.
// Blur it before rendering the PIN pad: inert alone doesn't reliably close Gboard.
export function dismissUnlockSoftKeyboard({doc,win}={}){
 try{doc?.activeElement?.blur?.();}catch{/* Ignore inaccessible focus targets. */}
 try{
  const result=win?.navigator?.virtualKeyboard?.hide?.();
  result?.catch?.(()=>{});
 }catch{/* VirtualKeyboard is optional (including on iOS). */}
}
export const PIN_IDLE_MS=600000; // 10 minutes of actual inactivity.
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
export function pinScreen({mode='unlock',email='',message='',metrics=null}={}){
 const setup=mode==='create',change=mode==='change',recover=mode==='recover',passwordSetup=mode==='password';
 const title=passwordSetup?'Criar nova palavra-passe':setup?'Criar PIN de 5 dígitos':change?'Alterar PIN':recover?'Recuperar PIN':'Ecrã bloqueado';
 const subtitle=passwordSetup?'Primeiro acesso · Passo 1 de 2. Substitua a palavra-passe provisória. Depois criará o PIN de 5 dígitos.':
  setup?'Passo 2 de 2. Crie um PIN pessoal para desbloquear o Pronto POS.':
  change?'Introduza o PIN actual e escolha um novo PIN.':
  recover?'Confirme a sua palavra-passe para definir um novo PIN pessoal.':
  'Introduza o seu PIN para continuar sem perder o trabalho.';
 const fields=passwordSetup?
  '<form id="pronto-pin-form" autocomplete="off">'+
  '<label>Palavra-passe provisória<input name="current_password" type="password" autocomplete="current-password" minlength="1" maxlength="200" required></label>'+
  '<label>Nova palavra-passe<input name="new_password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>'+
  '<label>Confirmar nova palavra-passe<input name="confirm_password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>'+
  '<p class="pronto-pin-password-tip">Use pelo menos 12 caracteres. Não reutilize a palavra-passe provisória.</p>'+
  '<button class="pronto-pin-primary" type="submit">Guardar e criar PIN →</button></form>':setup||change||recover?
  '<form id="pronto-pin-form" autocomplete="off">'+
   (recover?'<label>Palavra-passe da conta<input name="password" type="password" autocomplete="current-password" maxlength="200" required></label>':'')+
   (change?'<label>PIN actual<input name="current" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>':'')+
   '<label>Novo PIN<input name="new" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>'+
   '<label>Confirmar PIN<input name="confirm" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>'+
   '<button class="pronto-pin-primary" type="submit">'+(setup?'Activar PIN':recover?'Recuperar PIN':'Alterar PIN')+'</button></form>':
  '<form id="pronto-pin-form" autocomplete="off" novalidate>'+
   '<div class="pronto-pin-dots" aria-hidden="true">'+Array.from({length:5},()=>'<span></span>').join('')+'</div>'+
   '<input id="pronto-pin-entry" name="pin" type="hidden" value=""><span class="pronto-pin-input-label" id="pronto-pin-count" role="status" aria-live="polite">PIN vazio</span>'+
   '<div class="pronto-pin-keypad">'+['1','2','3','4','5','6','7','8','9','Limpar','0','⌫'].map(key=>{
    const letters={2:'ABC',3:'DEF',4:'GHI',5:'JKL',6:'MNO',7:'PQRS',8:'TUV',9:'WXYZ'}[key]||'';
    return '<button type="button" data-pin-key="'+escape(key)+'" aria-label="'+(key==='⌫'?'Apagar último número':escape(key))+'">'+
     '<span>'+escape(key)+'</span>'+(letters?'<small>'+letters+'</small>':'')+'</button>';
   }).join('')+'</div>'+
   '<button class="pronto-pin-primary" type="submit">Desbloquear</button></form>';
 return pinCityBackdrop({metrics})+
 '<section class="pronto-pin-panel" role="dialog" aria-modal="true" aria-labelledby="pronto-pin-title">'+
 '<div class="pronto-pin-brand"><img src="/icon.svg" alt=""><strong>Pronto <span class="pin-pos-green">POS</span></strong></div>'+
 '<div class="pronto-pin-lock-icon" aria-hidden="true">🔒</div>'+
 '<h2 id="pronto-pin-title">'+title+'</h2><p class="pronto-pin-intro">'+subtitle+'</p>'+
 '<p class="pronto-pin-account">'+escape(email)+'</p>'+fields+
 '<p class="pronto-pin-message" id="pronto-pin-message" role="alert" aria-live="polite">'+escape(message)+'</p>'+
 '<div class="pin-city-actions">'+
 (mode==='unlock'||mode==='change'?'<button class="pronto-pin-exit" type="button" id="pronto-pin-forgot">Esqueci o PIN</button>':'')+
 '<button class="pronto-pin-exit" type="button" id="pronto-pin-signout">Terminar sessão</button></div>'+
 '<small>O PIN protege o acesso à sua conta.</small>'+
 '<div class="pin-city-mobile-kpis" aria-label="Resumo da loja">'+
  '<div><span>Vendas hoje</span><strong>'+(metrics?escape(MONEY(metrics.todayCents)):'—')+'</strong></div>'+
  '<div><span>Este mês</span><strong>'+(metrics?escape(MONEY(metrics.monthCents)):'—')+'</strong></div>'+
 '</div></section>'+
 '<footer class="pin-city-footer">Plataforma desenvolvida pela <strong>Ubuntu Service Limitada</strong> — Criando pontes entre o físico e o digital.</footer>';
}
export async function mountProntoPinGate({
 root,client,account,open,onLogout,
 idleMs=PIN_IDLE_MS,allowReloadResume=false,
 doc=document,win=window,tabStorage=null
}){
 if(!root||!account?.userId||typeof client?.sessionPin!=='function')throw Error('pin_gate_invalid');
 const controller=new AbortController();
 const {signal}=controller;
 let overlay=null,toolbar=null,timer=null,opened=false,locking=false,destroyed=false,processing=false;
 let unloading=false,lastRemembered=0,pinWasConfigured=false;
 let tabs=tabStorage;
 if(!tabs){try{tabs=win.sessionStorage;}catch{/* private mode */}}
 const forget=()=>clearPinContinuity(tabs,account.userId);
 const remember=()=>{
  const now=Date.now();
  if(now-lastRemembered<12000)return;
  lastRemembered=now;
  rememberPinContinuity(tabs,account.userId,now);
 };
 const cleanup=()=>{
  destroyed=true;controller.abort();
  if(timer!==null)win.clearTimeout(timer);
  overlay?.remove();toolbar?.remove();overlay=null;toolbar=null;
  root.inert=false;root.removeAttribute('aria-hidden');
  forget();
 };
 const signout=async()=>{
  cleanup();clearPinKPIs(account.userId);
  try{await client.signOut();}finally{onLogout();}
 };
 const resetIdle=()=>{
  if(destroyed||locking||!opened)return;
  if(timer!==null)win.clearTimeout(timer);
  remember();
  timer=win.setTimeout(()=>show('unlock'),idleMs);
 };
 const show=mode=>{
  if(destroyed||processing&&mode==='unlock')return;
  if(mode==='unlock')dismissUnlockSoftKeyboard({doc,win});
  locking=true;forget();client.lockScreen();
  if(timer!==null)win.clearTimeout(timer);timer=null;
  root.inert=true;root.setAttribute('aria-hidden','true');
  toolbar?.remove();toolbar=null;
  if(!overlay){
   overlay=doc.createElement('div');
   overlay.className='pronto-pin-backdrop pin-city-theme';
   doc.body.appendChild(overlay);
  }
  overlay.innerHTML=pinScreen({mode,email:account.email,metrics:readPinKPIs(account.userId)});
  const form=overlay.querySelector('#pronto-pin-form');
  const alert=overlay.querySelector('#pronto-pin-message');
  const entry=overlay.querySelector('#pronto-pin-entry');
  const submit=form.querySelector('[type="submit"]');
  function updateDots(){
   const n=entry?.value.length||0;
   overlay.querySelectorAll('.pronto-pin-dots span').forEach((dot,i)=>dot.classList.toggle('entered',i<n));
   const count=overlay.querySelector('#pronto-pin-count');
   if(count)count.textContent=n+' de 5 dígitos introduzidos';
  }
  if(entry){
   entry.addEventListener('input',()=>{
    entry.value=entry.value.replace(/\D/g,'').slice(0,5);
    updateDots();
   },{signal});
   overlay.querySelectorAll('[data-pin-key]').forEach(button=>{
    button.addEventListener('click',()=>{
     const key=button.dataset.pinKey;
     entry.value=editUnlockPin(entry.value,key==='Limpar'?'Delete':key==='⌫'?'Backspace':key);
     entry.dispatchEvent(new Event('input',{bubbles:true}));
     // Physical/touch PIN buttons never need Android's numeric keyboard.
     dismissUnlockSoftKeyboard({doc,win});
     submit.focus({preventScroll:true});
    },{signal});
   });
  }
  overlay.querySelector('#pronto-pin-signout').addEventListener('click',()=>void signout(),{signal});
  overlay.querySelector('#pronto-pin-forgot')?.addEventListener('click',()=>show('recover'),{signal});
  form.addEventListener('submit',async e=>{
   e.preventDefault();
   if(processing||destroyed)return;
   const values=new FormData(form);
   if(mode==='password'){
    const currentPassword=String(values.get('current_password')||'');
    const newPassword=String(values.get('new_password')||'');
    const confirmPassword=String(values.get('confirm_password')||'');
    if(newPassword.length<12||newPassword.length>128){
     alert.textContent='A nova palavra-passe deve ter entre 12 e 128 caracteres.';return;
    }
    if(newPassword!==confirmPassword){
     alert.textContent='As palavras-passe não coincidem.';return;
    }
    if(currentPassword===newPassword){
     alert.textContent='Escolha uma palavra-passe diferente da provisória.';return;
    }
    processing=true;submit.disabled=true;alert.textContent='';
    try{
     await client.changeInitialPassword(currentPassword,newPassword);
     account.requiresPasswordChange=false;
     // The server commits the new password before the PIN screen appears.
     show(pinWasConfigured?'unlock':'create');
    }catch(error){
     alert.textContent=error.message==='supabase_unauthorized'?
      'A sessão expirou. Termine a sessão e entre com a sua palavra-passe actual.':
      error.message==='password_setup_pending'?
      'Confirme o estado da conta antes de continuar. Se já mudou a palavra-passe, saia e volte a entrar.':
      error.message==='supabase_rate_limit'?
      'Muitas tentativas. Tente novamente mais tarde.':
      'Não foi possível alterar a palavra-passe. Confira a provisória e escolha uma palavra-passe forte.';
    }finally{processing=false;if(submit.isConnected)submit.disabled=false;}
    return;
   }
   const pin=mode==='unlock'?String(values.get('pin')||''):String(values.get('new')||'');
   const current=String(values.get('current')||'');
   if(!valid(pin)||mode==='change'&&!valid(current)){
    alert.textContent='O PIN deve conter exactamente cinco números.';return;
   }
   if(mode!=='unlock'&&pin!==String(values.get('confirm')||'')){
    alert.textContent='Os PINs não coincidem.';return;
   }
   processing=true;submit.disabled=true;alert.textContent='';
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
     alert.textContent='Não foi possível desbloquear. Verifique a ligação e tente novamente.';
    }
   }finally{processing=false;if(submit.isConnected)submit.disabled=false;}
  },{signal});
  win.setTimeout(()=>{
   if(destroyed||!form.isConnected)return;
   if(mode==='unlock'){
    // Recheck after the overlay mounts in case Android deferred the old focus.
    dismissUnlockSoftKeyboard({doc,win});
    submit.focus({preventScroll:true});
   }else form.querySelector('input:not([type="hidden"])')?.focus({preventScroll:true});
  },0);
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
  lastRemembered=0;
  resetIdle();
 };
 // Only the unlock PIN input is handled. Creation, recovery and normal pages
 // remain native keyboard forms; this single listener is aborted on cleanup.
 const onPinKeyboard=e=>{
  const entry=overlay?.querySelector('#pronto-pin-entry');
  if(!entry||destroyed||processing||e.defaultPrevented)return;
  const key=pinKeyboardKey(e);
  if(!key)return;
  if(key==='Enter'){
   // Native Enter on an input or focused button must keep its usual action.
   if(e.target===entry||e.target?.closest?.('button,a,input,select,textarea,[role="button"]'))return;
   e.preventDefault();
   overlay.querySelector('#pronto-pin-form')?.requestSubmit();
   return;
  }
  if(e.target!==entry&&e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  // Avoid entering a digit twice when the real password input has focus.
  if(e.target===entry&&key!=='Delete'&&key!=='Escape')return;
  e.preventDefault();
  entry.value=editUnlockPin(entry.value,key);
  entry.dispatchEvent(new Event('input',{bubbles:true}));
 };
 doc.addEventListener('keydown',onPinKeyboard,{signal,capture:true});
 // Close/background: always require PIN next time; a genuine refresh is different.
 // beforeunload happens on reload AND tab close. Only a browser-confirmed
 // navigation.type=reload on the next load may use the recent per-tab unlock.
 win.addEventListener('beforeunload',()=>{unloading=true;},{signal});
 win.addEventListener('pageshow',()=>{unloading=false;},{signal});
 doc.addEventListener('visibilitychange',()=>{
  if(doc.hidden&&opened&&!locking&&!unloading)show('unlock');
 },{signal});
 win.addEventListener('pagehide',()=>{
  if(opened&&!locking&&!unloading)show('unlock');
 },{signal});
 // Track actual editing/autofill as interaction, without relaxing background locking.
 for(const type of ['pointerdown','keydown','touchstart','wheel','input','change','submit','focusin']){
  doc.addEventListener(type,resetIdle,{signal,passive:true});
 }
 try{
  const status=await client.sessionPin('status');
  if(destroyed)return {cleanup,lock:()=>{}};
  pinWasConfigured=status.configured===true;
  if(account.requiresPasswordChange===true){forget();show('password');}
  else if(status.configured){
   let navigationType='';
   try{navigationType=win.performance?.getEntriesByType('navigation')?.[0]?.type||'';}catch{/* browser */}
   const resumable=allowReloadResume&&
    canResumePinContinuity({storage:tabs,userId:account.userId,navigationType,idleMs});
   if(resumable){
    try{
     client.unlockReloadedScreen();
     await open();opened=true;close();
    }catch(error){forget();show('unlock');}
   }else{forget();show('unlock');}
  }else{forget();show('create');}
 }catch(error){
  cleanup();throw error;
 }
 return {cleanup,lock:()=>{if(opened&&!locking)show('unlock');}};
}

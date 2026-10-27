// Consistent, accessible non-blocking feedback for Pronto POS actions.
// This intentionally complements existing confirmation and sale receipt dialogs.
// Never insert server/user-supplied text as HTML.
let current=null;
let dismissTimer=null;
const symbol={loading:'⟳',success:'✓',error:'!',info:'i'};
export function clearProntoFeedback(){
 if(dismissTimer!==null){clearTimeout(dismissTimer);dismissTimer=null;}
 if(current){current.remove();current=null;}
}
// Remove temporary progress banners after an operation completes, but preserve results.
export function clearProntoLoadingFeedback(){
 if(current?.className==='pronto-feedback pronto-feedback-loading')clearProntoFeedback();
}
export function showProntoFeedback(message,{kind='info',duration}={}){
 if(typeof document==='undefined'||!document.body)return;
 clearProntoFeedback();
 const allowed=['loading','success','error','info'];
 const state=allowed.includes(kind)?kind:'info';
 const text=String(message||'').trim();
 if(!text)return;
 const wrap=document.createElement('div');
 wrap.className='pronto-feedback pronto-feedback-'+state;
 wrap.setAttribute('role',state==='error'?'alert':'status');
 wrap.setAttribute('aria-live',state==='error'?'assertive':'polite');
 wrap.setAttribute('aria-atomic','true');
 const emblem=document.createElement('span');
 emblem.className='pronto-feedback-icon';
 emblem.textContent=symbol[state];
 emblem.setAttribute('aria-hidden','true');
 const content=document.createElement('span');
 content.className='pronto-feedback-text';
 content.textContent=text;
 wrap.append(emblem,content);
 if(state!=='loading'){
  const close=document.createElement('button');
  close.type='button';
  close.className='pronto-feedback-dismiss';
  close.textContent='×';
  close.setAttribute('aria-label','Fechar notificação');
  close.addEventListener('click',()=>{if(current===wrap)clearProntoFeedback();});
  wrap.append(close);
 }
 document.body.append(wrap);
 current=wrap;
 if(state!=='loading'){
  const wait=Number.isFinite(duration)?Math.max(2000,Math.min(15000,duration)):state==='error'?7500:4500;
  dismissTimer=setTimeout(()=>{if(current===wrap)clearProntoFeedback();},wait);
 }
 return wrap;
}
// Explicitly detect ongoing progress; never treat a completed operation as loading
// merely because the submit handler still holds its busy lock.
export function prontoFeedbackKind(message,warning=false){
 if(warning)return 'error';
 const text=String(message||'').trim();
 if(!text)return 'loading';
 if(/^(A (guardar|enviar|actualizar|confirmar|preparar|importar|carregar|processar|sincronizar|consultar|recolher|registar|registrar|receber|verificar|buscar|reconciliar|executar|validar)|Aguarde|A efectuar)\b/i.test(text))return 'loading';
 if(/\b(guardad[oa]s?|criad[oa]s?|registad[oa]s?|confirmad[oa]s?|conclu[ií]d[oa]s?|recebid[oa]s?|actualizad[oa]s?|activad[oa]s?|encerrad[oa]s?|eliminad[oa]s?|efectuad[oa]s?|reconciliad[oa]s?|abert[oa]s?|expedid[oa]s?|preparad[oa]s?)\b/i.test(text))return 'success';
 return 'info';
}

// Pronto POS — dialogs owned by the application (not browser alert/confirm/prompt).
// Text supplied by the caller is ALWAYS placed with textContent, never as HTML.
let activeDialog=null;
let serial=0;
const captions={info:'Informação',success:'Concluído',confirm:'Confirmar operação',prompt:'Motivo obrigatório'};
const actions={info:'Fechar',success:'OK',confirm:'Confirmar',prompt:'Guardar'};
function element(name,className,text){
 const node=document.createElement(name);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
function makeDialog({kind,title,message,confirmText,cancelText,placeholder,defaultValue,minLength,maxLength,danger}){
 if(typeof document==='undefined'||!document.body)throw Error('pronto_modal_unavailable');
 const dialog=element('dialog','pronto-dialog pronto-dialog-'+kind+(danger?' pronto-dialog-danger':''));
 const id='pronto-modal-'+(++serial);
 const heading=element('h2','pronto-dialog-title',title||captions[kind]);
 heading.id=id+'-title';
 const description=element('p','pronto-dialog-description',message||'');
 description.id=id+'-description';
 dialog.setAttribute('aria-labelledby',heading.id);
 dialog.setAttribute('aria-describedby',description.id);
 dialog.setAttribute('aria-modal','true');
 const header=element('div','pronto-dialog-header');
 const mark=element('span','pronto-dialog-symbol',danger?'!':kind==='success'?'✓':kind==='prompt'?'✎':'?');
 mark.setAttribute('aria-hidden','true');
 const headingGroup=element('div','pronto-dialog-heading');
 headingGroup.append(mark,heading);
 const close=element('button','pronto-dialog-x','×');
 close.type='button';close.setAttribute('aria-label','Fechar janela');
 header.append(headingGroup,close);
 const content=element('div','pronto-dialog-content');
 content.append(description);
 let field=null,error=null;
 if(kind==='prompt'){
  const label=element('label','pronto-dialog-label','Justificação');
  label.htmlFor=id+'-input';
  field=element('textarea','pronto-dialog-input');
  field.id=label.htmlFor;field.placeholder=String(placeholder||'Escreva aqui...');
  field.rows=4;field.minLength=Math.max(0,Number(minLength)||0);
  field.maxLength=Number.isFinite(Number(maxLength))&&Number(maxLength)>0?Number(maxLength):500;
  field.value=String(defaultValue||'');
  error=element('p','pronto-dialog-error');
  error.setAttribute('role','alert');error.hidden=true;
  content.append(label,field,error);
 }
 const footer=element('div','pronto-dialog-footer');
 let cancel=null;
 if(kind==='confirm'||kind==='prompt'){
  cancel=element('button','pronto-dialog-button pronto-dialog-button-cancel',cancelText||'Cancelar');
  cancel.type='button';footer.append(cancel);
 }
 const ok=element('button','pronto-dialog-button '+(danger?'pronto-dialog-button-danger':'pronto-dialog-button-primary'),confirmText||actions[kind]);
 ok.type='button';footer.append(ok);
 dialog.append(header,content,footer);
 return {dialog,close,ok,cancel,field,error};
}
function open({kind='info',title='',message='',confirmText='',cancelText='Cancelar',placeholder='',defaultValue='',minLength=0,maxLength=500,danger=false}={}){
 if(activeDialog){
  // Double clicks must not open competing confirmations or start the same operation.
  return Promise.resolve(kind==='prompt'?null:false);
 }
 const previousFocus=document.activeElement;
 const parts=makeDialog({kind,title,message,confirmText,cancelText,placeholder,defaultValue,minLength,maxLength,danger});
 const {dialog,close,ok,cancel,field,error}=parts;
 document.body.append(dialog);
 activeDialog=dialog;
 return new Promise((resolve,reject)=>{
  let settled=false;
  const done=value=>{
   if(settled)return;
   settled=true;
   dialog.close();
   resolve(value);
  };
  const cleanup=()=>{
   if(!settled){settled=true;resolve(kind==='prompt'?null:false);}
   activeDialog=null;
   dialog.remove();
   if(previousFocus?.isConnected&&typeof previousFocus.focus==='function')previousFocus.focus();
  };
  dialog.addEventListener('close',cleanup,{once:true});
  dialog.addEventListener('cancel',event=>{event.preventDefault();done(kind==='prompt'?null:false);});
  close.addEventListener('click',()=>done(kind==='prompt'?null:false));
  cancel?.addEventListener('click',()=>done(kind==='prompt'?null:false));
  dialog.addEventListener('click',event=>{
   // Clicking the dimmed area dismisses; clicking the panel never dismisses.
   if(event.target!==dialog)return;
   const r=dialog.getBoundingClientRect(),x=event.clientX,y=event.clientY;
   if(x<r.left||x>r.right||y<r.top||y>r.bottom)done(kind==='prompt'?null:false);
  });
  ok.addEventListener('click',()=>{
   if(kind==='prompt'){
    const value=field.value.trim();
    if(value.length<Math.max(0,Number(minLength)||0)||value.length>Math.max(1,Number(maxLength)||500)){
     error.hidden=false;
     error.textContent='Introduza uma justificação com '+(Number(minLength)||0)+' a '+(Number(maxLength)||500)+' caracteres.';
     field.focus();return;
    }
    done(value);return;
   }
   done(true);
  });
  try{
   dialog.showModal();
   (field||ok).focus();
  }catch(e){
   dialog.remove();activeDialog=null;settled=true;reject(e);
  }
 });
}
export function showInfoModal(options={}){return open({...options,kind:'info'});}
export function showSuccessModal(options={}){return open({...options,kind:'success'});}
export function showConfirmModal(options={}){return open({...options,kind:'confirm'});}
export function showPromptModal(options={}){return open({...options,kind:'prompt'});}
export function closeModal(){if(activeDialog?.open)activeDialog.close();}

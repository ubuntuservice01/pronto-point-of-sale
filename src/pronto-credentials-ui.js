// Show a temporary password once; never store it in localStorage or logs.
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function credentialsText(data,site=location.origin){
 if(!data||data.ok!==true||typeof data.temporary_password!=='string'||data.temporary_password.length<16)
  throw Error('credentials_invalid');
 return 'Pronto POS\nAcesso: '+site+'\nEmail: '+data.email+
  (data.recovery?'\nPalavra-passe provisória recuperada: ':'\nPalavra-passe inicial: ')+data.temporary_password+
  '\nReferência: '+data.account_code+
  (data.recovery?'\nAltere a senha provisória no próximo login. O PIN pessoal continua válido.':
   '\nNo primeiro acesso, altere a palavra-passe provisória e depois crie o seu PIN pessoal de 5 dígitos.');
}
export function showProntoCredentials(data,{doc=document,origin=location.origin}={}){
 const clipboardText=credentialsText(data,origin);
 const dialog=doc.createElement('dialog');
 dialog.className='pronto-credentials-dialog';
 dialog.setAttribute('aria-label',data.recovery?'Recuperação de acesso':'Credenciais da nova conta');
 dialog.innerHTML='<h2>'+(data.recovery?'Acesso recuperado':'Conta criada com sucesso')+'</h2>'+
  '<p>Guarde as credenciais antes de fechar. A palavra-passe só aparece uma vez e não será enviada por email.</p>'+
  '<label>Email de acesso<input readonly value="'+esc(data.email)+'"></label>'+
  '<label>'+(data.recovery?'Palavra-passe provisória':'Palavra-passe inicial')+'<input type="text" readonly value="'+esc(data.temporary_password)+'" autocomplete="off"></label>'+
  '<p>Referência: <strong>'+esc(data.account_code)+'</strong></p>'+
  '<p class="form-hint">'+(data.recovery?'Entregue apenas ao utilizador verificado. No próximo login define uma nova palavra-passe e utiliza o seu PIN habitual. Se também perdeu o PIN, recupere-o separadamente.':
   'Partilhe por mensagem privada. O utilizador entra com o email e esta palavra-passe e define uma nova palavra-passe antes de criar o seu PIN pessoal.')+'</p>'+
  '<div class="pronto-credentials-actions"><button type="button" class="primary" data-credential-copy>Copiar credenciais</button>'+
  '<button type="button" class="secondary" data-credential-close>Fechar</button></div>'+
  '<p role="status" data-credential-status></p>';
 doc.body.append(dialog);
 const clear=()=>{dialog.querySelectorAll('input').forEach(x=>x.value='');dialog.remove();};
 dialog.addEventListener('close',clear,{once:true});
 dialog.querySelector('[data-credential-close]').onclick=()=>dialog.close();
 dialog.querySelector('[data-credential-copy]').onclick=async()=>{
  try{await navigator.clipboard.writeText(clipboardText);dialog.querySelector('[data-credential-status]').textContent='Copiado. Envie apenas ao destinatário.';}
  catch{dialog.querySelector('[data-credential-status]').textContent='Não foi possível copiar automaticamente. Copie os campos acima.';}
 };
 dialog.showModal();return dialog;
}

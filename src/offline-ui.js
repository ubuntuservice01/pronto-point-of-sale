import {enableOffline,unlockOffline,offlineUnlocked,offlinePending,offlinePendingItems,hasOfflineVault,eraseOffline,rememberVerifiedSnapshot} from './offline.js';
export function offlineNoticeHTML(lang,remote){
 if(!remote||(!offlinePending()&&navigator.onLine))return '';
 return `<div class="offline-notice" role="status"><strong>⚠ ${lang==='pt'?'Modo offline / sincronização pendente':'Offline / pending sync'}</strong><small>${offlinePending()} ${lang==='pt'?'venda(s) provisória(s), ainda não confirmadas pelo servidor.':'provisional sale(s), not yet confirmed by the server.'}</small><button class="secondary" type="button" data-page="settings">${lang==='pt'?'Verificar':'Review'}</button></div>`;
}
export function offlineSettingsHTML(lang,role,remote){
 if(!remote||!['owner','manager','cashier'].includes(role))return '';
 const pt=lang==='pt',pending=offlinePending();
 return `<section class="panel offline-settings"><h2>🔒 ${pt?'Vendas offline seguras':'Secure offline sales'}</h2><p class="info-note">${pt?'Activação voluntária, com palavra-passe exclusiva para cifrar os dados. Só vendas em dinheiro, caixa já aberto e sessão verificada há menos de 8 horas. As vendas ficam provisórias até à confirmação do servidor.':'Opt-in encrypted data protected by a separate passphrase. Cash sales only, with an open register and a session verified within 8 hours. Sales remain provisional until server confirmation.'}</p>
 <p><strong>${pending}</strong> ${pt?'venda(s) por sincronizar':'pending sales'}</p>
 <div class="offline-buttons"><button type="button" class="secondary" id="offline-access">${pt?'Activar / desbloquear':'Enable / unlock'}</button><button type="button" class="primary" id="offline-sync" ${pending&&navigator.onLine&&offlineUnlocked()?'':'disabled'}>${pt?'Sincronizar vendas':'Synchronize sales'}</button><button class="secondary" type="button" id="offline-erase" ${pending?'disabled':''}>${pt?'Eliminar dados offline':'Delete offline data'}</button></div>
 ${offlinePendingItems().map(i=>`<p class="offline-entry">${i.id.slice(0,8)} — ${i.status==='conflict'?(pt?'Conflito — requer resolução':'Conflict — needs review'):(pt?'Provisória':'Provisional')}</p>`).join('')}
 <p class="form-hint">${pt?'Pagamentos electrónicos, dívidas, devoluções e movimentos de stock continuam a exigir internet. Vendas de outros dispositivos podem gerar conflitos de stock que terão de ser resolvidos.':'Electronic payments, debt, refunds and stock adjustments still need internet. Other devices may cause stock conflicts requiring manual resolution.'}</p></section>`;
}
export function bindOfflineSettings({getState,getTenantId,lang,modal,toast,render,sync}){
 const pt=lang==='pt';
 document.querySelector('#offline-access')?.addEventListener('click',async()=>{
  const exists=await hasOfflineVault();
  const d=modal(`<h2>${pt?'Acesso offline cifrado':'Encrypted offline access'}</h2><p class="info-note">${pt?'Escolha uma palavra-passe exclusiva de 12 ou mais caracteres. Não utilize a palavra-passe de entrada no Pronto POS.':'Choose a separate passphrase of 12+ characters; do not use your Pronto POS password.'}</p><form><label>${pt?'Palavra-passe offline':'Offline passphrase'}<input name="passphrase" type="password" minlength="12" maxlength="200" autocomplete="off" required></label><button class="primary full">${pt?'Confirmar':'Confirm'}</button></form>`);
  d.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const pass=String(new FormData(e.target).get('passphrase')),button=e.target.querySelector('button');button.disabled=true;
   try{
    if(exists)await unlockOffline(pass,getState().auth.id);
    else{if(!navigator.onLine)throw Error('offline_requires_internet');await enableOffline(pass,getState(),getTenantId());}
    if(navigator.onLine)await rememberVerifiedSnapshot(getState(),getTenantId());
    d.close();render();toast(pt?'Acesso offline activado.':'Offline access enabled.');
   }catch{button.disabled=false;toast(pt?'Não foi possível desbloquear. Verifique a palavra-passe e a ligação.':'Unlock failed. Check passphrase and connection.');}
  };
 });
 document.querySelector('#offline-sync')?.addEventListener('click',async e=>{
  e.target.disabled=true;
  try{const result=await sync();render();toast(result.status==='ok'?(pt?'Sincronização concluída.':'Synchronization completed.'):(pt?'Existem operações pendentes que exigem verificação.':'Some pending operations need review.'));}
  catch{e.target.disabled=false;toast(pt?'Erro de ligação ao servidor.':'Server connection failed.');}
 });
 document.querySelector('#offline-erase')?.addEventListener('click',async()=>{
  if(offlinePending())return toast(pt?'Sincronize as vendas antes de apagar.':'Synchronize pending sales first.');
  if(!confirm(pt?'Eliminar os dados offline deste dispositivo?':'Delete offline data on this device?'))return;
  await eraseOffline();render();
 });
}

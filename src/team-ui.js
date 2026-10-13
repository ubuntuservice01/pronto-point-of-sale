const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
export function teamHistoryHTML(state,tenantId,lang,roleLabel){
 const en=lang==='en',events=(state?.memberEvents||[]).filter(e=>e.tenantId===tenantId).slice(0,20);
 if(!events.length)return `<p class="empty">${en?'No team changes recorded yet.':'Ainda não existem alterações à equipa registadas.'}</p>`;
 const labels={created:en?'Account created':'Conta criada',edited:en?'Account edited':'Conta editada',status:en?'Access changed':'Acesso alterado'};
 return events.map(e=>{
  let change='';
  if(e.action==='status')change=e.after?.active?(en?'Access reactivated':'Acesso reactivado'):(en?'Access disabled and sessions revoked':'Acesso desactivado e sessões terminadas');
  else if(e.action==='edited'){
   const names=e.before?.name!==e.after?.name?`${escape(e.before?.name)} → ${escape(e.after?.name)}`:'';
   const roles=e.before?.role!==e.after?.role?`${escape(roleLabel(e.before?.role))} → ${escape(roleLabel(e.after?.role))}`:'';
   change=[names,roles].filter(Boolean).join(' · ');
  }else if(e.action==='created')change=escape(roleLabel(e.after?.role));
  return `<div class="list-row"><div class="grow"><strong>${escape(labels[e.action]||e.action)} · ${escape(e.memberName)}</strong><small>${escape(e.actorName||e.actorId)} · ${escape(new Date(e.createdAt).toLocaleString(en?'en-GB':'pt-MZ'))}</small><small>${change}</small></div></div>`;
 }).join('');
}
export function teamActions({getMembers,submit,reload,render,modal,toast,lang,roles,roleLabel}){
 const en=lang==='en',L=en?{edit:'Edit team member',save:'Save changes',name:'Name',role:'Role',confirm:'Confirm',deactivate:'Deactivate access?',reactivate:'Reactivate access?',revocation:'All existing sessions will be ended immediately. The member must sign in again.',saved:'Changes saved. Existing sessions have been revoked.',failed:'Unable to save. Check the details and try again.',conflict:'The account was changed in another session. Refresh and try again.',same:'No changes to save.',activateMessage:'The person may sign in again with their existing password.',disabledMessage:'Access will be blocked immediately, including on other devices.'}:{edit:'Editar colaborador',save:'Guardar alterações',name:'Nome',role:'Perfil',confirm:'Confirmar',deactivate:'Desactivar acesso?',reactivate:'Reactivar acesso?',revocation:'Todas as sessões existentes serão terminadas imediatamente. O colaborador terá de iniciar sessão novamente.',saved:'Alterações guardadas. As sessões anteriores foram revogadas.',failed:'Não foi possível guardar. Confira os dados e tente novamente.',conflict:'A conta foi alterada noutra sessão. Actualize e tente novamente.',same:'Não existem alterações para guardar.',activateMessage:'O colaborador poderá voltar a entrar com a palavra-passe existente.',disabledMessage:'O acesso será bloqueado de imediato, incluindo noutros dispositivos.'};
 const member=id=>getMembers().find(m=>m.id===id&&m.role!=='owner');
 const fail=async(dialog,button,error)=>{
  button.disabled=false;
  if(error?.message==='revision_conflict'){dialog.close();try{await reload();}catch{}toast(L.conflict);}
  else toast(error?.message==='no_change'?L.same:L.failed);
 };
 return {
  edit(id){
   const m=member(id);if(!m)return;
   const d=modal(`<h2>${L.edit}</h2><p>${escape(m.username||'')}</p><form><label>${L.name}<input name="name" maxlength="100" value="${escape(m.name)}" required autocomplete="off"></label><label>${L.role}<select name="role">${roles.filter(r=>r!=='owner').map(r=>`<option value="${escape(r)}" ${m.role===r?'selected':''}>${escape(roleLabel(r))}</option>`).join('')}</select></label><p class="info-note">${L.revocation}</p><button class="primary full">${L.save}</button></form>`);
   d.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),role=String(f.get('role')||'');
    if(!name||!roles.includes(role)||role==='owner'){toast(L.failed);return;}
    if(name===m.name&&role===m.role){toast(L.same);return;}
    const button=e.target.querySelector('button');button.disabled=true;
    try{await submit('members/edit',{memberId:m.id,expectedRevision:m.revision??0,name,role});d.close();render();toast(L.saved);}
    catch(error){await fail(d,button,error);}
   };
  },
  status(id){
   const m=member(id);if(!m)return;
   const active=!m.active;
   const d=modal(`<h2>${active?L.reactivate:L.deactivate}</h2><p><strong>${escape(m.name)}</strong></p><p>${active?L.activateMessage:L.disabledMessage}</p><p class="info-note">${L.revocation}</p><button type="button" id="confirm-member-status" class="primary full">${L.confirm}</button>`);
   d.querySelector('#confirm-member-status').onclick=async()=>{
    const button=d.querySelector('#confirm-member-status');button.disabled=true;
    try{await submit('members/status',{memberId:m.id,expectedRevision:m.revision??0,active});d.close();render();toast(L.saved);}
    catch(error){await fail(d,button,error);}
   };
  }
 };
}

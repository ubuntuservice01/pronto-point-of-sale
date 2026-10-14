// Keep a useful error visible if an application module fails to load.
(new URLSearchParams(location.search).get('auth-check')==='1'?import('./supabase-auth-check-ui.js').then(mod=>mod.startSupabaseIdentityCheck()):import('./app.js')).catch(error=>{
 console.error('Pronto POS could not start:',error);
 const root=document.querySelector('#app');root.replaceChildren();
 const section=document.createElement('section');section.className='error-screen';
 const title=document.createElement('h1');title.textContent='Pronto POS';
 const text=document.createElement('p');text.textContent='Não foi possível abrir a aplicação. Actualize a prévia e tente novamente.';
 const retry=document.createElement('button');retry.className='primary';retry.textContent='Tentar novamente';retry.onclick=()=>location.reload();
 section.append(title,text,retry);root.append(section);
});

import {startProntoLoading} from './ui/pronto-loading.js';
import {selectProntoEntry} from './entry-mode.js';
// Public hosting opens the real Supabase sign-in, never the fictitious demo.
const entry=selectProntoEntry({
 hostname:location.hostname,search:location.search,
 siteMode:document.querySelector('meta[name="pronto-mode"]')?.content||''
});
const startupLoader=startProntoLoading();
const loading=entry==='supabase'?
 import('./supabase-auth-check-ui.js').then(mod=>mod.startSupabaseIdentityCheck()):
 import('./app.js').then(()=>startupLoader.finish());
loading.catch(error=>{
 startupLoader.cancel();
 console.error('Pronto POS could not start:',error);
 const root=document.querySelector('#app');root.replaceChildren();
 const section=document.createElement('section');section.className='error-screen';
 const title=document.createElement('h1');title.textContent='Pronto POS';
 const text=document.createElement('p');text.textContent='Não foi possível abrir a aplicação. Verifique a ligação e tente novamente.';
 const retry=document.createElement('button');retry.className='primary';retry.textContent='Tentar novamente';retry.onclick=()=>location.reload();
 section.append(title,text,retry);root.append(section);
});

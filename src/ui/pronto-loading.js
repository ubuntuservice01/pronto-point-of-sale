// Pronto POS loading experience. Never reports 100% before the requested operation finishes.
let current=null;
const escaping=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export function startProntoLoading({title='A preparar a sua loja',mode='shop'}={}){
 if(typeof document==='undefined'||!document.body)return {finish:async()=>{},cancel:()=>{},setTitle:()=>{}};
 if(current?.node.isConnected)return current.api;
 const node=document.createElement('div');
 node.className='pronto-load-overlay';node.dataset.mode=mode;
 node.setAttribute('role','status');node.setAttribute('aria-label',title);
 node.innerHTML='<div class="pronto-load-ghost" aria-hidden="true">'+
  '<div class="pronto-load-ghost-menu"><span class="pronto-load-ghost-logo"></span>'+
  Array.from({length:7},()=>'<span class="pronto-load-skeleton pronto-load-ghost-link"></span>').join('')+'</div>'+
  '<div class="pronto-load-ghost-content"><span class="pronto-load-skeleton pronto-load-ghost-heading"></span>'+
  '<div class="pronto-load-ghost-grid">'+Array.from({length:4},()=>'<span class="pronto-load-skeleton pronto-load-ghost-card"></span>').join('')+'</div>'+
  '<span class="pronto-load-skeleton pronto-load-ghost-banner"></span></div></div>'+
  '<div class="pronto-load-panel"><div class="pronto-load-brand">'+
  '<img src="/icon.svg" width="38" height="38" alt=""><strong>Pronto POS</strong></div>'+
  '<h1 class="pronto-load-title">'+escaping(title)+'</h1>'+
  '<p class="pronto-load-subtitle">Menos complicações, mais negócio.</p>'+
  '<div class="pronto-load-illustration" role="img" aria-label="Ilustração animada de uma pessoa a arrumar artigos nas prateleiras da sua loja">'+
  '<svg viewBox="0 0 390 240" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">'+
  '<ellipse cx="197" cy="222" rx="174" ry="12" fill="#d5ebde"/>'+
  '<rect x="32" y="54" width="190" height="164" rx="12" fill="#c4e1cf"/>'+
  '<rect x="44" y="68" width="166" height="11" rx="4" fill="#50977b"/>'+
  '<rect x="44" y="122" width="166" height="11" rx="4" fill="#50977b"/>'+
  '<rect x="44" y="177" width="166" height="11" rx="4" fill="#50977b"/>'+
  '<rect x="52" y="32" width="150" height="24" rx="7" fill="#087f68"/>'+
  '<text x="127" y="48" text-anchor="middle" fill="white" font-size="13" font-weight="700">A MINHA LOJA</text>'+
  '<g class="pronto-load-item"><rect x="58" y="91" width="22" height="27" rx="4" fill="#f8ba54"/><rect x="87" y="92" width="22" height="26" rx="3" fill="#eb735d"/><rect x="116" y="94" width="23" height="24" rx="4" fill="#9bc874"/><rect x="150" y="88" width="21" height="31" rx="5" fill="#f8ba54"/></g>'+
  '<rect x="58" y="147" width="22" height="27" rx="4" fill="#9bc874"/><rect x="87" y="151" width="23" height="23" rx="3" fill="#d7a96a"/><rect x="117" y="151" width="24" height="23" rx="3" fill="#eb735d"/><rect x="150" y="144" width="22" height="30" rx="4" fill="#f4d16e"/>'+
  '<rect x="59" y="191" width="25" height="24" rx="3" fill="#d6b277"/><rect x="90" y="194" width="24" height="21" rx="3" fill="#e47f5f"/><rect x="120" y="193" width="28" height="22" rx="3" fill="#f8be6a"/>'+
  '<g class="pronto-load-person"><path d="M251 216 L255 164 L277 164 L278 217" stroke="#244b40" stroke-width="14" stroke-linecap="round" fill="none"/>'+
  '<path d="M288 216 L294 163 L313 160 L324 216" stroke="#244b40" stroke-width="14" stroke-linecap="round" fill="none"/>'+
  '<path d="M240 117 Q277 98 313 124 L327 170 Q287 196 245 172 Z" fill="#0c886d"/>'+
  '<path d="M257 119 Q276 141 308 119 L303 167 L263 165 Z" fill="#fee5ad" opacity=".4"/>'+
  '<circle cx="280" cy="84" r="29" fill="#975c41"/><path d="M251 79 Q250 39 280 47 Q316 41 312 85 L300 67 Q274 73 257 67 Z" fill="#34302c"/>'+
  '<circle cx="269" cy="85" r="2.5" fill="#2d251f"/><circle cx="290" cy="85" r="2.5" fill="#2d251f"/>'+
  '<path d="M272 99 Q281 107 290 98" fill="none" stroke="#5e3026" stroke-width="2.8" stroke-linecap="round"/>'+
  '<path d="M310 126 Q341 141 333 165" stroke="#975c41" stroke-width="15" stroke-linecap="round" fill="none"/>'+
  '<g class="pronto-load-arm"><path d="M249 128 Q220 134 204 116" stroke="#975c41" stroke-width="15" stroke-linecap="round" fill="none"/>'+
  '<rect x="186" y="98" width="24" height="29" rx="4" fill="#f1aa48"/><path d="M188 105 H207" stroke="#fbe7a9" stroke-width="3"/></g>'+
  '<path d="M240 172 L320 170" stroke="#095742" stroke-width="5"/></g>'+
  '<g class="pronto-load-spark"><path d="M329 72 l4 -10 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4z" fill="#e8ad4d"/></g>'+
  '</svg></div>'+
  '<div class="pronto-load-progress-head"><span>O seu espaço está quase pronto</span>'+
  '<strong class="pronto-load-number">1%</strong></div>'+
  '<div class="pronto-load-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="1" aria-label="Preparação do Pronto POS"><span class="pronto-load-fill"></span></div>'+
  '<p class="pronto-load-foot">Ubuntu Service, Lda.</p></div>';
 document.body.append(node);
 const number=node.querySelector('.pronto-load-number'),bar=node.querySelector('.pronto-load-track');
 const fill=node.querySelector('.pronto-load-fill'),heading=node.querySelector('.pronto-load-title');
 let percent=1,closed=false,resolving=false,resolveFinish;
 const completed=new Promise(resolve=>resolveFinish=resolve);
 const start=Date.now();
 const set=value=>{
  if(closed||!node.isConnected)return;
  percent=Math.max(percent,Math.min(100,Math.floor(value)));
  number.textContent=percent+'%';bar.setAttribute('aria-valuenow',String(percent));fill.style.width=percent+'%';
 };
 const stop=()=>{
  if(closed)return;
  closed=true;clearInterval(ticker);clearTimeout(exitTimer);node.remove();
  if(current?.node===node)current=null;
  resolveFinish();
 };
 const ticker=setInterval(()=>{
  const elapsed=Date.now()-start;
  // Progress remains below 100 while network, authentication or data are pending.
  set(Math.min(93,1+Math.floor(93*(1-Math.exp(-elapsed/4600)))));
 },135);
 let exitTimer=null;
 const api={
  finish:()=>{
   if(!closed&&!resolving){
    resolving=true;clearInterval(ticker);set(100);node.classList.add('pronto-load-done');
    exitTimer=setTimeout(stop,360);
   }
   return completed;
  },
  cancel:()=>{stop();},
  setTitle:next=>{if(!closed){heading.textContent=String(next);node.setAttribute('aria-label',String(next));}}
 };
 current={node,api};
 return api;
}
export function stopProntoLoading(){current?.api.cancel();}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createPreviewServer} from '../scripts/dev.mjs';

const src=readFileSync(new URL('../src/ui/pronto-modal.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/ui/pronto-modal.css',import.meta.url),'utf8');
const admin=readFileSync(new URL('../src/supabase-admin-dashboard.js',import.meta.url),'utf8');
const shop=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
test('Pronto dialogs never interpolate caller text into innerHTML',()=>{
 assert.doesNotMatch(src,/\.innerHTML\s*=/);
 assert.match(src,/textContent=String\(text\)/);
 assert.match(src,/dialog\.showModal\(\)/);
 assert.match(src,/aria-labelledby/);
 assert.match(src,/addEventListener\('cancel'/);
 assert.match(src,/addEventListener\('close'/);
 assert.match(css,/backdrop-filter:blur/);
 assert.match(css,/pronto-dialog-danger/);
 assert.match(css,/@media\(max-width:600px\)/);
});
test('Administrative and merchant flows no longer call native browser confirm or prompt',()=>{
 for(const [name,source] of [['super admin',admin],['merchant',shop]]){
  assert.doesNotMatch(source,/(?:window\.)?\bconfirm\s*\(/,name);
  assert.doesNotMatch(source,/(?:window\.)?\bprompt\s*\(/,name);
  assert.match(source,/showConfirmModal/);
 }
 assert.match(admin,/showPromptModal/);
 assert.match(admin,/typed!==safety/);
 assert.match(admin,/minLength:10/);
});
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser']
 .find(cmd=>spawnSync('which',[cmd],{stdio:'ignore'}).status===0);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
 const s=createServer();await new Promise((ok,bad)=>s.once('error',bad).listen(0,'127.0.0.1',ok));
 const p=s.address().port;await new Promise(ok=>s.close(ok));return p;
}
async function connect(url){
 const ws=new WebSocket(url);
 await new Promise((ok,bad)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',bad,{once:true});});
 let next=0;const calls=new Map();
 ws.addEventListener('message',evt=>{
  const data=JSON.parse(evt.data);
  if(!data.id)return;
  const p=calls.get(data.id);
  if(p){calls.delete(data.id);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result);}
 });
 return {
  send(method,params={}){return new Promise((resolve,reject)=>{
   const id=++next;calls.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });},close(){ws.close();}
 };
}
test('Chrome PWA UI: close, cancel, confirm and justified prompts work without browser dialogs',
 {skip:!chrome,timeout:55000},async()=>{
 const server=createPreviewServer(process.cwd());
 const profile=await mkdtemp(join(tmpdir(),'pronto-modal-'));
 let proc,client,ready=false;
 try{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));ready=true;
  const url='http://127.0.0.1:'+server.address().port+'/';
  const debugPort=await freePort();
  proc=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--user-data-dir='+profile,'--remote-debugging-port='+debugPort,'--window-size=1280,900',url],{stdio:'ignore'});
  let endpoint;
  for(let i=0;i<95;i++){
   if(proc.exitCode!==null)throw Error('Chrome failed');
   try{
    const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
    endpoint=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    if(endpoint)break;
   }catch{}await sleep(160);
  }
  assert.ok(endpoint,'Chrome DevTools endpoint unavailable');
  client=await connect(endpoint);
  await client.send('Runtime.enable');
  const run=async expression=>{
   const d=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
   if(d.exceptionDetails)throw Error(JSON.stringify(d.exceptionDetails));
   return d.result.value;
  };
  // CI Chrome sometimes opens DevTools on about:blank before reaching the URL.
  await client.send('Page.navigate',{url});
  let onSite=false;
  for(let i=0;i<70;i++){
   try{
    onSite=await run('location.origin==='+JSON.stringify(new URL(url).origin)+' && document.readyState==="complete"');
    if(onSite)break;
   }catch{/* A navigation may replace the execution context. */}
   await sleep(100);
  }
  assert.equal(onSite,true,'Chrome never navigated to the preview origin');
  const result=await run(`(async()=>{
   const mod=await import('/src/ui/pronto-modal.js');
   const values=[];
   const open=()=>document.querySelector('dialog.pronto-dialog');
   let request=mod.showConfirmModal({title:'Cancelar licença',message:'Cancelar a licença da Peixaria?',danger:true});
   values.push(open()?.open===true);
   values.push(getComputedStyle(open()).position==='fixed');
   values.push(!!open().querySelector('.pronto-dialog-x'));
   open().querySelector('.pronto-dialog-x').click();
   values.push(await request===false);
   request=mod.showConfirmModal({title:'Atenção',message:'Continuar?'});
   open().querySelector('.pronto-dialog-button-cancel').click();
   values.push(await request===false);
   request=mod.showConfirmModal({message:'Executar?'});
   open().querySelector('.pronto-dialog-button-primary').click();
   values.push(await request===true);
   request=mod.showPromptModal({title:'Motivo',message:'Indique o motivo',minLength:10,danger:true});
   const input=open().querySelector('textarea');
   input.value='curto';open().querySelector('.pronto-dialog-button-danger').click();
   values.push(open()?.open===true && !!open().querySelector('.pronto-dialog-error').textContent);
   input.value='Solicitação do proprietário';
   open().querySelector('.pronto-dialog-button-danger').click();
   values.push(await request==='Solicitação do proprietário');
   request=mod.showConfirmModal({message:'<script>não executar</script>'});
   values.push(!open().querySelector('script'));
   open().querySelector('.pronto-dialog-button-cancel').click();
   values.push(await request===false);
   values.push(!open());
   return values;
  })()`);
  assert.deepEqual(result,Array(11).fill(true));
 }finally{
  client?.close();proc?.kill('SIGKILL');
  if(ready)await new Promise(ok=>server.close(ok));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150});
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createPreviewServer} from '../scripts/dev.mjs';

const binary=['google-chrome','google-chrome-stable','chromium','chromium-browser']
 .find(name=>spawnSync('which',[name],{stdio:'ignore'}).status===0);
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
async function port(){
 const s=createServer();await new Promise((ok,bad)=>s.once('error',bad).listen(0,'127.0.0.1',ok));
 const p=s.address().port;await new Promise(ok=>s.close(ok));return p;
}
async function cdp(url){
 const ws=new WebSocket(url);await new Promise((ok,bad)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',bad,{once:true});});
 const pending=new Map();let n=0;
 ws.addEventListener('message',e=>{const x=JSON.parse(e.data),p=pending.get(x.id);if(!p)return;pending.delete(x.id);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);});
 return {send:(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}),close:()=>ws.close()};
}
test('Chrome merchant pilot: stable search and 20 MT cash + 50 MT e-Mola sale', {skip:!binary,timeout:45000},async()=>{
 const srv=createPreviewServer(process.cwd());const profile=await mkdtemp(join(tmpdir(),'shop-pilot-'));
 let browser,debug,opened=false;
 try{
  await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));opened=true;
  const url='http://127.0.0.1:'+srv.address().port+'/tests/fixtures/supabase-merchant.html',debugPort=await port();
  browser=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--remote-debugging-port='+debugPort,'--window-size=1440,1000',url],{stdio:'ignore'});
  let endpoint;
  for(let i=0;i<95;i++){
   if(browser.exitCode!==null)throw Error('Chrome exited');
   try{
    const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
    endpoint=pages.find(p=>p.type==='page'&&p.url.includes('/tests/fixtures/supabase-merchant.html'))?.webSocketDebuggerUrl;
    if(endpoint)break;
   }catch{}await wait(180);
  }
  assert.ok(endpoint,'No Chrome DevTools endpoint');
  debug=await cdp(endpoint);
  await debug.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await debug.send('Runtime.enable');
  async function js(expression){
   for(let attempt=0;attempt<12;attempt++){
    try{
     const response=await debug.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
     if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));
     return response.result.value;
    }catch(error){
     if(attempt===11||!/Execution context was destroyed|Cannot find context/i.test(String(error)))throw error;
     await wait(140);
    }
   }
  }
  // Chrome may announce its DevTools page while the initial navigation is
  // still replacing the execution context. Wait before injecting test code.
  let loaded=false;
  for(let i=0;i<80;i++){
   try{loaded=await js('document.readyState==="complete" && !!document.getElementById("app")');}
   catch(error){if(!/Execution context was destroyed/i.test(String(error)))throw error;}
   if(loaded)break;
   await wait(100);
  }
  assert.equal(loaded,true,'Chrome app did not finish initial navigation');
  const init=[
   '(async()=>{',
   'const u="11111111-1111-4111-8111-111111111111";',
   'const b="22222222-2222-4222-8222-222222222222";',
   'const p="33333333-3333-4333-8333-333333333333";',
   'const s="44444444-4444-4444-8444-444444444444";',
   'window.__merchantTest={calls:[],stock:5,staffAllowed:true};',
   'for(let i=0;i<100&&!document.getElementById("app");i++)await new Promise(r=>setTimeout(r,80));',
   'const root=document.getElementById("app");if(!root)throw Error("app container missing");root.replaceChildren();',
   'const client={',
   'async myAccessStatus(){return {allowed:window.__merchantTest.staffAllowed,reason:window.__merchantTest.staffAllowed?"open":"blocked"};},',
   'async merchantBranches(){return [{id:b,name:"Principal"}];},',
   'async merchantSnapshot(){return {role:"cashier",products:[{id:p,name:"Arroz",code:"PR-000001",unit:"kg",category:"Alimentação",priceCents:7000,stock:window.__merchantTest.stock,minStock:1}],branches:[{id:b,name:"Principal"}],sessions:[{id:s,operatorId:u,openingCash:20000,openedAt:new Date().toISOString()}],sales:[]};},',
   'async merchantAction(action,payload){window.__merchantTest.calls.push({action,payload});if(action==="sale_complete"){window.__merchantTest.stock-=1;return {sale_id:u,duplicate:false,total_cents:7000};}throw Error("unexpected");},',
   'async signOut(){}};',
   'const mod=await import("/src/supabase-shop-dashboard.js");',
   'await mod.mountSupabaseMerchantPilot({root,client,account:{userId:u,email:"caixa@example.org",ubuntuAdmin:false,grants:[{id:u,name:"Loja",role:"cashier"}]},onLogout:()=>{}});',
   'return {search:!!document.querySelector("#shop-search"),buttons:document.querySelectorAll("[data-shop-method]").length};',
   '})()'
  ].join('');
  const start=await js(init);assert.deepEqual(start,{search:true,buttons:5});
  const walletColors=await js([
   '(()=>{const mpesa=document.querySelector("[data-shop-method=mpesa]");',
   'const emola=document.querySelector("[data-shop-method=emola]");',
   'mpesa.click();const mpesaColor=getComputedStyle(mpesa).backgroundColor;',
   'emola.click();const emolaColor=getComputedStyle(emola).backgroundColor;',
   'const emolaText=getComputedStyle(emola).color;',
   'return {mpesaColor,emolaColor,emolaText};})()'
  ].join(''));
  assert.deepEqual(walletColors,{
   mpesaColor:'rgb(230, 0, 0)',emolaColor:'rgb(245, 130, 32)',emolaText:'rgb(32, 43, 53)'
  });
  const switched=await js([
   '(()=>{const search=document.querySelector("#shop-search");',
   'for(const m of ["emola","cash","mixed","mpesa","mixed"])document.querySelector("[data-shop-method="+m+"]").click();',
   'return {same:search===document.querySelector("#shop-search"),mixed:!!document.querySelector("[name=pay_emola]"),active:document.querySelector("[data-shop-method=mixed]").getAttribute("aria-pressed")};',
   '})()'
  ].join(''));
  assert.deepEqual(switched,{same:true,mixed:true,active:'true'});
  await js('document.querySelector("[data-shop-add]").click()');
  const sale=await js([
   '(async()=>{document.querySelector("[data-shop-method=mixed]").click();',
   'const f=document.getElementById("shop-sale-form");',
   'f.querySelector("[name=pay_cash]").value="20";',
   'f.querySelector("[name=pay_emola]").value="50";',
   'f.querySelector("[name=cash_received]").value="20";',
   'f.querySelector("[name=confirmed]").checked=true;f.requestSubmit();',
   'for(let i=0;i<70;i++){if(document.querySelector("#shop-message")?.textContent.includes("Venda concluída"))break;await new Promise(r=>setTimeout(r,30));}',
   'return {calls:window.__merchantTest.calls,feedback:document.querySelector("#shop-message")?.textContent,cart:document.querySelectorAll(".shop-cart-row").length};',
   '})()'
  ].join(''));
  assert.equal(sale.calls.length,1);
  assert.equal(sale.calls[0].action,'sale_complete');
  assert.deepEqual(sale.calls[0].payload.allocations.map(a=>[a.method,a.amount_cents]),[['cash',2000],['emola',5000]]);
  assert.equal(sale.calls[0].payload.cash_received_cents,2000);
  assert.equal(sale.cart,0);
  assert.match(sale.feedback,/Venda concluída/);

  const accessLocked=await js([
   '(async()=>{window.__merchantTest.staffAllowed=false;window.dispatchEvent(new Event("focus"));',
   'for(let i=0;i<40&&!document.body.textContent.includes("Acesso ao Pronto POS encerrado");i++)await new Promise(r=>setTimeout(r,20));',
   'return {locked:document.body.textContent.includes("Acesso ao Pronto POS encerrado"),',
   'search:!!document.querySelector("#shop-search")};})()'
  ].join(''));
  assert.deepEqual(accessLocked,{locked:true,search:false});

  // The same real Chrome page now checks PIN enrollment and lock/unlock.
  const pinMounted=await js([
   '(async()=>{const root=document.querySelector("#app");',
   'window.__pinChecks={pin:null,locked:false};',
   'const pinClient={',
   'async sessionPin(action,value){if(action==="status")return {configured:false};',
   'if(action==="create"){window.__pinChecks.pin=value;return {ok:true};}',
   'if(action==="verify"){const ok=value===window.__pinChecks.pin;if(ok)window.__pinChecks.locked=false;return {ok,reason:ok?null:"incorrect_pin",remaining_attempts:4};}',
   'return {ok:false};},',
   'lockScreen(){window.__pinChecks.locked=true;},async signOut(){}};',
   'const module=await import("/src/supabase-pin-lock.js");',
   'window.__gate=await module.mountProntoPinGate({root,client:pinClient,account:{userId:"11111111-1111-4111-8111-111111111111",email:"caixa@example.org"},',
   'open:()=>{root.innerHTML="<div id=protected-work>Venda em memória</div>";},onLogout:()=>{},idleMs:60000});',
   'return {title:document.querySelector("#pronto-pin-title")?.textContent,inert:root.inert};})()'
  ].join(''));
  assert.deepEqual(pinMounted,{title:'Criar PIN de 5 dígitos',inert:true});
  const enrolled=await js([
   '(async()=>{const form=document.querySelector("#pronto-pin-form");',
   'form.querySelector("[name=new]").value="48291";form.querySelector("[name=confirm]").value="48291";form.requestSubmit();',
   'for(let i=0;i<80&&!document.querySelector("#protected-work");i++)await new Promise(r=>setTimeout(r,20));',
   'const protectedNode=document.querySelector("#protected-work");window.__protectedNode=protectedNode;',
   'return {opened:!!protectedNode,toolbar:!!document.querySelector("[data-pin-lock]"),locked:window.__pinChecks.locked};})()'
  ].join(''));
  assert.deepEqual(enrolled,{opened:true,toolbar:true,locked:false});
  const locked=await js([
   '(()=>{document.querySelector("[data-pin-lock]").click();',
   'return {inert:document.querySelector("#app").inert,overlay:!!document.querySelector(".pronto-pin-backdrop"),',
   'preserved:document.querySelector("#protected-work")===window.__protectedNode};})()'
  ].join(''));
  assert.deepEqual(locked,{inert:true,overlay:true,preserved:true});
  const unlocked=await js([
   '(async()=>{const form=document.querySelector("#pronto-pin-form");',
   'const field=form.querySelector("[name=pin]");field.value="48291";form.requestSubmit();',
   'for(let i=0;i<80&&document.querySelector(".pronto-pin-backdrop");i++)await new Promise(r=>setTimeout(r,20));',
   'return {inert:document.querySelector("#app").inert,overlay:!!document.querySelector(".pronto-pin-backdrop"),',
   'preserved:document.querySelector("#protected-work")===window.__protectedNode};})()'
  ].join(''));
  assert.deepEqual(unlocked,{inert:false,overlay:false,preserved:true});
  const backgroundLock=await js([
   '(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});',
   'document.dispatchEvent(new Event("visibilitychange"));',
   'const result={locked:!!document.querySelector(".pronto-pin-backdrop"),inert:document.querySelector("#app").inert};',
   'delete document.hidden;return result;})()'
  ].join(''));
  assert.deepEqual(backgroundLock,{locked:true,inert:true});

 }finally{
  if(debug)debug.close();if(browser)browser.kill('SIGKILL');
  if(opened)await new Promise(ok=>srv.close(ok));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150});
 }
});

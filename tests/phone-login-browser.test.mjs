// Real Chrome test of the public sign-in page (login by e-mail OR Mozambican mobile)
// and of self-service signup when the server returns a session immediately.
// EVERY request to Supabase is intercepted through the DevTools Fetch domain and
// answered by a simulated server; DNS for every external host is disabled, so no
// real account, e-mail or database row can be touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createPreviewServer} from '../scripts/dev.mjs';

const binary=[process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser']
 .filter(Boolean).find(name=>spawnSync('which',[name],{stdio:'ignore'}).status===0||name===process.env.CHROME_BIN);
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const SUPABASE='https://xgtpvszwzvkwysrswkek.supabase.co';
const USER='11111111-1111-4111-8111-111111111111';
const SHOP='22222222-2222-4222-8222-222222222222';
async function port(){
 const s=createServer();await new Promise((ok,bad)=>s.once('error',bad).listen(0,'127.0.0.1',ok));
 const p=s.address().port;await new Promise(ok=>s.close(ok));return p;
}
async function cdp(url){
 const ws=new WebSocket(url);await new Promise((ok,bad)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',bad,{once:true});});
 const pending=new Map(),listeners=new Map();let n=0;
 ws.addEventListener('message',e=>{
  const x=JSON.parse(e.data);
  if(x.method){for(const fn of listeners.get(x.method)||[])fn(x.params);return;}
  const p=pending.get(x.id);if(!p)return;pending.delete(x.id);
  x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);
 });
 return {
  send:(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}),
  on:(method,fn)=>listeners.set(method,[...(listeners.get(method)||[]),fn]),
  close:()=>ws.close()
 };
}

// Simulated Supabase. `scenario` changes per flow; `calls` records every request.
function simulatedSupabase(state){
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, accept, prefer, x-client-info','Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS'};
 const reply=(status,body)=>({status,headers:{...cors,'Content-Type':'application/json'},body:body===undefined?'':JSON.stringify(body)});
 const session={access_token:'sim-access-token',refresh_token:'sim-refresh-token',expires_in:3600,token_type:'bearer',user:{id:USER}};
 return ({method,url,body})=>{
  const path=url.slice(SUPABASE.length);
  const payload=body?JSON.parse(body):undefined;
  state.calls.push({method,path,payload});
  if(method==='OPTIONS')return reply(204);
  const s=state.scenario;
  if(path==='/functions/v1/pronto-phone-login'){
   if(payload?.phone==='+258841234567'&&payload?.password==='senha-correcta-123')return reply(200,{access_token:session.access_token,refresh_token:session.refresh_token,expires_in:3600,user:{id:USER}});
   return reply(401,{error:'invalid_credentials'});
  }
  if(path==='/auth/v1/signup')return reply(200,s.signupWithoutSession?{id:USER,email:'nova@loja.test'}:{...session,user:{id:USER,email:'nova@loja.test'}});
  if(path==='/rest/v1/rpc/pronto_self_service_register'){
   if(s.registerError)return reply(s.registerError[0],{code:'P0001',message:s.registerError[1],details:null,hint:null});
   state.shopCreated=true;return reply(200,{business_id:SHOP,expires_at:new Date(Date.now()+10*864e5).toISOString()});
  }
  if(path==='/auth/v1/user')return reply(200,{id:USER,email:s.email,app_metadata:{}});
  if(path==='/rest/v1/rpc/pronto_admin_status')return reply(200,false);
  if(path.startsWith('/rest/v1/pronto_memberships?'))return reply(200,s.hasShop||state.shopCreated?[{business_id:SHOP,role:'owner',active:true}]:[]);
  if(path.startsWith('/rest/v1/pronto_businesses?'))return reply(200,[{id:SHOP,name:'Mercearia da Ana',status:'active'}]);
  if(path==='/rest/v1/rpc/pronto_my_access_status')return reply(200,{allowed:true,reason:'open'});
  if(path==='/rest/v1/rpc/pronto_session_pin')return reply(200,{configured:false});
  if(path==='/auth/v1/logout')return reply(204);
  state.unexpected.push(method+' '+path);
  return reply(404,{message:'not_simulated'});
 };
}

test('Chrome: phone login, wrong password, instant signup and duplicate phone with every Supabase call intercepted',{skip:!binary,timeout:90000},async()=>{
 const srv=createPreviewServer(process.cwd());const profile=await mkdtemp(join(tmpdir(),'phone-login-'));
 let browser,debug;
 const state={calls:[],unexpected:[],leaked:[],scenario:{},shopCreated:false};
 const supabase=simulatedSupabase(state);
 try{
  await new Promise(ok=>srv.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+srv.address().port,debugPort=await port();
  browser=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
   // Belt and braces: even an un-intercepted request could not reach a real host.
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
   '--user-data-dir='+profile,'--remote-debugging-port='+debugPort,'--window-size=1280,1000','about:blank'],{stdio:'ignore'});
  let endpoint;
  for(let i=0;i<100&&!endpoint;i++){
   if(browser.exitCode!==null)throw Error('Chrome exited');
   try{endpoint=(await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json()).find(p=>p.type==='page')?.webSocketDebuggerUrl;}catch{}
   if(!endpoint)await wait(150);
  }
  assert.ok(endpoint,'No Chrome DevTools endpoint');
  debug=await cdp(endpoint);
  debug.on('Fetch.requestPaused',async({requestId,request})=>{
   try{
    if(request.url.startsWith(SUPABASE+'/')){
     const r=supabase({method:request.method,url:request.url,body:request.postData});
     await debug.send('Fetch.fulfillRequest',{requestId,responseCode:r.status,
      responseHeaders:Object.entries(r.headers).map(([name,value])=>({name,value})),
      body:Buffer.from(r.body).toString('base64')});
    }else if(request.url.startsWith(origin+'/')){
     await debug.send('Fetch.continueRequest',{requestId});
    }else{
     state.leaked.push(request.url);
     await debug.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
    }
   }catch{/* page navigated away */}
  });
  await debug.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await debug.send('Runtime.enable');await debug.send('Page.enable');
  // Block the service worker so every request reaches the interceptor.
  await debug.send('Network.enable');await debug.send('Network.setBypassServiceWorker',{bypass:true});
  async function js(expression){
   for(let attempt=0;attempt<15;attempt++){
    try{
     const response=await debug.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
     if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));
     return response.result.value;
    }catch(error){
     if(attempt===14||!/Execution context was destroyed|Cannot find context/i.test(String(error)))throw error;
     await wait(120);
    }
   }
  }
  async function until(expression,label,ms=12000){
   const end=Date.now()+ms;
   while(Date.now()<end){try{if(await js(expression))return;}catch{}await wait(100);}
   throw Error('Timeout: '+label+' | text='+await js('document.body.innerText.slice(0,500)').catch(()=>'?')+' | calls='+JSON.stringify(state.calls.map(c=>c.method+' '+c.path)));
  }
  async function fresh(scenario){
   // Leave the old document first; neither its PIN gate nor asynchronous requests
   // may satisfy the next scenario's DOM checks.
   await debug.send('Page.navigate',{url:'about:blank'});
   await until('location.href==="about:blank"','previous page closed');
   await debug.send('Storage.clearDataForOrigin',{origin,storageTypes:'all'});
   state.scenario=scenario;state.calls.length=0;state.shopCreated=false;
   await debug.send('Page.navigate',{url:origin+'/?mode=supabase'});
   await until('location.pathname==="/" && !!document.querySelector("#pronto-auth-check-form")','fresh login form');
  }
  async function waitForCall(path,label,ms=12000){
   const deadline=Date.now()+ms;
   while(Date.now()<deadline){
    const call=state.calls.find(c=>c.path===path&&c.method==='POST');
    if(call)return call;
    await wait(100);
   }
   throw Error('Timeout: '+label+' | calls='+JSON.stringify(state.calls.map(c=>c.method+' '+c.path)));
  }
  const fill=(selector,values)=>js('(()=>{const f=document.querySelector('+JSON.stringify(selector)+');'+
   'for(const [k,v] of Object.entries('+JSON.stringify(values)+')){const el=f.elements[k];'+
   'if(el.type==="checkbox")el.checked=v;else{el.focus();el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));}}'+
   'f.querySelector("[type=submit]").click();return true;})()');
  const pinScreen='!!document.querySelector("#pronto-pin-form")&&!!document.querySelector("#pronto-pin-title")';

  // 1) Phone + password: only the Edge Function is used, never the e-mail grant.
  await fresh({email:'ana@loja.test',hasShop:true});
  assert.match(await js('document.querySelector("label[for=pronto-login-email]").textContent'),/E-mail ou número de telemóvel/);
  assert.equal(await js('document.querySelector("#pronto-login-email").type'),'text');
  await fill('#pronto-auth-check-form',{email:'84 123 4567',password:'senha-correcta-123'});
  await until(pinScreen,'PIN screen after phone login');
  const phoneCall=state.calls.find(c=>c.path==='/functions/v1/pronto-phone-login'&&c.method==='POST');
  assert.deepEqual(phoneCall.payload,{phone:'+258841234567',password:'senha-correcta-123'});
  assert.ok(!state.calls.some(c=>c.path.startsWith('/auth/v1/token')),'phone login must not call the password grant from the browser');
  for(const p of ['/auth/v1/user','/rest/v1/rpc/pronto_admin_status','/rest/v1/rpc/pronto_session_pin'])
   assert.ok(state.calls.some(c=>c.path===p),'missing '+p);

  // 2) Phone + wrong password: a clear, non-enumerating message, form stays usable.
  await fresh({email:'ana@loja.test',hasShop:true});
  await fill('#pronto-auth-check-form',{email:'+258 84 123 4567',password:'errada-000000'});
  await until('/incorrectos/.test(document.querySelector("#pronto-auth-check-error").textContent)','wrong password message');
  assert.equal(await js('document.querySelector("#pronto-auth-check-form button[type=submit]").disabled'),false);

  // 3) Self-service signup where the server returns a session (confirmation disabled).
  await fresh({email:'nova@loja.test',hasShop:false});
  await js('document.querySelector("#pronto-show-register").click(),true');
  await until('!!document.querySelector("#pronto-self-register")','registration form');
  const signupData={owner_name:'Ana Macuácua',business_name:'Mercearia da Ana',phone:'84 123 4567',whatsapp:'84 123 4567',address:'KaMpfumo, Maputo',
   email:'Nova@Loja.test',password:'senha-forte-12345',confirm:'senha-forte-12345',accept_terms:true};
  await fill('#pronto-self-register',signupData);
  const signup=await waitForCall('/auth/v1/signup','signup request from registration form');
  await waitForCall('/rest/v1/rpc/pronto_self_service_register','shop registration request');
  await until(pinScreen,'PIN screen after signup');
  assert.equal(signup.payload.email,'nova@loja.test');
  assert.equal(signup.payload.data.display_name,'Ana Macuácua');
  const register=state.calls.find(c=>c.path==='/rest/v1/rpc/pronto_self_service_register');
  assert.equal(register.payload.p_data.phone,'84 123 4567');
  assert.equal(register.payload.p_data.accept_terms,true);
  assert.ok(state.calls.indexOf(signup)<state.calls.indexOf(register),'signup must happen before the shop RPC');
  assert.ok(!state.calls.some(c=>c.path.startsWith('/auth/v1/token')),'signup session must be adopted, not re-authenticated');

  // 4) The phone-alias trigger refuses a number that already belongs to another owner.
  await fresh({email:'nova@loja.test',hasShop:false,registerError:[409,'phone_already_registered']});
  await js('document.querySelector("#pronto-show-register").click(),true');
  await until('!!document.querySelector("#pronto-self-register")','registration form (duplicate)');
  await fill('#pronto-self-register',signupData);
  await until('/Este número já está associado/.test(document.querySelector("#pronto-register-error").textContent)','duplicate phone message');

  // 5) Signup without session still reports that e-mail confirmation is active.
  await fresh({email:'nova@loja.test',hasShop:false,signupWithoutSession:true});
  await js('document.querySelector("#pronto-show-register").click(),true');
  await until('!!document.querySelector("#pronto-self-register")','registration form (confirmation)');
  await fill('#pronto-self-register',signupData);
  await until('/Confirme o e-mail recebido/.test(document.querySelector("#pronto-register-error").textContent)','confirmation message');
  assert.ok(!state.calls.some(c=>c.path==='/rest/v1/rpc/pronto_self_service_register'),'no shop RPC without a session');

  assert.deepEqual(state.unexpected,[],'unsimulated Supabase calls');
  assert.deepEqual(state.leaked,[],'requests to external hosts');
 }finally{
  debug?.close();browser?.kill('SIGKILL');
  await new Promise(ok=>srv.close(ok));
  // Chrome may still flush profile files just after SIGKILL; retry transient ENOTEMPTY/EBUSY.
  await rm(profile,{recursive:true,force:true,maxRetries:25,retryDelay:120});
 }
});

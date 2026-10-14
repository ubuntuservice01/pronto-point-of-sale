import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createPreviewServer } from '../scripts/dev.mjs';

const executable = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
 .find(name => spawnSync('which', [name], { stdio: 'ignore' }).status === 0);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function availablePort() {
 const server = createServer();
 await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
 const port = server.address().port;
 await new Promise(resolve => server.close(resolve));
 return port;
}
async function connect(webSocketUrl) {
 const ws = new WebSocket(webSocketUrl);
 await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
 });
 let sequence = 0;
 const pending = new Map();
 ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const reply = pending.get(message.id);
  if (reply) {
   pending.delete(message.id);
   if (message.error) reply.reject(Error(JSON.stringify(message.error)));
   else reply.resolve(message.result);
  }
 });
 return {
  send(method, params = {}) {
   const id = ++sequence;
   return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    ws.send(JSON.stringify({id, method, params}));
   });
  },
  close() { ws.close(); }
 };
}
test('Chrome UI: payment buttons keep product search and checkout mounted', { skip: !executable, timeout: 45000 }, async () => {
 const preview = createPreviewServer(process.cwd());
 const profile = await mkdtemp(join(tmpdir(), 'pronto-browser-'));
 let chrome, cdp, listening = false;
 try {
  await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
  listening = true;
  const pageUrl = 'http://127.0.0.1:' + preview.address().port + '/#sell';
  const debugPort = await availablePort();
  chrome = spawn(executable, [
   '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
   '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
   '--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort,
   '--window-size=1440,1000', pageUrl
  ], { stdio: 'ignore' });
  let endpoint;
  for (let i=0;i<90;i++) {
   if (chrome.exitCode !== null) throw Error('Chrome exited before debug endpoint');
   try {
    const pages = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
    endpoint = pages.find(x => x.type === 'page' && x.url.includes('#sell'))?.webSocketDebuggerUrl;
    if (endpoint) break;
   } catch {}
   await wait(200);
  }
  assert.ok(endpoint, 'Chrome DevTools page not ready');
  cdp = await connect(endpoint);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp.send('Runtime.enable');
  const evalJS = async expression => {
   const result = await cdp.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
   if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
   return result.result.value;
  };
  for (let i=0;i<60;i++) {
   if (await evalJS('!!document.querySelector("[data-quick-payment=cash]")')) break;
   await wait(200);
  }
  const initial = await evalJS('(() => { const search=document.querySelector("#search");const choices=[...document.querySelectorAll("[data-quick-payment]")];window.__posSearch=search;window.__posCheckout=document.querySelector("#sale-cart");return {search:!!search,methods:choices.map(x=>x.dataset.quickPayment),nativeSelect:!!document.querySelector("select#payment")};})()');
  assert.equal(initial.search, true);
  assert.deepEqual(initial.methods, ['cash','mpesa','emola','transfer','mixed','credit']);
  assert.equal(initial.nativeSelect, false);
  async function clickMethod(key) {
   const selector = '[data-quick-payment="' + key + '"]';
   const rect = await evalJS('(() => {const button=document.querySelector(' + JSON.stringify(selector) + ');button.scrollIntoView({block:"center",inline:"nearest"});const r=button.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:hit?.closest("[data-quick-payment]")?.dataset.quickPayment||"none",viewport:window.innerWidth};})()');
   assert.ok(rect && rect.x>0 && rect.y>0);
   assert.equal(rect.hit,key,'pointer blocked by another element (viewport '+rect.viewport+')');
   await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1});
   return evalJS('(() => ({selected:document.querySelector(' + JSON.stringify(selector) + ')?.getAttribute("aria-pressed"),sameSearch:window.__posSearch===document.querySelector("#search"),sameCheckout:window.__posCheckout===document.querySelector("#sale-cart")}))()');
  }
  for (const key of ['emola','mpesa','transfer','mixed','cash','credit','mixed','emola','cash']) {
   const result = await clickMethod(key);
   assert.equal(result.selected,'true',key);
   assert.equal(result.sameSearch,true,'search replaced on '+key);
   assert.equal(result.sameCheckout,true,'checkout replaced on '+key);
  }
  const searched = await evalJS('(() => {const field=document.querySelector("#search");field.value="sab";field.dispatchEvent(new Event("input",{bubbles:true}));return {value:field.value,products:[...document.querySelectorAll("#product-grid .product-card strong")].map(x=>x.textContent)};})()');
  assert.equal(searched.value,'sab');
  assert.ok(searched.products.some(x=>/Sabonete/.test(x)));
  const after = await clickMethod('emola');
  assert.equal(after.sameSearch,true);
  assert.equal(await evalJS('document.querySelector("#search").value'),'sab');

  // Suspend two distinct baskets; the operator selects a specific sale in a real browser.
  assert.equal(await evalJS('document.querySelectorAll("#product-grid [data-product]").length'),1);
  await evalJS('document.querySelector("#product-grid [data-product]").click()');
  await evalJS('document.querySelector("#hold-sale").click()');
  assert.equal(await evalJS('document.querySelector("#resume-sale").textContent.includes("(1)")'),true);
  await evalJS('document.querySelector("#product-grid [data-product=p1]").click()');
  await evalJS('document.querySelector("#hold-sale").click()');
  assert.equal(await evalJS('document.querySelector("#resume-sale").textContent.includes("(2)")'),true);
  await evalJS('document.querySelector("#resume-sale").click()');
  assert.equal(await evalJS('document.querySelector("#modal").open'),true);
  const popup = await evalJS('(() => ({items:document.querySelectorAll(".held-sale-item").length,actions:[...document.querySelectorAll("[data-resume-held]")].map(b=>b.textContent)}))()');
  assert.equal(popup.items,2);
  assert.equal(popup.actions.every(label=>label.includes('Retomar para finalizar')),true);
  // Ordered newest first: resume the earlier Sabonete hold rather than the later Arroz hold.
  await evalJS('document.querySelectorAll("[data-resume-held]")[1].click()');
  assert.equal(await evalJS('document.querySelector("#modal").open'),false);
  assert.equal(await evalJS('document.querySelector(".cart-row strong")?.textContent'),'Sabonete');
  assert.equal(await evalJS('document.querySelector("#resume-sale").textContent.includes("(1)")'),true);
  // When a basket is already open, selecting another preserves it as a new held sale.
  await evalJS('document.querySelector("#resume-sale").click()');
  assert.equal(await evalJS('document.querySelector("[data-resume-held]").textContent.includes("Suspender actual e retomar")'),true);
  await evalJS('document.querySelector("[data-resume-held]").click()');
  assert.equal(await evalJS('document.querySelector(".cart-row strong")?.textContent'),'Arroz');
  assert.equal(await evalJS('document.querySelector("#resume-sale").textContent.includes("(1)")'),true);

 } finally {
  if (cdp) cdp.close();
  if (chrome) chrome.kill('SIGKILL');
  if (listening) await new Promise(resolve => preview.close(resolve));
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});

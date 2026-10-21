import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getPinKPIs,validatePinKPIs,setPinKPIs,readPinKPIs,clearPinKPIs,pinCityBackdrop,updatePinCityBackdrop} from '../src/pin-city-ui.js';
import {PIN_IDLE_MS,PIN_FOOTER_TEXT,pinScreen,pinKeyboardKey,editUnlockPin} from '../src/supabase-pin-lock.js';
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const U='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const report=(start,gross,salesCount)=>({start,totals:{gross,salesCount}});
const actual=()=>getPinKPIs({today:report(day,35000,3),month:report(day.slice(0,8)+'01',246000,17),
 userId:U,businessId:B,branchId:R,shopName:'Peixaria Isa',role:'owner'});

test('PIN scene uses the brand, five digits, city landscape, Mozambique map and requested footer',()=>{
 const markup=pinScreen({mode:'unlock',email:'vendedor@exemplo.co.mz'});
 assert.match(markup,/pin-city-landscape/);
 assert.match(markup,/Moçambique/);
 assert.match(file('src/pin-city.css'),/\.pronto-pin-backdrop\.pin-city-theme/);
 assert.match(markup,/Ecrã bloqueado/);
 assert.match(markup,/Desbloquear/);
 assert.match(markup,/Ubuntu Service, Lda\./);
 assert.doesNotMatch(markup,/Ubuntu Servers/);
 assert.equal(PIN_FOOTER_TEXT,'Plataforma desenvolvida pela Ubuntu Service, Lda. — Criando pontes entre o físico e o digital.');
 assert.match(markup,/Criando pontes entre o físico e o digital/);
 assert.equal((markup.match(/data-pin-key=/g)||[]).length,12);
 assert.equal((markup.match(/<span><\/span>/g)||[]).length,5);
 assert.equal(PIN_IDLE_MS,600000);
 for(const mode of ['create','change','recover'])assert.match(pinScreen({mode}),/pronto-pin-form/);
 assert.doesNotMatch(pinScreen({email:'<img src=x onerror=alert(1)>'}),/<img src=x onerror/);
});

test('Physical keyboard PIN accepts number row and Numpad without duplicate digits',()=>{
 assert.equal(pinKeyboardKey({key:'1',code:'Digit1'}),'1');
 assert.equal(pinKeyboardKey({key:'2',code:'Numpad2'}),'2');
 assert.equal(pinKeyboardKey({key:'Backspace'}),'Backspace');
 assert.equal(pinKeyboardKey({key:'Delete'}),'Delete');
 assert.equal(pinKeyboardKey({key:'Enter'}),'Enter');
 for(const event of [{key:'3',ctrlKey:true},{key:'4',metaKey:true},{key:'5',altKey:true},{key:'6',isComposing:true},{key:'Tab'}])
  assert.equal(pinKeyboardKey(event),null);
 let pin='';
 for(const key of ['1','2','3','4','5','6'])pin=editUnlockPin(pin,key);
 assert.equal(pin,'12345');
 assert.equal(editUnlockPin(pin,'Backspace'),'1234');
 assert.equal(editUnlockPin(pin,'Delete'),'');
 assert.equal(editUnlockPin(pin,'Escape'),'');
 assert.equal(editUnlockPin('12X','3'),'123');
 const lock=file('src/supabase-pin-lock.js');
 assert.match(lock,/doc\.addEventListener\('keydown',onPinKeyboard,\{signal,capture:true\}\)/);
 assert.match(lock,/if\(e\.target===entry&&key!=='Delete'&&key!=='Escape'\)return/);
 assert.match(lock,/if\(!entry\|\|destroyed\|\|processing\|\|e\.defaultPrevented\)return/);
 assert.match(lock,/form id="pronto-pin-form" autocomplete="off" novalidate/);
});

test('Daily and monthly figures are actual branch aggregates, not mocked display values',()=>{
 const k=actual();
 assert.ok(k);
 assert.equal(k.todayCents,35000);
 assert.equal(k.monthCents,246000);
 assert.equal(k.todayCount,3);
 assert.equal(k.monthCount,17);
 assert.equal(k.shopName,'Peixaria Isa');
 assert.equal(k.day,day);
 assert.equal(k.monthStart,day.slice(0,8)+'01');
 assert.equal(validatePinKPIs(k,U),k);
 const html=pinScreen({metrics:k});
 assert.match(html,/350,00 MT/);
 assert.match(html,/2460,00 MT/);
 assert.match(html,/Vendas de hoje/);
 assert.match(html,/Vendas deste mês/);
 assert.match(html,/Transacções hoje/);
 assert.match(html,/Transacções deste mês/);
 assert.match(html,/pin-city-mobile-kpis/);
 assert.match(html,/Vendas hoje/);
 assert.match(html,/Este mês/);
 assert.match(html,/data-pin-kpi="month"/);
 assert.doesNotMatch(html,/▁ ▂ ▃|pin-city-steps/);
});

test('No invented figures: missing permissions/data, other users, prior days or stale results are masked',()=>{
 assert.equal(getPinKPIs({today:report(day,23000,1)}),null);
 assert.equal(getPinKPIs({today:report(day,23000,1),month:report(day.slice(0,8)+'01',30000,2),userId:U,businessId:'bad'}),null);
 const k=actual();
 setPinKPIs(k);
 assert.equal(readPinKPIs(U)?.businessId,B);
 assert.equal(readPinKPIs(R),null);
 assert.equal(validatePinKPIs({...k,day:'2020-01-01'},U),null);
 assert.equal(validatePinKPIs({...k,monthStart:'2020-01-01'},U),null);
 assert.equal(validatePinKPIs({...k,at:Date.now()-16*60*1000},U),null);
 clearPinKPIs(U);
 assert.equal(readPinKPIs(U),null);
 const html=pinScreen();
 assert.match(html,/data-pin-kpi="today">—<\/strong>/);
 assert.match(html,/data-pin-kpi="month">—<\/strong>/);
 assert.doesNotMatch(html,/9999,00|100000,00/);
});

test('Scoped KPIs refresh only while unlocked and are cleared on owner logout, role and branch changes',()=>{
 const dashboard=file('src/supabase-shop-dashboard.js');
 const auth=file('src/supabase-auth-check-ui.js');
 const lock=file('src/supabase-pin-lock.js');
 assert.match(dashboard,/client\.reportsSnapshot\(initialBusiness,initialBranch,today,today\)/);
 assert.match(dashboard,/client\.reportsSnapshot\(initialBusiness,initialBranch,firstDay,today\)/);
 assert.match(dashboard,/client\.isScreenLocked\?\.\(\)/);
 assert.match(dashboard,/account\.userId!==initialUser\|\|grant\.id!==initialBusiness\|\|branchId!==initialBranch/);
 assert.match(dashboard,/clearPinKPIs\(account\.userId\)/);
 assert.match(lock,/readPinKPIs\(account\.userId\)/);
 assert.match(lock,/root\.inert=true/);
 assert.match(lock,/client\.sessionPin/);
 assert.match(auth,/mountProntoPinGate/);
 const screen={querySelector:()=>({textContent:''})};
 updatePinCityBackdrop(screen,actual());
});

test('Background image, isolated styles and PWA assets are wired',()=>{
 const css=file('src/pin-city.css');
 const index=file('index.html');
 const sw=file('public/sw.js');
 assert.match(css,/url\('\/pin-city-bg\.webp'\)/);
 assert.match(css,/backdrop-filter:blur/);
 assert.match(css,/pin-city-landscape/);
 assert.match(css,/pin-city-footer/);
 assert.match(css,/flex-direction:column/);
 assert.match(css,/margin:30px auto 0/);
 assert.doesNotMatch(css,/\.pin-city-footer\{position:absolute/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/@media\(max-width:550px\)/);
 assert.match(css,/pin-city-mobile-kpis/);
 assert.match(index,/href="\/src\/pin-city\.css"/);
 assert.match(sw,/\/src\/pin-city-ui\.js/);
 assert.match(sw,/\/pin-city-bg\.webp/);
});

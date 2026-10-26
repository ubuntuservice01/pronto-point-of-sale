import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const asset=(path)=>new URL('../'+path,import.meta.url);
const html=readFileSync(asset('public/apresentacao/index.html'),'utf8');
const css=readFileSync(asset('public/apresentacao/landing.css'),'utf8');
const app=readFileSync(asset('src/supabase-auth-check-ui.js'),'utf8');
const sw=readFileSync(asset('public/sw.js'),'utf8');
test('Marketing landing has a standalone static route with local assets',()=>{
 for(const p of ['public/icon.svg','public/login-antes-depois.webp','public/patterns/pronto-commerce-pattern.svg'])assert.ok(existsSync(asset(p)),p);
 assert.match(html,/<html lang="pt-MZ">/);
 assert.match(html,/\/apresentacao\/landing.css/);
 assert.match(html,/\/apresentacao\/landing.js/);
 assert.match(html,/\/login-antes-depois.webp/);
 assert.match(css,/\/patterns\/pronto-commerce-pattern.svg/);
});
test('Visitors can reach login, self-service registration and WhatsApp',()=>{
 assert.match(html,/href="\/\?register=1"/);
 assert.match(html,/href="\/\?mode=supabase"/);
 assert.match(html,/wa\.me\/258877893631/);
 assert.match(app,/new URLSearchParams\(location.search\)\.get\('register'\)==='1'/);
 assert.match(app,/pronto-learn-more/);
});
test('Landing conveys the Pronto POS offer without fictional performance metrics',()=>{
 for(const item of ['10 dias grátis','600 MT','1.000 MT','Mercearias','Farmácias','M-Pesa','e-Mola','Ubuntu Service'])assert.ok(html.includes(item),item);
 assert.match(html,/Simulação visual, sem dados de clientes/);
 assert.match(html,/Planos e funcionalidades sujeitos a confirmação comercial/);
 assert.doesNotMatch(html,/milhares de clientes|[0-9]+% de satisfação/i);
});
test('Marketing screen is mobile-friendly and has navigation accessibility',()=>{
 assert.match(html,/class="skip"/);
 assert.match(html,/aria-controls="menu"/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(sw,/\/apresentacao\/index.html/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {merchantState,merchantCounts,merchantOutcome} from '../src/admin-merchant-lifecycle.js';
import {renderAdmin360Businesses,admin360Metrics} from '../src/supabase-admin-360.js';
import {renderUbuntuAdminTab} from '../src/supabase-admin-ui.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const uuid=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const shop=(i,name,status='active')=>({
 id:uuid(i),name,status,phone:'841234567',address:'Niassa',members:[],branches:1,operators:1,
 planName:'Teste gratuito',expiresAt:'2099-01-01T00:00:00Z',licenseCancelled:false,planId:uuid(50)
});
const shops=[shop(1,'Mercearia Central'),shop(2,'Farmácia Bairro','suspended'),shop(3,'Loja Arquivada','suspended'),shop(4,'Mini Mercado Removido','suspended')];
const insights={businesses:[{id:uuid(3),archived_at:'2026-10-01T00:00:00Z'},{id:uuid(4),archived_at:'2026-10-01T00:00:00Z',removed_at:'2026-10-12T00:00:00Z'}],
 branches:[],events:[{business_id:uuid(4),action:'business_remove',reason:'Fecho <comercial>',created_at:'2026-10-20T10:00:00Z'}]};
test('Merchants have four mutually exclusive lifecycle states',()=>{
 assert.deepEqual(shops.map(b=>merchantState(b,insights.businesses)),['active','suspended','archived','removed']);
 assert.deepEqual(merchantCounts(shops,insights.businesses),{all:4,active:1,suspended:1,archived:1,removed:1});
});
test('Merchant actions use reversible removal and explain restoration before activation',()=>{
 assert.match(merchantOutcome('business_remove'),/Não houve eliminação definitiva/);
 assert.match(merchantOutcome('business_restore'),/continua suspenso/);
 const html=renderAdmin360Businesses({businesses:shops},insights);
 assert.match(html,/Retirar \(reversível\)/);
 assert.match(html,/Restaurar comerciante retirado/);
 assert.match(html,/Restaurar comerciante arquivado/);
 assert.match(html,/Últimas intervenções/);
 assert.match(html,/Fecho &lt;comercial&gt;/);
 assert.doesNotMatch(html,/Fecho <comercial>/);
 const removedEntry=html.slice(html.indexOf('Mini Mercado Removido'),html.indexOf('Mini Mercado Removido')+2600);
 assert.doesNotMatch(removedEntry,/data-admin-control="business_edit"/);
 assert.match(removedEntry,/business_restore/);
});
test('Business-state filters show only requested shops and preserve data count',()=>{
 const render=(selected='all')=>renderUbuntuAdminTab('businesses',{businesses:shops,plans:[]},{query:'',insights,businessFilter:selected});
 const active=render('active');
 assert.match(active,/Mercearia Central/);
 assert.doesNotMatch(active,/Mini Mercado Removido/);
 assert.match(active,/A mostrar 1 de 4/);
 const removed=render('removed');
 assert.match(removed,/Mini Mercado Removido/);
 assert.doesNotMatch(removed,/Mercearia Central/);
 assert.match(removed,/aria-pressed="true"/);
 assert.match(removed,/Retirados/);
});
test('Archived/removed businesses are excluded from active licenses and counts',()=>{
 const metrics=admin360Metrics({businesses:shops,plans:[]},insights,new Date('2026-10-26T13:00:00Z'));
 assert.equal(metrics.total,4);
 assert.equal(metrics.active,1);
 assert.equal(metrics.suspended,1);
 assert.equal(metrics.archived,1);
 assert.equal(metrics.removed,1);
 assert.equal(metrics.licenses,1);
});
test('Admin control requires typed action and server confirmation',()=>{
 const ui=read('src/supabase-admin-dashboard.js');
 assert.match(ui,/data-admin-business-filter/);
 assert.match(ui,/merchantState\(business,insights\?\.businesses\)/);
 assert.match(ui,/business_activate'&&\(current==='removed'\|\|current==='archived'\)/);
 assert.match(ui,/if\(typed!==safety\)return/);
 assert.match(ui,/if\(!outcome\|\|typeof outcome!=='object'\)/);
 assert.match(ui,/merchantOutcome\(action,outcome\)/);
 assert.match(ui,/showSuccessModal/);
});
test('Server guard prevents restoring and activating in one update; keeps audit intact',()=>{
 const sql=read('supabase/migrations/20261026210000_admin_restoration_guard.sql');
 assert.match(sql,/old\.archived_at is not null or old\.removed_at is not null/);
 assert.match(sql,/new\.archived_at is not null or new\.removed_at is not null/);
 assert.match(sql,/before update of status,archived_at,removed_at/);
 assert.doesNotMatch(sql,/delete from|truncate /i);
});
test('Filter module is cached for PWA offline operation',()=>{
 const cache=read('public/sw.js');
 assert.match(cache,/src\/admin-merchant-lifecycle\.js/);
});

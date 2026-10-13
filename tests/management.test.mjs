import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPage, peoplePage} from '../src/management-ui.js';

const money = cents => (cents / 100).toFixed(2) + ' MT';
const product = {id:'p-1',tenantId:'shop',name:'Arroz & Cia',category:'Mercearia',code:'123',unit:'kg',price:8550,stock:2,min:5,active:true};
const staff = {id:'m-1',tenantId:'shop',name:'Maria',role:'cashier',active:true};
const owner = {id:'owner',tenantId:'shop',name:'Ana',role:'owner',active:true};

test('catalog displays controls, stock warnings and filter options', () => {
 const html = catalogPage({items:[product],state:{stockMovements:[]},tenantId:'shop',lang:'pt',money,remote:false});
 assert.match(html,/Produtos e stock/);
 assert.match(html,/Stock baixo/);
 assert.match(html,/data-product-edit="p-1"/);
 assert.match(html,/data-stock-adjust="p-1"/);
 assert.match(html,/catalog-status/);
 assert.match(html,/Arroz &amp; Cia/);
});

test('catalog escapes untrusted product text', () => {
 const html = catalogPage({items:[{...product,name:'<script>alert(1)</script>'}],state:{},tenantId:'shop',lang:'pt',money,remote:false});
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
});

test('catalog exposes stock and change history for authenticated stores', () => {
 const html = catalogPage({items:[product],state:{},tenantId:'shop',lang:'pt',money,remote:true});
 assert.match(html,/Histórico de alterações e stock/);
});

test('team listing protects owners and exposes staff management', () => {
 const html = peoplePage({items:[owner,staff],lang:'pt',roleLabel:r=>r,remote:false});
 assert.match(html,/Equipa e acessos/);
 assert.match(html,/data-member-edit="m-1"/);
 assert.doesNotMatch(html,/data-member-edit="owner"/);
 assert.match(html,/team-status/);
});

test('team authentic mode explains restrictions without pretending to update accounts', () => {
 const html = peoplePage({items:[staff],lang:'en',roleLabel:r=>r,remote:true});
 assert.match(html,/requires server support/);
});

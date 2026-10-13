import test from 'node:test';
import assert from 'node:assert/strict';
import {alertPriorityCounts,alertBadgeHTML,alertPriorityBannerHTML} from '../src/alert-priority-ui.js';
test('empty shop does not show a notification badge',()=>{
 const state={products:[],stockBatches:[],sales:[],refunds:[]};
 assert.deepEqual(alertPriorityCounts(state,'shop'),{total:0,critical:0,warning:0,notice:0});
 assert.equal(alertBadgeHTML(state,'shop'),'');
 assert.match(alertPriorityBannerHTML(state,'shop','pt'),/Sem alertas/);
});
test('stock alerts are scoped to the right business and flagged as critical',()=>{
 const state={products:[{id:'a',tenantId:'shop',name:'Arroz',unit:'un',stock:0,min:2,active:true},{id:'b',tenantId:'other',name:'Leite',unit:'un',stock:0,min:1,active:true}],stockBatches:[],sales:[],refunds:[]};
 const shop=alertPriorityCounts(state,'shop');
 assert.equal(shop.total,1);
 assert.equal(shop.critical,1);
 assert.match(alertBadgeHTML(state,'shop','pt'),/>1<\/span>/);
 assert.match(alertPriorityBannerHTML(state,'shop','pt'),/priority-critical/);
 assert.match(alertPriorityBannerHTML(state,'shop','en'),/critical inventory alerts/);
});

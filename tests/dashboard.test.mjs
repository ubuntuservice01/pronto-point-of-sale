import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,createSale} from '../src/model.js';
import {dashboardMetrics,dashboardInsightsHTML} from '../src/dashboard-ui.js';
test('dashboard presents an empty business without inventing profits or sales',()=>{
 const state=seed(), metrics=dashboardMetrics(state,'t1');
 assert.equal(metrics.report.net,0);
 assert.equal(metrics.top.length,0);
 const html=dashboardInsightsHTML(state,'t1',{lang:'pt',money:n=>(n/100).toFixed(2)+' MT',showFinances:true,showDebts:true});
 assert.match(html,/Dívidas por receber/);
 assert.match(html,/5 produtos mais vendidos/);
 assert.match(html,/pode excluir outros custos/);
});
test('cashier dashboard hides business-wide finances',()=>{
 const html=dashboardInsightsHTML(seed(),'t1',{lang:'pt',money:n=>String(n),showFinances:false,showDebts:false});
 assert.doesNotMatch(html,/Margem bruta/);
 assert.doesNotMatch(html,/Dívidas por receber/);
 assert.doesNotMatch(html,/últimos 7 dias/);
});
test('dashboard ignores unrelated tenant sales and renders charts safely',()=>{
 const state=seed();
 const html=dashboardInsightsHTML(state,'t1',{lang:'pt',money:n=>String(n),showFinances:true});
 assert.match(html,/merchant-chart-bars/);
 assert.equal((html.match(/merchant-chart-day/g)||[]).length,7);
 assert.equal(dashboardMetrics(state,'t1').low,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cartTotal,makeSaleRequest,toCents,esc} from '../src/supabase-shop-core.js';
import {checkoutCashPreview} from '../src/supabase-checkout-change.js';
import {normalizeCashControl,cashSessionsCSV} from '../src/supabase-cash-ui.js';
import {normalizeReturnSnapshot,renderReturnView} from '../src/supabase-returns-ui.js';
import {makeCreditSaleRequest,makeDebtPaymentRequest,overdueAlerts} from '../src/supabase-credit-core.js';
import {normalizeReports,reportsCSV} from '../src/supabase-reports-ui.js';
import {normalizeAuditSnapshot,auditCSV} from '../src/supabase-audit-ui.js';
import {confirmedSaleReceipt,receiptMarkup} from '../src/ui/pronto-sale-success.js';
import {makeShopDraft,encryptShopDraft,decryptShopDraft} from '../src/supabase-shop-draft.js';
import {canResumePinContinuity,rememberPinContinuity} from '../src/pronto-pin-continuity.js';
import {admin360Metrics} from '../src/supabase-admin-360.js';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const U='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',
 BR='33333333-3333-4333-8333-333333333333',P='44444444-4444-4444-8444-444444444444',
 S='55555555-5555-4555-8555-555555555555';
const item={id:P,name:'Arroz',unit:'saco',priceCents:85000,stock:8};
const cart=[{productId:P,quantity:1}];
const request=()=>makeSaleRequest({businessId:B,branchId:BR,sessionId:S,cart,products:[item],
 discount:'0',allocations:[{method:'cash',amount:'850'}],cashReceived:'1000',idempotencyKey:U});

test('H02 — caixa: fundo inicial e diferença ficam separados das vendas',()=>{
 const snapshot=normalizeCashControl({policy:{opening_required:true,blind_close:true},
  sessions:[{id:S,operator_id:U,branch_id:BR,status:'closed',opening_cash_cents:200000,
   expected_cash_cents:700000,counted_cash_cents:685000,difference_cents:-15000,
   opened_at:'2026-10-21T07:00:00Z',closed_at:'2026-10-21T18:00:00Z',close_type:'blind'}]});
 assert.equal(snapshot.sessions[0].opening,200000);
 assert.equal(snapshot.sessions[0].difference,-15000);
 assert.match(cashSessionsCSV(snapshot),/150/);
 assert.match(file('supabase/migrations/20261021111500_cash_control_v2.sql'),/administrative_unchecked/);
});
test('H03 — login: sessão persistente, PIN requerido em nova abertura',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 rememberPinContinuity(storage,U,1000);
 assert.equal(canResumePinContinuity({storage,userId:U,navigationType:'reload',now:1100}),true);
 assert.equal(canResumePinContinuity({storage,userId:U,navigationType:'navigate',now:1100}),false);
 assert.match(file('src/supabase-auth-check-ui.js'),/restoreSession\(\)/);
 assert.match(file('src/supabase-pin-lock.js'),/visibilitychange/);
});
test('H04 — multitenant: RLS and strict server scopes',()=>{
 const migration=file('supabase/migrations/20261021111500_cash_control_v2.sql');
 assert.match(migration,/pronto_cash_policies/);
 assert.match(migration,/pronto_private/);
 const core=file('src/supabase-shop-core.js');
 const req=request();
 assert.equal(req.business_id,B);assert.equal(req.branch_id,BR);
 assert.match(core,/business_id:businessId,branch_id:branchId/);
 assert.match(file('tests/sql/pronto_core_rls_rollback.sql'),/rollback/i);
});
test('H05 — perfis: segregação de operador, proprietário e auditoria',()=>{
 const ui=file('src/supabase-shop-ui.js');
 const screen=file('src/supabase-shop-dashboard.js');
 assert.match(ui,/cashier/);
 assert.match(screen,/authorizedView/);
 assert.match(screen,/client\.myAccessStatus/);
 const audit=normalizeAuditSnapshot({page:0,has_more:false,events:[{id:S,event:'team.suspend',actor_name:'Gestor',created_at:'2026-10-21T07:00:00Z'}]});
 assert.equal(audit.events.length,1);
 assert.match(auditCSV(audit),/Gestor/);
});
test('H06 — devolução: limites, reembolso manual, sem nota fiscal simulada',()=>{
 const returns=normalizeReturnSnapshot({sales:[{id:S,total_cents:85000,status:'completed',method:'cash',
  items:[{product_id:P,name:'Arroz',unit:'saco',qty:4,returned_qty:1,unit_price_cents:21250}]}],returns:[]});
 const view=renderReturnView({returns,selectedSaleId:S,session:{id:BR}});
 assert.match(view,/max="3"/);
 assert.match(view,/name="confirmed"/);
 assert.match(view,/nota de crédito fiscal/);
 assert.match(view,/Artigo em condições de voltar ao stock/);
 assert.match(file('src/supabase-shop-dashboard.js'),/client\.returnAction/);
});
test('H07 — stock: rejects oversell, repeated product and expired batch path exists',()=>{
 assert.deepEqual(cartTotal(cart,[item]),{subtotal:85000,total:85000});
 assert.throws(()=>cartTotal([{productId:P,quantity:9}],[item]),/stock_unavailable/);
 assert.throws(()=>cartTotal([{productId:P,quantity:1},{productId:P,quantity:1}],[item]),/product_unavailable/);
 assert.match(file('src/supabase-inventory-ui.js'),/lote|Lote/);
 assert.match(file('tests/sql/pronto_core_rls_rollback.sql'),/pronto_batches/);
});
test('H08 — offline: encrypted cart is a draft, not a completed sale',async()=>{
 const scope={userId:U,businessId:B,branchId:BR};
 const draft=makeShopDraft({scope,cart,method:'cash',discount:'0',pending:request()});
 const encrypted=await encryptShopDraft(draft,scope,'Frase-de-Protecção-Longa-2026');
 assert.doesNotMatch(encrypted,/refresh_token|Arroz|1000/);
 assert.deepEqual(await decryptShopDraft(encrypted,scope,'Frase-de-Protecção-Longa-2026'),draft);
 await assert.rejects(()=>decryptShopDraft(encrypted,{...scope,businessId:S},'Frase-de-Protecção-Longa-2026'),/draft_unlock_failed/);
 const dashboard=file('src/supabase-shop-dashboard.js');
 assert.match(dashboard,/Sem internet: as vendas não podem ser concluídas/);
});
test('H09 — Super Admin: graphs use real payments and no fictional sales',()=>{
 const r=admin360Metrics({businesses:[],plans:[]},{businesses:[],payments:[],payments_total_cents:0,branches:[],events:[]});
 assert.equal(r.total,0);assert.equal(r.collected,0);
 assert.match(file('src/supabase-admin-dashboard.js'),/adminCritical|adminControl/);
 assert.match(file('src/supabase-admin-360.js'),/business_suspend/);
});
test('H10 — dívida: credit limit, due date and payment confirmation',()=>{
 const customer={id:U,creditLimit:100000,creditBlocked:false};
 const args={businessId:B,branchId:BR,sessionId:S,cart,customer,dueOn:'2026-11-01',today:'2026-10-21',
  outstanding:20000,total:85000,idempotencyKey:U};
 assert.throws(()=>makeCreditSaleRequest(args),/debt_limit/);
 assert.throws(()=>makeCreditSaleRequest({...args,total:10000,dueOn:'2026-10-20'}),/debt_due_date/);
 assert.throws(()=>makeDebtPaymentRequest({businessId:B,branchId:BR,sessionId:S,debt:{id:P,balance:20000},
  amount:'300',method:'cash',confirmed:true,idempotencyKey:U}),/debt_amount/);
 assert.equal(overdueAlerts([{state:'vencido'}],'cashier').length,0);
});
test('H11 — PWA: only static GET assets fall back to cache, versioned offline UI',()=>{
 const sw=file('public/sw.js'),manifest=file('public/manifest.webmanifest');
 assert.match(sw,/event\.request\.method!=='GET'/);
 assert.match(sw,/origin!==self\.location\.origin/);
 assert.match(sw,/pathname\.startsWith\('\/api\/'\)/);
 assert.match(manifest,/"display"\s*:\s*"standalone"/);
 assert.match(sw,/shop-sidebar\.css/);
 const merchantUI=file('src/supabase-shop-ui.js');
 assert.doesNotMatch(merchantUI,/Piloto PostgreSQL/);
 assert.match(merchantUI,/Menos complicações, mais negócio/);
});
test('H12 — printing: cash change and escaped non-fiscal receipt',()=>{
 const receipt=confirmedSaleReceipt({request:request(),result:{sale_id:S,total_cents:85000,change_cents:15000},
  products:[item],shop:'Loja <falsa>',branch:'Centro',seller:'Caixa'});
 assert.equal(receipt.change,15000);
 const html=receiptMarkup(receipt);
 assert.match(html,/150,00 MT/);
 assert.doesNotMatch(html,/<falsa>/);
 assert.match(html,/não substitui documento fiscal/);
 assert.match(file('src/ui/pronto-sale-success.css'),/@media print/);
});
test('H13 — relatórios: missing product costs never become fabricated net profit',()=>{
 const report=normalizeReports({
  totals:{sales_count:2,gross_sales_cents:170000,returns_cents:0,net_sales_cents:170000,
   received_cents:170000,expenses_cents:10000,cogs_estimated_cents:0,cogs_missing_lines:2,
   gross_profit_estimated_cents:null,net_profit_estimated_cents:null,total_unpaid_debts_cents:0,cash_sessions_open:0},
  by_method:[],by_seller:[],by_product:[],by_branch:[],expenses_by_category:[],
  start:'2026-10-01',end:'2026-10-21'});
 assert.equal(report.totals.netProfit,null);
 assert.equal(report.totals.unknownCosts,2);
 const csv=reportsCSV(report);
 assert.ok(csv.length>30);
});
test('H14 — backups: never issue a production signoff without an evidenced restore',()=>{
 const release=file('docs/HOMOLOGACAO-02-14.md');
 assert.match(release,/Restauro de backup.*PENDENTE/);
 assert.match(release,/Sem prova de restauro.*não publicar em larga escala/);
 assert.match(release,/Teste de loja real/);
});

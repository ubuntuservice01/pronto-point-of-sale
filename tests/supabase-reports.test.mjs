import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeReports,renderReportsView,reportsCSV} from '../src/supabase-reports-ui.js';
import {createProntoIdentity} from '../src/supabase-identity.js';
import {prontoSupabaseConfig} from '../src/pronto-supabase-config.js';
const B='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333';
const raw={business_id:B,branch_id:R,start:'2026-10-01',end:'2026-10-15',
 totals:{sales_count:3,gross_sales_cents:50000,returns_cents:5000,net_sales_cents:45000,
 received_cents:30000,expenses_cents:3000,cogs_estimated_cents:20000,cogs_missing_lines:0,
 gross_profit_estimated_cents:25000,net_profit_estimated_cents:22000,
 total_unpaid_debts_cents:15000,cash_sessions_open:1},
 by_method:[{method:'mpesa',collected_cents:30000}],
 by_seller:[{user_id:U,name:'Maria <123>',sales_count:3,gross_cents:50000}],
 by_product:[{product_id:U,name:'Arroz',quantity:5,revenue_cents:50000}],
 by_branch:[{branch_id:R,name:'Central',sales_count:3,gross_cents:50000}],
 expenses_by_category:[{category:'Energia',total_cents:3000}]};
test('reports use integer cents and distinguish billed, received and unpaid credit',()=>{
 const data=normalizeReports(raw);
 assert.equal(data.totals.net,45000);
 assert.equal(data.totals.received,30000);
 assert.equal(data.totals.debts,15000);
 assert.equal(data.totals.netProfit,22000);
 assert.throws(()=>normalizeReports({totals:{}}),/reports_invalid/);
});
test('management reports show partial provisional profits and protect staff name HTML',()=>{
 const html=renderReportsView({report:normalizeReports(raw),from:'2026-10-01',to:'2026-10-15',scope:'all',allAllowed:true});
 assert.ok(html.includes('500,00 MT'));
 assert.ok(html.includes('220,00 MT'));
 assert.ok(html.includes('Maria &lt;123&gt;'));
 assert.ok(!html.includes('Maria <123>'));
 assert.ok(html.includes('Todas as filiais'));
 assert.match(html,/NÃO fiscal/);
 const cashier=renderReportsView({report:null,from:'2026-10-01',to:'2026-10-15',allAllowed:false});
 assert.ok(!cashier.includes('Todas as filiais'));
});
test('when lot cost is missing, do not report fabricated profit',()=>{
 const data=normalizeReports({...raw,totals:{...raw.totals,cogs_missing_lines:2,
   gross_profit_estimated_cents:null,net_profit_estimated_cents:null}});
 const html=renderReportsView({report:data,from:'2026-10-01',to:'2026-10-15'});
 assert.ok(html.includes('Indisponível'));
 assert.ok(html.includes('sem custo de compra'));
});
test('reports CSV is UTF-8 and spreadsheet formula safe',()=>{
 const data=normalizeReports({...raw,by_seller:[{...raw.by_seller[0],name:'=WEBSERVICE("https://x")'}]});
 const csv=reportsCSV(data);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.ok(csv.includes("'=WEBSERVICE("));
 assert.ok(csv.includes('Vendas líquidas'));
});
test('reports client uses authenticated date and branch scoped Supabase RPC',async()=>{
 const calls=[],reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return reply({access_token:'jwt',user:{id:U},expires_in:3600});
  if(url.endsWith('/auth/v1/user'))return reply({id:U,email:'finance@example.org'});
  if(url.endsWith('/rpc/pronto_admin_status'))return reply(false);
  if(url.includes('pronto_memberships?'))return reply([{business_id:B,role:'finance',active:true}]);
  if(url.includes('pronto_businesses?'))return reply([{id:B,name:'Loja',status:'active'}]);
  if(url.endsWith('/rpc/pronto_reports_snapshot'))return reply(raw);
  return reply({},404);
 };
 const client=createProntoIdentity({...prontoSupabaseConfig,fetchImpl});
 await client.signIn('finance@example.org','password');
 assert.equal((await client.reportsSnapshot(B,R,'2026-10-01','2026-10-15')).totals.net,45000);
 assert.equal((await client.reportsSnapshot(B,null,'2026-10-01','2026-10-15')).branches.length,1);
 assert.deepEqual(JSON.parse(calls.find(x=>x.url.endsWith('/rpc/pronto_reports_snapshot')).opts.body),
  {p_business:B,p_branch:R,p_start:'2026-10-01',p_end:'2026-10-15'});
 await assert.rejects(()=>client.reportsSnapshot(B,R,'yesterday','tomorrow'),/reports_scope/);
});
test('reports RPC is protected, bounded and read-only SQL',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015205000_pronto_operating_reports.sql',import.meta.url),'utf8');
 for(const re of [/security definer/,/pronto_private.member_role/,/reports_invalid_dates/,/p_end-p_start>366/,/cogs_missing_lines/,/by_seller/,/by_branch/,/received_cents/,/revoke all on function public.pronto_reports_snapshot/])assert.match(sql,re);
 assert.doesNotMatch(sql,/insert into public\.pronto_sales|delete from public\.pronto_sales/i);
});

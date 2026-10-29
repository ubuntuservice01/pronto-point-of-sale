import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildBrandedXLSX} from '../src/supabase-document-xlsx.js';
import {stockConferenceRange,normalizeStockConference,renderStockConferenceView,
 stockConferenceWorkbook,stockConferencePrintData} from '../src/stock-conference-ui.js';
import {renderShopScreen} from '../src/supabase-shop-ui.js';
const sql=readFileSync(new URL('../supabase/migrations/20261029130000_stock_conference_period_reports.sql',import.meta.url),'utf8');
const PRODUCT='33333333-3333-4333-8333-333333333333';
const BUSINESS='11111111-1111-4111-8111-111111111111';
const BRANCH='22222222-2222-4222-8222-222222222222';
const raw={business_id:BUSINESS,branch_id:BRANCH,from:'2026-10-01',to:'2026-10-29',
 generated_at:'2026-10-29T12:00:00Z',total_products:2,rows:[
 {product_id:PRODUCT,name:'Açúcar <script>',code:'SUG1',unit:'un',
  initial:50,received:20,sold:43,other_in:0,other_out:0,final:27,active:true},
 {product_id:'44444444-4444-4444-8444-444444444444',name:'Óleo',code:'OIL',unit:'l',
  initial:8,received:0,sold:0,other_in:2,other_out:3,final:7,active:false}
]};
const data=normalizeStockConference(raw);
test('Periods use complete calendar months in Mozambique, not 30-day approximations',()=>{
 assert.deepEqual(stockConferenceRange('2026-10-29','1'),{from:'2026-10-01',to:'2026-10-29'});
 assert.deepEqual(stockConferenceRange('2026-10-29','3'),{from:'2026-08-01',to:'2026-10-29'});
 assert.deepEqual(stockConferenceRange('2026-10-29','6'),{from:'2026-05-01',to:'2026-10-29'});
 assert.deepEqual(stockConferenceRange('2027-01-03','6'),{from:'2026-08-01',to:'2027-01-03'});
 assert.deepEqual(stockConferenceRange('2026-10-29','custom','2025-12-01','2026-10-15'),{from:'2025-12-01',to:'2026-10-15'});
 assert.throws(()=>stockConferenceRange('2026-10-29','custom','2026-11-01','2026-11-15'));
 assert.throws(()=>stockConferenceRange('2026-10-29','custom','2026-09-31','2026-10-15'));
 assert.throws(()=>stockConferenceRange('2026-10-29','12'));
});
test('Every product is retained, including no-sales and inactive, and balance reconciliation is checked',()=>{
 assert.equal(data.rows.length,2);
 assert.equal(data.rows[1].sold,0);
 assert.equal(data.rows[1].active,false);
 assert.equal(data.rows[0].final,27);
 assert.throws(()=>normalizeStockConference({...raw,rows:[{...raw.rows[0],final:999},raw.rows[1]]}),/balance_mismatch/);
 assert.throws(()=>normalizeStockConference({...raw,total_products:3}));
});
test('Conference preview has download buttons, zero-sales products, and escapes unsafe names',()=>{
 const html=renderStockConferenceView(data,{period:'3',today:'2026-10-29',branchName:'Filial A'});
 assert.match(html,/data-stock-conference-xlsx/);
 assert.match(html,/data-stock-conference-pdf/);
 assert.match(html,/Açúcar &lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/Óleo/);
 assert.match(html,/Contagem física/);
 assert.match(renderStockConferenceView(null,{period:'custom',today:'2026-10-29'}),/name="from"/);
 const normal=renderStockConferenceView(null,{period:'6',today:'2026-10-29'});
 assert.doesNotMatch(normal,/name="from"/);
});
test('Excel is an actual XLSX with difference formula, blank physical counts, and complete product list',()=>{
 const book=stockConferenceWorkbook(data,'Filial A');
 assert.equal(book.sections[0].rows.length,2);
 assert.deepEqual(book.sections[0].rows[0].slice(3,9),[50,20,43,0,0,27]);
 assert.equal(book.sections[0].rows[0][9],'');
 assert.deepEqual(book.sections[0].rows[0][10],{kind:'physical_difference'});
 const bytes=buildBrandedXLSX({...book,branding:null});
 assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
 const zip=new TextDecoder().decode(bytes);
 assert.match(zip,/<f>IF\(J\d+="","",J\d+-I\d+\)<\/f>/);
 assert.match(zip,/Açúcar &lt;script&gt;/);
 assert.match(zip,/Óleo/);
 assert.match(zip,/fullCalcOnLoad="1"/);
});
test('PDF payload has movement sheet and separate fill-by-hand sheet',()=>{
 const doc=stockConferencePrintData(data,'Filial A');
 assert.equal(doc.sections.length,2);
 assert.equal(doc.sections[0].rows.length,2);
 assert.equal(doc.sections[1].rows[0][4],'____________');
 assert.match(doc.scopeNote,/não altera o stock/);
});
test('The stock-check menu is limited to authorised roles and all businesses',()=>{
 const common={account:{userId:BUSINESS,email:'operator@example.test'},branches:[{id:BRANCH,name:'Filial'}],
  branchId:BRANCH,data:{products:[],sales:[],sessions:[]},cart:[],view:'stock_check',method:'cash',
  discount:'0',query:''};
 for(const role of ['owner','manager','stock','finance']){
  const grant={id:BUSINESS,name:'Mercearia',role,businessType:'general'};
  assert.match(renderShopScreen({...common,grant,grants:[grant],stockConference:data,today:'2026-10-29'}),/data-shop-view="stock_check"/);
 }
 const grant={id:BUSINESS,name:'Mercearia',role:'cashier',businessType:'general'};
 assert.doesNotMatch(renderShopScreen({...common,grant,grants:[grant]}),/data-shop-view="stock_check"/);
});
test('RPC enforces tenant, branch, date scope and captures historical movements',()=>{
 for(const fragment of ['v_role is null',"p_branch is null",'p_end>v_today','p_end-p_start>3660',
  'where m.business_id=p_business and m.product_id=p.id','m.created_at>=v_until',
  "m.kind='sale'",'coalesce(a.after_delta,0)','pronto_stock_conference_snapshot',
  'revoke all on function public.pronto_stock_conference_snapshot'])assert.ok(sql.includes(fragment),fragment);
});

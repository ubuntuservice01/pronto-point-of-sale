import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDocumentBranding,serializeDocumentBranding,renderDocumentBrandingSettings,brandedDocumentHTML} from '../src/supabase-document-branding.js';
import {buildBrandedXLSX} from '../src/supabase-document-xlsx.js';
import {reportDocumentData} from '../src/supabase-reports-ui.js';
import {creditStatementHTML} from '../src/supabase-credit-ui.js';

const branding={displayName:'Mercearia Palichi & Filhos',address:'Lichinga, Niassa',phone:'+258 84 000 0000',email:'loja@example.co.mz',primaryColor:'#c42880',secondaryColor:'#17354a',template:'classic',footerNote:'Obrigado pela preferência'};

test('normalizes the three template versions and rejects invalid emails',()=>{
 assert.equal(normalizeDocumentBranding({...branding,template:'bogus'}).template,'modern');
 assert.equal(normalizeDocumentBranding({template:'compact'}).template,'compact');
 assert.equal(serializeDocumentBranding(branding).primary_color,'#c42880');
 assert.throws(()=>serializeDocumentBranding({...branding,email:'not-an-email'}),/document_email_invalid/);
});

test('owner form has every brand field and accessible preview action',()=>{
 const ui=renderDocumentBrandingSettings({branding});
 for(const field of ['display_name','address','phone','email','primary_color','secondary_color','footer_note','document_logo','template'])
  assert.match(ui,new RegExp('name="'+field+'"'));
 assert.match(ui,/data-document-preview/);
 assert.match(ui,/Guardar personalização/);
 assert.match(ui,/Compacto/);
});

test('branded print document escapes customer data and formats empty tables',()=>{
 const html=brandedDocumentHTML({branding,logoUrl:'',title:'Extracto de cliente',meta:[['Cliente','<script>alert(1)</script>']],
  sections:[{title:'Dívidas',columns:['Data','Valor'],rows:[]}],summary:[['Total','2 500,00 MT']]});
 assert.match(html,/Mercearia Palichi &amp; Filhos/);
 assert.match(html,/Lichinga, Niassa/);
 assert.match(html,/document-classic/);
 assert.match(html,/Sem registos neste período/);
 assert.match(html,/Obrigado pela preferência/);
 assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
 assert.match(html,/@page\{size:A4/);
});

test('debt statement inherits owner brand, contact details, and non-fiscal label',()=>{
 const credit={customers:[{id:'customer1',name:'Cliente Teste',phone:'841234567'}],
  debts:[{id:'debt1',customerId:'customer1',dueOn:'2026-10-31',original:5000,balance:3000,state:'open'}],
  payments:[],sales:[]};
 const html=creditStatementHTML(credit,'customer1',{branding,debtId:'debt1'});
 assert.match(html,/Mercearia Palichi &amp; Filhos/);
 assert.match(html,/Cliente Teste/);
 assert.match(html,/Extracto de dívida/);
 assert.match(html,/não constitui factura/i);
});

function zipEntries(bytes){
 const entries=new Map();const decoder=new TextDecoder();let offset=0;
 while(offset+30<bytes.length){
  const view=new DataView(bytes.buffer,bytes.byteOffset+offset);
  if(view.getUint32(0,true)!==0x04034b50)break;
  const size=view.getUint32(18,true),nameLength=view.getUint16(26,true),extra=view.getUint16(28,true);
  const start=offset+30+nameLength+extra;
  const name=decoder.decode(bytes.slice(offset+30,offset+30+nameLength));
  entries.set(name,bytes.slice(start,start+size));
  offset=start+size;
 }
 return entries;
}

test('Excel is valid ZIP/OOXML, with branded styles, numeric amounts, and embedded logo',()=>{
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YcCBbIAAAAASUVORK5CYII=','base64'));
 const file=buildBrandedXLSX({branding,title:'Vendas do mês',period:'01 a 31/10/2026',
  summary:[['Vendas','1 234,50 MT']],
  sections:[{title:'Por vendedor',columns:['Nome','Total'],rows:[['Maria','200,30 MT']]}],logoPng:png});
 assert.equal(new DataView(file.buffer).getUint32(0,true),0x04034b50);
 const entries=zipEntries(file),decode=new TextDecoder();
 for(const part of ['[Content_Types].xml','xl/workbook.xml','xl/styles.xml','xl/worksheets/sheet1.xml','xl/drawings/drawing1.xml','xl/media/image1.png'])
  assert.ok(entries.has(part),part);
 const sheet=decode.decode(entries.get('xl/worksheets/sheet1.xml'));
 const styles=decode.decode(entries.get('xl/styles.xml'));
 assert.match(sheet,/Mercearia Palichi &amp; Filhos/);
 assert.match(sheet,/Vendas do mês/);
 assert.match(sheet,/<v>1234.50<\/v>/);
 assert.match(sheet,/Página &amp;P de &amp;N/);
 assert.ok(styles.indexOf('<numFmts')<styles.indexOf('<fonts'));
 assert.match(styles,/FFC42880/);
});

test('operational report data preserves structured spreadsheet sections',()=>{
 const report={start:'2026-10-01',end:'2026-10-21',generatedAt:'2026-10-21T11:00:00Z',branchId:null,
  totals:{gross:10000,returns:0,net:10000,received:10000,expenses:2000,cost:5000,debts:0,salesCount:4,grossProfit:5000,netProfit:3000},
  methods:[{name:'Dinheiro',amount:10000}],sellers:[],products:[],branches:[],categories:[]};
 const data=reportDocumentData(report);
 assert.equal(data.sections.length,5);
 assert.equal(data.sections[0].rows[0][0],'Dinheiro');
 assert.equal(data.summary.some(([label])=>label==='Lucro líquido estimado'),true);
});

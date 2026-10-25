import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {printSaleReceipt} from '../src/ui/pronto-sale-success.js';
import {thermalPaperWidth,savedThermalPaperWidth,saveThermalPaperWidth,thermalPageHeightMm,thermalPageRule} from '../src/ui/pronto-thermal-paper.js';

test('thermal widths are restricted to 58 or 80 mm and saved per device',()=>{
 const values=new Map();
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 assert.equal(savedThermalPaperWidth(storage),80);
 assert.equal(saveThermalPaperWidth(58,storage),58);
 assert.equal(savedThermalPaperWidth(storage),58);
 assert.equal(thermalPaperWidth(59),80);
 assert.equal(saveThermalPaperWidth('80',storage),80);
 assert.equal(savedThermalPaperWidth(storage),80);
 assert.equal(savedThermalPaperWidth({getItem(){throw Error('private storage');}}),80);
});

test('thermal @page uses two lengths, not the invalid mixed auto/A4 descriptor',()=>{
 assert.equal(thermalPageRule(58,145),'@page{size:58mm 145mm;margin:0}');
 assert.equal(thermalPageRule(80,225),'@page{size:80mm 225mm;margin:0}');
 assert.equal(thermalPageHeightMm(0),60);
 assert.equal(thermalPageHeightMm(378),107);
 assert.doesNotMatch(thermalPageRule(58,90),/\bauto\b|\bA4\b/);
});

test('cashier receipt is prepared for a narrow roll before invoking system printing',()=>{
 let page,printStyle,printed=false,afterPrint;
 const makeClassList=()=>({values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);}});
 const doc={
  getElementById(){return null;},
  createElement(tag){
   const el={tag,classList:makeClassList(),style:{properties:{},setProperty(k,v){this.properties[k]=v;}},
    remove(){this.removed=true;},getBoundingClientRect(){return {height:378};},scrollHeight:372};
   if(tag==='section')page=el;
   if(tag==='style')printStyle=el;
   return el;
  },
  body:{classList:makeClassList(),append(){},},
  head:{append(){}},
 };
 const win={addEventListener(event,fn){if(event==='afterprint')afterPrint=fn;},print(){printed=true;},setTimeout(){}};
 const receipt={id:'12345678',date:'25/10/2026',shop:'Mercearia',branch:'Centro',seller:'Caixa',
  items:[{name:'Arroz',qty:0.3,unit:'kg',unitCents:10000,lineCents:3000}],
  subtotal:3000,discount:0,total:3000,payments:[{name:'Dinheiro',cents:3000}],cashReceived:3000,change:0};
 printSaleReceipt(receipt,{doc,win,paperWidth:58});
 assert.equal(printed,true);
 assert.equal(page.style.properties['--pronto-paper-width'],'58mm');
 assert.equal(page.style.properties['--pronto-content-width'],'54mm');
 assert.equal(printStyle.textContent,'@page{size:58mm 107mm;margin:0}');
 assert.match(page.innerHTML,/Arroz/);
 assert.ok(doc.body.classList.values.has('pronto-printing'));
 afterPrint();
 assert.equal(page.removed,true);
 assert.equal(printStyle.removed,true);
 assert.ok(!doc.body.classList.values.has('pronto-printing'));
});

test('cashier receipt styles isolate the ticket from full-page report printing',()=>{
 const css=readFileSync(new URL('../src/ui/pronto-sale-success.css',import.meta.url),'utf8');
 const reports=readFileSync(new URL('../src/supabase-document-branding.js',import.meta.url),'utf8');
 assert.match(css,/pronto-sale-print-measure/);
 assert.match(css,/width:var\(--pronto-paper-width\)/);
 assert.match(css,/body\.pronto-printing > :not\(#pronto-sale-print\)/);
 assert.match(reports,/@page\{size:A4/); // Management reports still use A4.
});

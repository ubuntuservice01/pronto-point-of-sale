import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOP_SCAN_FORMATS,findScannedShopProduct,shopSupportedFormats,shopScannerHTML,openShopCodeScanner} from '../src/shop-mobile-scanner.js';
const items=[{id:'a',code:'EAN-0042',active:true,stock:2},{id:'b',code:'QR-2026',active:false,stock:2}];
test('Leitor identifica apenas o código exacto de artigos activos',()=>{
 assert.equal(findScannedShopProduct(items,' ean-0042 ')?.id,'a');
 assert.equal(findScannedShopProduct(items,'EAN-004'),null);
 assert.equal(findScannedShopProduct(items,'QR-2026'),null);
 assert.equal(findScannedShopProduct(items,' '),null);
 assert.equal(findScannedShopProduct(null,'EAN-0042'),null);
});
test('Suporta QR, EAN e Code128 quando o navegador disponibiliza esses formatos',()=>{
 assert.ok(SHOP_SCAN_FORMATS.includes('qr_code'));
 assert.ok(SHOP_SCAN_FORMATS.includes('ean_13'));
 assert.deepEqual(shopSupportedFormats(['qr_code','ean_13','unsupported']),['qr_code','ean_13']);
 assert.deepEqual(shopSupportedFormats([]),[]);
 assert.ok(shopSupportedFormats(undefined).includes('code_128'));
});
test('Leitor mantém opção manual e botão para fechar',()=>{
 const html=shopScannerHTML();
 assert.match(html,/data-shop-scan-video/);
 assert.match(html,/data-shop-scan-manual/);
 assert.match(html,/data-shop-scan-close/);
 assert.match(html,/playsinline/);
});

test('Sem BarcodeDetector, a câmara abre e o leitor alternativo detecta e liberta o vídeo',async()=>{
 const previous=globalThis.ZXingBrowser;
 let detected=null,readerStopped=false,trackStopped=false,closed=false,opened=false;
 const track={stop(){trackStopped=true;}};
 const stream={getTracks:()=>[track]};
 const status={textContent:'',dataset:{}};
 const video={hidden:false,srcObject:null,play:async()=>{}};
 const button={addEventListener:()=>{}};
 const controls=new Map([
  ['[data-shop-scan-status]',status],['[data-shop-scan-video]',video],
  ['[data-shop-scan-close]',button],['[data-shop-scan-manual]',button]
 ]);
 const dialog={open:false,setAttribute(){},addEventListener(){},
  querySelector:selector=>controls.get(selector),
  showModal(){this.open=true;opened=true;},
  close(){this.open=false;},remove(){closed=true;}};
 const doc={body:{append(){}},createElement:()=>dialog,addEventListener(){}};
 try{
  globalThis.ZXingBrowser={BrowserMultiFormatReader:class{
   async decodeFromVideoElement(element,callback){
    assert.equal(element,video);detected=callback;
    return {stop(){readerStopped=true;}};
   }
  }};
  openShopCodeScanner({doc,Detector:undefined,
   navigatorRef:{mediaDevices:{getUserMedia:async()=>stream}},onCode:code=>code==='PR-1234'});
  for(let i=0;i<20&&!detected;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(opened,true);
  assert.equal(video.srcObject,stream);
  assert.equal(video.hidden,false);
  assert.ok(detected,'O leitor alternativo foi iniciado');
  assert.match(status.textContent,/Câmara activa/);
  detected({getText:()=> 'PR-1234'});
  assert.equal(closed,true);
  assert.equal(trackStopped,true);
  assert.equal(readerStopped,true);
 }finally{
  if(previous===undefined)delete globalThis.ZXingBrowser;
  else globalThis.ZXingBrowser=previous;
 }
});

test('Modo Caixa can keep the camera open across multiple different barcodes without duplicate re-scans',async()=>{
 const old=globalThis.ZXingBrowser;
 let emit,trackStops=0,closeCount=0;
 const stream={getTracks:()=>[{stop(){trackStops++;}}]};
 const video={srcObject:null,hidden:false,play:async()=>{}};
 const status={textContent:'',dataset:{}};
 const events={addEventListener(){}};
 const controls=new Map([
  ['[data-shop-scan-status]',status],['[data-shop-scan-video]',video],
  ['[data-shop-scan-close]',events],['[data-shop-scan-manual]',events],
  ['[data-shop-scan-done]',events],['[data-shop-scan-repeat]',{hidden:true,addEventListener(){}}],
  ['[data-shop-scan-counter]',{querySelector:()=>({textContent:''})}]
 ]);
 const dialog={open:false,className:'',setAttribute(){},addEventListener(){},
  querySelector:key=>controls.get(key)||null,
  showModal(){this.open=true;},close(){this.open=false;},remove(){closeCount++;}};
 const doc={body:{append(){}},createElement:()=>dialog,addEventListener(){}};
 const found=[];
 try{
  globalThis.ZXingBrowser={BrowserMultiFormatReader:class{
   async decodeFromVideoElement(v,cb){emit=cb;return {stop(){}};}
  }};
  const stop=openShopCodeScanner({doc,navigatorRef:{mediaDevices:{getUserMedia:async()=>stream}},
   Detector:undefined,continuous:true,onCode:code=>{
    found.push(code);return {accepted:true,name:code,quantity:1,itemCount:found.length};
   }});
  for(let i=0;i<30&&!emit;i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(emit,'decoder starts');
  emit({getText:()=> 'A-001'});
  emit({getText:()=> 'A-001'});
  emit({getText:()=> 'B-002'});
  assert.deepEqual(found,['A-001','B-002'],'holding the same barcode does not add again');
  assert.equal(closeCount,0,'camera remains open for the next product');
  assert.match(status.textContent,/adicionado ao carrinho/);
  stop();
  assert.equal(trackStops,1,'closing frees camera');
  assert.equal(closeCount,1);
 }finally{if(old===undefined)delete globalThis.ZXingBrowser;else globalThis.ZXingBrowser=old;}
});
test('Fast scanning exposes camera viewfinder, torch option, manual entry and visible checkout exit',()=>{
 const html=shopScannerHTML({continuous:true});
 for(const attr of ['data-shop-scan-video','data-shop-scan-target','data-shop-scan-torch',
  'data-shop-scan-repeat','data-shop-scan-counter','data-shop-scan-done','data-shop-scan-manual'])
  assert.ok(html.includes(attr)||attr==='data-shop-scan-target'&&html.includes('shop-scan-target'),attr);
 assert.match(html,/Ver carrinho e cobrar/);
});

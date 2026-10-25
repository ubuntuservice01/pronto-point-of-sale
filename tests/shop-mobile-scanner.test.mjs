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

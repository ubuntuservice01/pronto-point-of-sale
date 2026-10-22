// Camera code reader for the authenticated merchant point of sale.
// No sale is recorded here: only an existing product may be added to the cart.
import {landscapeConstraints,allowDetectedBarcode} from './camera-utils.js';

export const SHOP_SCAN_FORMATS=['qr_code','ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'];
export function findScannedShopProduct(products,rawCode){
 const code=String(rawCode??'').trim().toLocaleLowerCase();
 if(!code)return null;
 return (products||[]).find(p=>p&&p.active!==false&&
  String(p.code??'').trim().toLocaleLowerCase()===code)||null;
}
export function shopSupportedFormats(available){
 return Array.isArray(available)?SHOP_SCAN_FORMATS.filter(x=>available.includes(x)):SHOP_SCAN_FORMATS.slice();
}
export function shopScannerHTML(){
 return '<div class="shop-scan-heading"><div><small>PRONTO POS · PONTO DE VENDA</small>'+
 '<h2 id="shop-scan-title">Ler código do produto</h2></div>'+
 '<button type="button" data-shop-scan-close aria-label="Fechar leitor">✕</button></div>'+
 '<p class="shop-scan-help">Aponte a câmara para o código de barras ou QR code do produto.</p>'+
 '<div class="shop-scan-video-wrap"><video data-shop-scan-video autoplay muted playsinline aria-label="Câmara para leitura de códigos"></video>'+
 '<div class="shop-scan-target" aria-hidden="true"></div></div>'+
 '<p class="shop-scan-status" data-shop-scan-status role="status" aria-live="polite">A preparar a câmara…</p>'+
 '<form data-shop-scan-manual autocomplete="off"><label for="shop-scan-manual-code">Ou introduza o código manualmente</label>'+
 '<div class="shop-scan-manual-row"><input id="shop-scan-manual-code" name="code" type="text" autocomplete="off" maxlength="120" placeholder="Código do produto" required>'+
 '<button type="submit">Procurar</button></div></form>';
}
export function openShopCodeScanner({onCode,onClose,doc=globalThis.document,
 navigatorRef=globalThis.navigator,Detector=globalThis.BarcodeDetector}={}){
 if(typeof onCode!=='function'||!doc?.body)throw Error('shop_scanner_invalid');
 const dialog=doc.createElement('dialog');
 dialog.className='shop-scan-dialog';
 dialog.setAttribute('aria-labelledby','shop-scan-title');
 dialog.innerHTML=shopScannerHTML();
 doc.body.append(dialog);
 const status=dialog.querySelector('[data-shop-scan-status]');
 const video=dialog.querySelector('[data-shop-scan-video]');
 let stream=null,frame=null,stopped=false,reading=false,last=null,lastFrame=0;
 const events=new AbortController();
 const announce=(message,error=false)=>{
  if(stopped)return;
  status.textContent=message;status.dataset.state=error?'error':'info';
 };
 const stop=()=>{
  if(stopped)return;
  stopped=true;events.abort();
  if(frame!==null)cancelAnimationFrame(frame);
  stream?.getTracks().forEach(track=>track.stop());
  video.srcObject=null;
  dialog.remove();
  onClose?.();
 };
 const finish=()=>{if(typeof dialog.close==='function'&&dialog.open)dialog.close();stop();};
 dialog.addEventListener('close',stop,{once:true,signal:events.signal});
 dialog.querySelector('[data-shop-scan-close]').addEventListener('click',finish,{signal:events.signal});
 const readCode=value=>{
  if(stopped)return;
  const code=String(value??'').trim();
  if(!code)return announce('Introduza ou enquadre um código válido.',true);
  let result;
  try{result=onCode(code);}
  catch{announce('Não foi possível seleccionar o produto. Tente novamente.',true);return;}
  if(result===true){finish();return;}
  announce(typeof result==='string'?result:'Código não encontrado nesta loja.',true);
 };
 dialog.querySelector('[data-shop-scan-manual]').addEventListener('submit',event=>{
  event.preventDefault();
  readCode(new FormData(event.currentTarget).get('code'));
 },{signal:events.signal});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)finish();},{signal:events.signal});
 if(typeof dialog.showModal==='function')dialog.showModal();
 else dialog.setAttribute('open','');
 const initialise=async()=>{
  if(typeof Detector!=='function'){
   video.hidden=true;
   announce('Leitura automática indisponível neste navegador. Use o código manual ou um leitor externo.',true);
   return;
  }
  if(!navigatorRef?.mediaDevices?.getUserMedia||globalThis.isSecureContext===false){
   video.hidden=true;
   announce('A câmara exige HTTPS e autorização. Introduza o código manualmente.',true);
   return;
  }
  let detector;
  try{
   const supported=typeof Detector.getSupportedFormats==='function'?await Detector.getSupportedFormats():undefined;
   const formats=shopSupportedFormats(supported);
   if(!formats.length)throw Error('unsupported_formats');
   detector=new Detector({formats});
   const acquired=await navigatorRef.mediaDevices.getUserMedia(landscapeConstraints('environment'));
   if(stopped){acquired.getTracks().forEach(track=>track.stop());return;}
   stream=acquired;video.srcObject=stream;
   await video.play();
  }catch(error){
   if(stopped)return;
   video.hidden=true;
   stream?.getTracks().forEach(track=>track.stop());stream=null;
   announce(error?.name==='NotAllowedError'?'Permissão da câmara recusada. Autorize no navegador ou introduza o código.':
    'Não foi possível activar a leitura automática. Introduza o código ou use um leitor externo.',true);
   return;
  }
  announce('Câmara activa. Aponte o código para a área central.');
  const scan=async time=>{
   if(stopped)return;
   frame=requestAnimationFrame(scan);
   if(reading||time-lastFrame<300||video.readyState<2)return;
   reading=true;lastFrame=time;
   try{
    const found=await detector.detect(video);
    if(stopped)return;
    const raw=String(found.find(x=>x?.rawValue)?.rawValue||'').trim();
    if(raw&&allowDetectedBarcode(last,raw,Date.now())){
     last={code:raw,at:Date.now()};
     readCode(raw);
    }
   }catch{announce('Não foi possível ler agora. Reposicione o código ou escreva-o manualmente.',true);}
   finally{reading=false;}
  };
  frame=requestAnimationFrame(scan);
 };
 void initialise();
 return finish;
}

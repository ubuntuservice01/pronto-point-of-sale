// Paper preferences belong to this device, not to the business or cash drawer.
const PAPER_KEY='pronto-pos-receipt-paper-mm';

export function thermalPaperWidth(value){
 return Number(value)===58?58:80;
}

export function savedThermalPaperWidth(storage){
 try{
  const source=storage??globalThis.localStorage;
  return thermalPaperWidth(source?.getItem(PAPER_KEY));
 }catch{return 80;}
}

export function saveThermalPaperWidth(value,storage){
 const width=thermalPaperWidth(value);
 try{(storage??globalThis.localStorage)?.setItem(PAPER_KEY,String(width));}
 catch{/* Printing must still work if the browser disallows local storage. */}
 return width;
}

// CSS @page accepts one or two lengths, but NOT "80mm auto" (which falls back to A4).
// Calculate the receipt height from its rendered content to avoid a blank A4-length tail.
export function thermalPageHeightMm(heightPx){
 const px=Number.isFinite(Number(heightPx))?Math.max(0,Number(heightPx)):0;
 return Math.max(60,Math.ceil(px*25.4/96+6));
}

export function thermalPageRule(width,heightMm){
 const paper=thermalPaperWidth(width);
 const height=Math.max(60,Math.ceil(Number(heightMm)||60));
 return `@page{size:${paper}mm ${height}mm;margin:0}`;
}

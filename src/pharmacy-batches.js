// Mozambique-local pharmacy batch safety and non-overlapping expiry alert bands.
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;
const dayNumber=date=>Number.isFinite(Date.parse(date+'T00:00:00Z'))?
 Math.round(Date.parse(date+'T00:00:00Z')/86400000):NaN;
export const maputoToday=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);
export function validatePharmacyReceipt({lot,expiry,today=maputoToday()}){
 const number=String(lot??'').trim();
 const date=String(expiry??'').trim();
 if(!number||number.length>100)throw Error('Introduza o número do lote do fabricante.');
 if(!VALID_DATE.test(date)||!Number.isInteger(dayNumber(date))||
    new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('Introduza uma data de validade válida.');
 if(date<=today)throw Error('Não pode receber um medicamento vencido ou que vence hoje.');
 return {lot:number,expiry:date};
}
export function pharmacyExpiryBuckets(inventory){
 const result={expired:[],days30:[],days60:[],days90:[],undated:[]};
 if(!inventory||!VALID_DATE.test(inventory.today||''))return result;
 const today=dayNumber(inventory.today);
 for(const batch of inventory.batches||[]){
  if(!(Number(batch.qty)>0))continue;
  const raw=String(batch.expiry||'');
  if(!VALID_DATE.test(raw)){result.undated.push(batch);continue;}
  const days=dayNumber(raw)-today;
  if(!Number.isFinite(days)){result.undated.push(batch);continue;}
  if(days<=0)result.expired.push(batch);
  else if(days<=30)result.days30.push(batch);
  else if(days<=60)result.days60.push(batch);
  else if(days<=90)result.days90.push(batch);
 }
 return result;
}

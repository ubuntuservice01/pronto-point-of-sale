// One optional expiry date per product; batch-level dates are not yet supported.
export function normalizeExpiryDate(value){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||!/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value))throw Error('expiry_date');
 const [y,m,d]=value.split('-').map(Number);
 if(y<1900||y>9999)throw Error('expiry_date');
 const date=new Date(Date.UTC(y,m-1,d));
 if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw Error('expiry_date');
 return value;
}
export function expiryInfo(value,at=new Date()){
 const date=normalizeExpiryDate(value);
 if(!date)return {status:'none',days:null};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(p=>[p.type,Number(p.value)]));
 const [y,m,d]=date.split('-').map(Number);
 const days=Math.round((Date.UTC(y,m-1,d)-Date.UTC(parts.year,parts.month-1,parts.day))/86400000);
 return {status:days<0?'expired':days===0?'today':days<=30?'soon':'valid',days};
}
export function formatExpiryDate(value,lang='pt'){
 const date=normalizeExpiryDate(value);
 if(!date)return '';
 return new Date(date+'T12:00:00Z').toLocaleDateString(lang==='en'?'en-GB':'pt-MZ',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'});
}

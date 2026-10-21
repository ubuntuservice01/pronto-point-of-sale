// Per-tab PIN continuity. Never stores a password, a PIN or a merchant permission.
// Reloading the same tab after recent activity need not prompt again, but opening
// a closed browser/PWA window, backgrounding or manually locking always does.
const PREFIX='pronto.pin.recent.v1';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(v);
const key=userId=>PREFIX+':'+userId;
export function clearPinContinuity(storage,userId){
 if(!storage||!uuid(userId))return;
 try{storage.removeItem(key(userId));}catch{/* Storage can be disabled by browser policy. */}
}
export function rememberPinContinuity(storage,userId,now=Date.now()){
 if(!storage||!uuid(userId))return;
 try{storage.setItem(key(userId),JSON.stringify({v:1,t:now}));}
 catch{/* Session still works without the optimisation. */}
}
export function canResumePinContinuity({storage,userId,navigationType,now=Date.now(),idleMs=600000}){
 if(navigationType!=='reload'||!storage||!uuid(userId))return false;
 let raw;
 try{raw=storage.getItem(key(userId));}catch{return false;}
 if(!raw||raw.length>200)return false;
 try{
  const value=JSON.parse(raw);
  return value?.v===1&&Number.isFinite(value.t)&&value.t<=now
   &&now-value.t<idleMs;
 }catch{return false;}
}

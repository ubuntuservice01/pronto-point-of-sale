// Self-service activation proof. The success screen may only appear after the
// server shows, through the owner's own session, that the shop exists, that
// this account owns it, and that its free trial is a live 10-day trial.
// A successful register RPC response alone is never treated as proof.
export const SELF_SERVICE_TRIAL_DAYS=10;
const DAY=864e5;
const TOLERANCE=60*60*1000; // started_at and expires_at come from the same transaction.
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// expectedBusinessId: the id returned by pronto_self_service_register, or null
// when the RPC answered account_already_registered (an earlier attempt committed
// but its response was lost). In that case the account must own exactly one shop.
export async function confirmSelfServiceActivation(client,{expectedBusinessId=null,now=Date.now()}={}){
 if(expectedBusinessId!==null&&!uuid(expectedBusinessId))throw Error('activation_unconfirmed');
 const account=await client.account();
 const owned=(Array.isArray(account?.grants)?account.grants:[]).filter(g=>g&&g.role==='owner'&&uuid(g.id));
 const grant=expectedBusinessId?owned.find(g=>g.id===expectedBusinessId):(owned.length===1?owned[0]:null);
 if(!grant)throw Error('activation_unconfirmed');
 const trial=await client.myTrialStatus(grant.id);
 if(!trial||typeof trial!=='object'||trial.is_trial!==true||trial.expired!==false)throw Error('trial_unconfirmed');
 const started=Date.parse(trial.started_at),trialEnd=Date.parse(trial.trial_expires_at),licenceEnd=Date.parse(trial.expires_at);
 if(![started,trialEnd,licenceEnd].every(Number.isFinite))throw Error('trial_unconfirmed');
 if(Math.abs(trialEnd-started-SELF_SERVICE_TRIAL_DAYS*DAY)>TOLERANCE)throw Error('trial_unconfirmed');
 if(Math.abs(licenceEnd-trialEnd)>TOLERANCE||licenceEnd<=now)throw Error('trial_unconfirmed');
 return {account,businessId:grant.id,businessName:String(grant.name||''),
  expiresAt:new Date(licenceEnd).toISOString(),trialDays:SELF_SERVICE_TRIAL_DAYS};
}

// Manual Super Admin password recovery: never reveal an existing password.
// Requires both an audited server-side account check and verified human contact.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origin=Deno.env.get("SUPABASE_URL")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const headers={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Cache-Control":"no-store",
 "Content-Type":"application/json"
};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const groups=["ABCDEFGHJKLMNPQRSTUVWXYZ","abcdefghijkmnpqrstuvwxyz","23456789","!@#_-."];
function secureIndex(max:number):number{
 const ceiling=Math.floor(256/max)*max;
 for(;;){const v=crypto.getRandomValues(new Uint8Array(1))[0];if(v<ceiling)return v%max;}
}
function secretPassword():string{
 const all=groups.join("");
 const chars=groups.map(s=>s[secureIndex(s.length)]);
 while(chars.length<24)chars.push(all[secureIndex(all.length)]);
 for(let i=chars.length-1;i>0;i--){const j=secureIndex(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
 return chars.join("");
}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(request.method!=="POST")return reply({error:"method"},405);
 if(!origin||!anon||!secret)return reply({error:"configuration"},503);
 const token=(request.headers.get("Authorization")||"").match(/^Bearer ([-\w.]+)$/)?.[1];
 if(!token)return reply({error:"unauthorized"},401);
 const body=await request.json().catch(()=>null);
 if(!body||typeof body!=="object"||JSON.stringify(body).length>2500)return reply({error:"invalid_request"},400);
 const target=body.user_id,business=body.business_id,reason=String(body.reason||"").trim(),verified=body.identity_verified===true;
 if(!uuid(target)||!uuid(business)||reason.length<10||reason.length>500||!verified)
  return reply({error:"invalid_request"},400);
 const userResp=await fetch(origin+"/auth/v1/user",{
  headers:{apikey:anon,Authorization:"Bearer "+token},
  signal:AbortSignal.timeout(10000)
 }).catch(()=>null);
 if(!userResp?.ok)return reply({error:"unauthorized"},401);
 const actor=await userResp.json().catch(()=>null);
 if(!uuid(actor?.id)||actor.id===target)return reply({error:"not_authorized"},403);
 const rpc=async(stage:string)=>fetch(origin+"/rest/v1/rpc/pronto_admin_password_recovery",{
  method:"POST",headers:{apikey:anon,Authorization:"Bearer "+token,"Content-Type":"application/json"},
  body:JSON.stringify({p_business:business,p_target:target,p_reason:reason,p_verified:true,p_stage:stage}),
  signal:AbortSignal.timeout(15000)
 });
 // The RPC checks caller permissions, the merchant relationship, the target
 // role, rate limits, verified-human acknowledgement and durable audit.
 const gate=await rpc("requested").catch(()=>null);
 if(!gate?.ok||await gate.json().catch(()=>false)!==true)return reply({error:"not_authorized_or_limited"},403);
 const adminHeaders={apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json"};
 const url=origin+"/auth/v1/admin/users/"+target;
 const found=await fetch(url,{headers:adminHeaders,signal:AbortSignal.timeout(10000)}).catch(()=>null);
 const identity=await found?.json().catch(()=>null);
 const info=identity?.user||identity;
 if(!found?.ok||info?.id!==target||typeof info.email!=="string")
  return reply({error:"account_unavailable"},502);
 const password=secretPassword();
 const updated=await fetch(url,{
  method:"PUT",headers:adminHeaders,body:JSON.stringify({password}),
  signal:AbortSignal.timeout(12000)
 }).catch(()=>null);
 if(!updated?.ok)return reply({error:"reset_failed"},502);
 // Updating the password causes the first-login DB trigger to clear the old
 // onboarding marker. Reapply it only AFTER the password update succeeds.
 // Preserve any other immutable app_metadata, including existing claims.
 const metadata=info.app_metadata&&typeof info.app_metadata==="object"&&!Array.isArray(info.app_metadata)?
  info.app_metadata:{};
 const marked=await fetch(url,{
  method:"PUT",headers:adminHeaders,
  body:JSON.stringify({app_metadata:{...metadata,pronto_password_change_required:true}}),
  signal:AbortSignal.timeout(12000)
 }).catch(()=>null);
 if(!marked?.ok)return reply({error:"reset_partial_contact_support"},503);
 const audit=await rpc("completed").catch(()=>null);
 if(!audit?.ok||await audit.json().catch(()=>false)!==true)
  return reply({error:"reset_partial_contact_support"},503);
 // This is deliberately displayed only once to the verified administrator.
 return reply({ok:true,recovery:true,email:info.email,temporary_password:password,
  account_code:"POS-"+target.slice(0,8).toUpperCase(),user_id:target},200);
});

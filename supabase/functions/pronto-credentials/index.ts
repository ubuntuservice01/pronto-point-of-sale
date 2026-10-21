// Creates merchant or employee credentials without dispatching invitation emails.
// Only Supabase Edge runtime may read the service-role key; it is never bundled.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origin=Deno.env.get("SUPABASE_URL")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const cors={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}
});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v);
const emailOk=(v:unknown):v is string=>typeof v==="string"&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function randomPassword():string{
 const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
 const out:string[]=[];
 // Rejection sampling removes modulo bias; the result has >120 bits of entropy.
 while(out.length<24){
  const bytes=crypto.getRandomValues(new Uint8Array(40));
  for(const byte of bytes){if(byte<alphabet.length*Math.floor(256/alphabet.length))out.push(alphabet[byte%alphabet.length]);if(out.length===24)break;}
 }
 return out.join("");
}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="POST")return json({error:"method"},405);
 if(!origin||!anon||!secret)return json({error:"configuration"},503);
 const bearer=request.headers.get("Authorization")||"";
 const token=bearer.match(/^Bearer ([-\w.]+)$/)?.[1];
 if(!token)return json({error:"unauthorized"},401);
 try{
  const inbound=await request.json().catch(()=>null);
  if(!inbound||typeof inbound!=="object"||JSON.stringify(inbound).length>3000)return json({error:"invalid_input"},400);
  const business_id=inbound.business_id;
  const email=String(inbound.email||"").trim().toLowerCase();
  const display_name=String(inbound.display_name||"").trim();
  const role=inbound.role;
  const scope=inbound.scope;
  if(!uuid(business_id)||!emailOk(email)||display_name.length<2||display_name.length>120||
   !["owner","manager","cashier","stock","finance"].includes(role)||
   !["admin","owner"].includes(scope)||
   (scope==="owner"&&role==="owner"))return json({error:"invalid_input"},400);
  const userResp=await fetch(origin+"/auth/v1/user",{
   headers:{apikey:anon,Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)
  });
  if(!userResp.ok)return json({error:"unauthorized"},401);
  const requester=await userResp.json().catch(()=>null);
  if(!uuid(requester?.id))return json({error:"unauthorized"},401);
  const rpc=async(name:string,body:Record<string,unknown>)=>fetch(origin+"/rest/v1/rpc/"+name,{
   method:"POST",headers:{apikey:anon,Authorization:"Bearer "+token,
    "Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
  });
  const permission=scope==="admin"?
   await rpc("pronto_admin_status",{}):
   await rpc("pronto_owner_invite_allowed",{p_business:business_id});
  if(!permission.ok||await permission.json().catch(()=>null)!==true)return json({error:"not_authorized"},403);
  const password=randomPassword();
  // Admin createUser does NOT send an invitation or password-reset email.
  const created=await fetch(origin+"/auth/v1/admin/users",{
   method:"POST",headers:{apikey:secret,Authorization:"Bearer "+secret,
    "Content-Type":"application/json"},
   body:JSON.stringify({email,password,email_confirm:true,user_metadata:{display_name}}),
   signal:AbortSignal.timeout(15000)
  });
  const createdUser=await created.json().catch(()=>null);
  if(!created.ok)return json({error:created.status===422?"account_exists":"creation_failed"},
   created.status===422?409:502);
  const uid=createdUser?.id??createdUser?.user?.id;
  if(!uuid(uid))return json({error:"provision_partial_contact_support"},503);
  const assigned=scope==="admin"?
   await rpc("pronto_admin_mutation",{p_action:"member_assign",
    p_data:{business_id,user_id:uid,display_name,role}}):
   await rpc("pronto_owner_assign_staff",{p_business:business_id,p_user:uid,
    p_display_name:display_name,p_role:role});
  if(!assigned.ok){
   // Compensate ONLY the fresh identity created above; no existing account is touched.
   const undone=await fetch(origin+"/auth/v1/admin/users/"+uid,{
    method:"DELETE",headers:{apikey:secret,Authorization:"Bearer "+secret},
    signal:AbortSignal.timeout(12000)
   }).catch(()=>null);
   return json({error:undone?.ok?"association_failed":"provision_partial_contact_support"},409);
  }
  return json({ok:true,email,temporary_password:password,
   account_code:"POS-"+uid.slice(0,8).toUpperCase(),user_id:uid,role,business_id},201);
 }catch{
  // Never include passwords, secrets, request bodies or tokens in responses or logs.
  return json({error:"provision_unavailable"},503);
 }
});

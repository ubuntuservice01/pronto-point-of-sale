// Pronto POS merchant owner invitation function. This code executes ONLY in Supabase Edge Functions.
// The service-role key remains inside Supabase project secrets, never in the browser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const origin = Deno.env.get("SUPABASE_URL") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Max-Age":"600",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"},
});
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(value:unknown,max:number)=>typeof value==="string"&&value.trim().length>=2&&value.trim().length<=max;
const validEmail=(v:unknown)=>typeof v==="string"&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="POST")return json({error:"method"},405);
 if(!origin||!anon||!secret)return json({error:"server_configuration"},503);
 const token=(request.headers.get("Authorization")||"").match(/^Bearer ([-\w.]+)$/)?.[1];
 if(!token)return json({error:"unauthorized"},401);
 try{
  // Authenticate the JWT with Supabase Auth, not with request body or metadata.
  const userResult=await fetch(origin+"/auth/v1/user",{headers:{"apikey":anon,Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
  if(!userResult.ok)return json({error:"unauthorized"},401);
  const user=await userResult.json();
  if(!uuid(user?.id))return json({error:"unauthorized"},401);

  const body=await request.json();
  const email=String(body?.email||"").trim().toLowerCase();
  const name=String(body?.display_name||"").trim();
  const businessId=body?.business_id;
  const staffRole=body?.role;
  if(!validEmail(email)||!text(name,120)||!uuid(businessId)||!["manager","cashier","stock","finance"].includes(staffRole))
   return json({error:"invalid_input"},400);

  // Authorise the business and role BEFORE sending any email invitation.
  const scope=await fetch(origin+"/rest/v1/rpc/pronto_owner_invite_allowed",{
   method:"POST",
   headers:{apikey:anon,Authorization:"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify({p_business:businessId}),signal:AbortSignal.timeout(10000)
  });
  if(!scope.ok||await scope.json()!==true)return json({error:"owner_required"},403);

  // Invite through the Auth Admin API without ever returning service credentials.
  const invite=await fetch(origin+"/auth/v1/invite",{
   method:"POST",
   headers:{"apikey":secret,Authorization:"Bearer "+secret,"Content-Type":"application/json"},
   body:JSON.stringify({email,data:{display_name:name}}),signal:AbortSignal.timeout(15000)
  });
  const invited=await invite.json().catch(()=>null);
  if(!invite.ok){
   // Do not leak auth provider details to the browser.
   return json({error:invite.status===422?"account_exists_use_existing_user":"invitation_unavailable"},invite.status===422?409:502);
  }
  const newId=invited?.id ?? invited?.user?.id;
  if(!uuid(newId))return json({error:"invitation_created_check_auth_dashboard"},502);

  // The shop owner's JWT must pass a second database permission check to attach staff.
  const assign=await fetch(origin+"/rest/v1/rpc/pronto_owner_assign_staff",{
   method:"POST",
   headers:{apikey:anon,Authorization:"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify({p_business:businessId,p_user:newId,p_display_name:name,p_role:staffRole}),signal:AbortSignal.timeout(15000)
  });
  if(!assign.ok){
   // The invite may exist; owner can retry member assignment using the user ID.
   return json({error:"invited_but_membership_failed",user_id:newId},409);
  }
  return json({ok:true,invited:true,user_id:newId,role:staffRole,business_id:businessId},201);
 }catch{
  return json({error:"invitation_unavailable"},503);
 }
});

// Secure self-service PIN reset. This is the ONLY place where account passwords
// are rechecked: the password goes to Supabase Auth, never to Postgres or logs.
// PUBLIC browser callers cannot execute pronto_pin_recovery_service.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const origin=Deno.env.get("SUPABASE_URL")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const cors={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Cache-Control":"no-store"
};
const json=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{
 status,headers:{...cors,"Content-Type":"application/json"}
});
const uuid=(s:unknown)=>typeof s==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return json({error:"method"},405);
 if(!origin||!anon||!secret)return json({error:"server_configuration"},503);
 if(!/application\/json/i.test(req.headers.get("content-type")||""))return json({error:"invalid_input"},400);
 const bearer=req.headers.get("Authorization")||"";
 const authToken=/^Bearer ([-\w.]+)$/.exec(bearer)?.[1];
 if(!authToken)return json({error:"unauthorized"},401);
 if(Number(req.headers.get("content-length")||0)>4096)return json({error:"invalid_input"},413);
 let proofToken:string|null=null;
 try{
  // The user must already be signed into the locked app.
  const identity=await fetch(origin+"/auth/v1/user",{
   method:"GET",headers:{apikey:anon,Authorization:"Bearer "+authToken},
   cache:"no-store",signal:AbortSignal.timeout(10000)
  });
  if(!identity.ok)return json({error:"unauthorized"},401);
  const user=await identity.json().catch(()=>null);
  if(!uuid(user?.id)||typeof user?.email!=="string"||user.email.length>254)
   return json({error:"unauthorized"},401);

  const payload=await req.json();
  const password=payload?.password;
  const pin=payload?.new_pin;
  if(!password||typeof password!=="string"||password.length>200||
    typeof pin!=="string"||!/^[0-9]{5}$/.test(pin))
   return json({error:"invalid_input"},400);

  // Fresh password authentication, NOT a token refresh or JWT metadata check.
  const passwordCheck=await fetch(origin+"/auth/v1/token?grant_type=password",{
   method:"POST",headers:{apikey:anon,"Content-Type":"application/json"},
   body:JSON.stringify({email:user.email,password}),cache:"no-store",
   signal:AbortSignal.timeout(15000)
  });
  if(!passwordCheck.ok){
   if(passwordCheck.status===429)return json({error:"rate_limited"},429);
   return json({error:"incorrect_password"},403);
  }
  const verified=await passwordCheck.json().catch(()=>null);
  if(!uuid(verified?.user?.id)||verified.user.id!==user.id||
    typeof verified.access_token!=="string")
   return json({error:"identity_mismatch"},403);
  proofToken=verified.access_token;

  // Credentials and the fresh proof token never leave this function.
  const reset=await fetch(origin+"/rest/v1/rpc/pronto_pin_recovery_service",{
   method:"POST",headers:{apikey:secret,Authorization:"Bearer "+secret,
    "Content-Type":"application/json"},
   body:JSON.stringify({p_user:user.id,p_new_pin:pin}),
   cache:"no-store",signal:AbortSignal.timeout(15000)
  });
  if(!reset.ok){
   const errorBody=await reset.json().catch(()=>null);
   const message=String(errorBody?.message||"");
   if(message.includes("pin_must_be_different"))return json({error:"same_pin"},400);
   if(message.includes("pin_recovery_rate_limited"))return json({error:"rate_limited"},429);
   if(message.includes("pin_not_configured"))return json({error:"pin_not_configured"},409);
   return json({error:"recovery_unavailable"},503);
  }
  const result=await reset.json().catch(()=>null);
  if(result?.ok!==true)return json({error:"recovery_unavailable"},503);
  return json({ok:true,configured:true});
 }catch{
  return json({error:"recovery_unavailable"},503);
 }finally{
  // Supabase creates a fresh session on password reauthentication. Invalidate
  // it; the previously authenticated app session stays inside the PIN lock gate.
  if(proofToken)try{
   await fetch(origin+"/auth/v1/logout",{
    method:"POST",headers:{apikey:anon,Authorization:"Bearer "+proofToken},
    cache:"no-store",signal:AbortSignal.timeout(5000)
   });
  }catch{/* Best effort: the token is never returned or persisted. */}
 }
});

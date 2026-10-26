// Pronto POS: password login by Mozambican mobile number.
// The mobile-to-email mapping never leaves this server and never reaches the public client.
// Auth password verification is delegated to Supabase Auth (GoTrue).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const origin=Deno.env.get("SUPABASE_URL")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const cors={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Cache-Control":"no-store",
 "Vary":"Origin"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}
});
function phoneNumber(raw:unknown):string|null{
 if(typeof raw!=="string"||raw.length>40)return null;
 const digits=raw.replace(/[^0-9]/g,"");
 if(/^0?8[2-7][0-9]{7}$/.test(digits))return "+258"+digits.slice(-9);
 if(/^2588[2-7][0-9]{7}$/.test(digits))return "+"+digits;
 return null;
}

Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="POST")return json({error:"method_not_allowed"},405);
 if(!origin||!anon||!service)return json({error:"temporarily_unavailable"},503);
 const length=Number(request.headers.get("content-length")||0);
 if(length>3072)return json({error:"invalid_input"},400);
 let value:Record<string,unknown>;
 try{
  value=await request.json();
  if(!value||Array.isArray(value)||typeof value!=="object")throw Error("invalid");
 }catch{return json({error:"invalid_input"},400);}
 const phone=phoneNumber(value.phone);
 const password=value.password;
 if(!phone||typeof password!=="string"||password.length<1||password.length>200)
  return json({error:"invalid_credentials"},401);
 try{
  const lookup=await fetch(origin+"/rest/v1/rpc/pronto_login_email_for_phone",{
   method:"POST",
   headers:{"apikey":service,"Authorization":"Bearer "+service,"Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify({p_phone:phone})
  });
  if(!lookup.ok){
   const reason=await lookup.json().catch(()=>null);
   if(reason?.message==="too_many_attempts")return json({error:"rate_limited"},429);
   return json({error:"temporarily_unavailable"},503);
  }
  const email=await lookup.json();
  if(typeof email!=="string"||email.length>254)return json({error:"invalid_credentials"},401);
  // The secret key is NEVER used to bypass password validation.
  const signedIn=await fetch(origin+"/auth/v1/token?grant_type=password",{
   method:"POST",
   headers:{"apikey":anon,"Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify({email,password})
  });
  if(signedIn.status===429)return json({error:"rate_limited"},429);
  if(!signedIn.ok)return json({error:"invalid_credentials"},401);
  const token=await signedIn.json();
  if(typeof token?.access_token!=="string"||typeof token?.refresh_token!=="string"||
    typeof token?.user?.id!=="string")return json({error:"temporarily_unavailable"},503);
  return json({access_token:token.access_token,refresh_token:token.refresh_token,
   expires_in:token.expires_in,user:{id:token.user.id}},200);
 }catch{return json({error:"temporarily_unavailable"},503);}
});

// Legacy invitation route disabled. New accounts are provisioned without emails
// by pronto-credentials, which checks caller permissions and returns credentials once.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(request=>{
 const headers={"Content-Type":"application/json","Cache-Control":"no-store",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS"};
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 return new Response(JSON.stringify({error:"legacy_invitation_disabled"}),{status:410,headers});
});

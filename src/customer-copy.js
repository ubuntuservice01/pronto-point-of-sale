// Customer-visible copy only. Keep technical error identifiers in code/logs,
// never in the merchant's status or error text.
const internal=/\b(?:supabase|postgresql|postgrest|sqlstate|rpc|jwt|graphql|fetch|tenant|pgrst\d+|rest\/v1|auth\/v1|permission denied|database error)\b/i;
const codePattern=/\b(?:supabase_[a-z_]+|pronto_private\.[a-z_]+|PGRST\d+|[245]\d[A-Z0-9]{3})\b/i;
const pending=/^a\s+(?:consultar|verificar|carregar|buscar|actualizar|atualizar|registar|registrar|guardar|enviar|reconciliar|executar|validar|sincronizar|preparar)\b/i;
export function customerMessage(value,{warning=false}={}){
 const original=String(value??'').trim();
 if(!original)return '';
 // These are transitional developer statuses; completion messages are still shown.
 if(!warning&&(pending.test(original)||/^dados sincronizados com o supabase/i.test(original)))return '';
 const clean=original.replace(/\b(?:no|do|ao|pelo)\s+Supabase\b/gi,'no sistema')
   .replace(/\bSupabase\b/gi,'Pronto POS')
   .replace(/\bPostgreSQL\b/gi,'sistema')
   .replace(/\b(?:API|RPC)\b/g,'sistema');
 if(codePattern.test(clean)||internal.test(clean))
  return warning?'Não foi possível concluir a operação. Confira os dados e tente novamente.':'';
 return clean;
}
export function customerError(error,defaultText='Não foi possível concluir a operação. Verifique a ligação e tente novamente.'){
 const raw=String(error?.message??error??'');
 if(internal.test(raw)||codePattern.test(raw)||/\b(?:networkerror|typeerror|syntaxerror)\b/i.test(raw)||/[{}_<>]/.test(raw))
  return defaultText;
 if(raw.length>160||/[\n\r]/.test(raw))return defaultText;
 return customerMessage(raw,{warning:true})||defaultText;
}

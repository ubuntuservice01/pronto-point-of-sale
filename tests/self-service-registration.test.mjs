import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('Public self-service registration has merchant and owner fields, verification recovery and PIN handoff',()=>{
 const ui=read('src/supabase-auth-check-ui.js');
 for(const key of ['pronto-show-register','pronto-self-register','owner_name','business_name','whatsapp','industry','marketing_consent','accept_terms','pronto-complete-registration','mountProntoPinGate'])
  assert.ok(ui.includes(key),key);
 assert.match(ui,/selfServiceSignUp/);
 assert.match(ui,/registerSelfServiceBusiness/);
 assert.match(ui,/needsEmailConfirmation/);
});
test('Registration server guard is one per identity, atomic and has ten-day grant',()=>{
 const sql=read('supabase/migrations/20261026173000_self_service_trials.sql');
 for(const marker of ['user_id uuid primary key','pg_advisory_xact_lock','email_confirmed_at is not null',"interval '10 days'",'pronto_memberships','pronto_subscriptions','grant execute on function public.pronto_self_service_register','pronto_trial_overview','marketing_consent'])
  assert.ok(sql.includes(marker),marker);
 assert.doesNotMatch(sql,/grant execute on function public.pronto_self_service_register\(jsonb\) to anon/);
});
test('No service-role key is exposed by sign-up client',()=>{
 const api=read('src/supabase-identity.js');
 assert.match(api,/auth\/v1\/signup/);
 assert.match(api,/rpc\/pronto_self_service_register/);
 assert.doesNotMatch(api,/SUPABASE_SERVICE_ROLE_KEY/);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {renderUbuntuAdminTab} from '../src/supabase-admin-ui.js';import {ADMIN_TABS} from '../src/supabase-admin-model.js';
test('Trials admin view lists only safely escaped data and respects marketing consent',()=>{
 assert.ok(ADMIN_TABS.includes('trials'));
 const now='2026-10-26T08:00:00Z';
 const common={business_id:'11111111-1111-4111-8111-111111111111',name:'Loja <unsafe>',owner_name:'Ana',email:'ana@example.com',phone:'841234567',whatsapp:'258841234567',industry:'Mercearia',plan_name:'Teste gratuito',started_at:now,license_expires_at:now,status:'trial'};
 const html=renderUbuntuAdminTab('trials',{}, {trials:[{...common,marketing_consent:false},{...common,status:'expired',marketing_consent:true}]});
 assert.match(html,/Testes gratuitos/);
 assert.match(html,/&lt;unsafe&gt;/);
 assert.doesNotMatch(html,/<unsafe>/);
 assert.match(html,/Sem autorização comercial/);
 assert.match(html,/https:\/\/wa.me\/258841234567/);
 assert.match(html,/Expirados/);
});

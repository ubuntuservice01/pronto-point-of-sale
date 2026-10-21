import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {credentialsText} from '../src/pronto-credentials-ui.js';
import {renderProvisioningForms} from '../src/supabase-admin-forms.js';
import {prepareAdminProvisioning} from '../src/supabase-admin-dashboard.js';
const data={ok:true,email:'ana@example.org',temporary_password:'Private-Pass-33679955AA',account_code:'POS-AB12CD34'};
test('Manual account receipt contains login, initial password and reference without emails',()=>{
 const message=credentialsText(data,'https://pronto-pos-ubuntu.lovable.app');
 assert.match(message,/Email: ana@example.org/);
 assert.match(message,/Palavra-passe inicial: Private-Pass/);
 assert.match(message,/Referência: POS-AB12CD34/);
 assert.match(message,/defina o seu PIN pessoal/);
 assert.throws(()=>credentialsText({...data,temporary_password:''},'https://x.test'),/credentials_invalid/);
});
test('Production onboarding asks only the admin to create access, not to send invitations',()=>{
 const html=renderProvisioningForms('members',{businesses:[{id:'22222222-2222-4222-8222-222222222222',name:'Mercearia',members:[]}],plans:[]});
 assert.match(html,/data-provision-action="member_create"/);
 assert.match(html,/Criar acesso e mostrar senha/);
 assert.doesNotMatch(html,/Convidar por email|Enviar convite/);
 assert.doesNotMatch(html,/name="password"/);
 class MockFormData{constructor(form){this.entries=form.entries;}get(key){return this.entries[key]||'';}}
 const act=prepareAdminProvisioning({dataset:{provisionAction:'member_create'},entries:{
  business_id:'22222222-2222-4222-8222-222222222222',display_name:'Ana',email:'ana@example.org',role:'owner'
 }},MockFormData);
 assert.equal(act.action,'member_create');
 assert.equal(act.data.email,'ana@example.org');
});
test('User-facing login avoids infrastructure, internal technical references and admin onboarding',()=>{
 const login=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 assert.match(login,/<h2>Bem-vindo<\/h2>/);
 assert.match(login,/Pronto <span>POS<\/span>/);
 assert.doesNotMatch(login,/<label>Email da conta Supabase/);
 assert.doesNotMatch(login,/Para registar a primeira loja, entre com a conta/);
 assert.doesNotMatch(login,/Os acessos são verificados no Supabase/);
});
test('Edge account provision uses server-side secrets, a secure random password and no email invitation',()=>{
 const code=readFileSync(new URL('../supabase/functions/pronto-credentials/index.ts',import.meta.url),'utf8');
 for(const pattern of [/SUPABASE_SERVICE_ROLE_KEY/,/crypto\.getRandomValues/,/auth\/v1\/admin\/users/,
  /pronto_admin_status/,/pronto_owner_invite_allowed/,/pronto_admin_mutation/,
  /pronto_owner_assign_staff/,/Cache-Control/,/no-store/,/email_confirm:true/])
  assert.match(code,pattern);
 assert.doesNotMatch(code,/auth\/v1\/invite|inviteUserByEmail|sendEmail\(/);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('Public signup explicitly explains failures instead of claiming an account exists',()=>{
 const id=readFileSync(new URL('../src/supabase-identity.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 assert.match(id,/signup_disabled:'registration_disabled'/);
 assert.match(id,/weak_password:'registration_weak_password'/);
 assert.match(ui,/registo de novos utilizadores está desactivado/);
 assert.match(ui,/Nenhuma loja foi criada/);
 assert.doesNotMatch(ui,/A conta poderá ter sido criada/);
});
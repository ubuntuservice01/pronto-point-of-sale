import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const login=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/login-green.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('New login is split: real left-side form, before/after right-side image',()=>{
 assert.match(login,/class="pronto-login-left"/);
 assert.match(login,/class="pronto-login-right"/);
 assert.ok(login.indexOf('class="pronto-login-left"')<login.indexOf('class="pronto-login-right"'));
 assert.match(login,/src="\/login-antes-depois\.webp"/);
 assert.match(login,/name="email"/);
 assert.match(login,/name="password"/);
 assert.match(login,/autocomplete="username"/);
 assert.match(login,/autocomplete="current-password"/);
 assert.match(login,/createProntoIdentity/);
 assert.match(login,/client\.signIn/);
 assert.match(login,/mountProntoPinGate/);
});
test('Brand colors stay green and are isolated to login',()=>{
 assert.match(css,/#087f68/i);
 assert.match(css,/\.login-shell\.pronto-auth-test/);
 assert.match(css,/grid-template-columns:/);
 assert.match(css,/@media\(max-width:660px\)/);
 assert.doesNotMatch(css,/#0[56][0-9a-f]{4}/i); // blue brand not introduced
 assert.match(html,/\/src\/login-green\.css/);
 assert.match(sw,/\/login-antes-depois\.webp/);
 assert.match(sw,/\/src\/login-green\.css/);
});
test('Password controls and recovery remain real and do not imply PIN-only login',()=>{
 assert.match(login,/id="pronto-toggle-password"/);
 assert.match(login,/field\.type=show\?'text':'password'/);
 assert.match(login,/id="recovery-request"/);
 assert.match(login,/beginRecovery\(null\)/);
 assert.match(login,/type="email"/);
 assert.match(login,/type="password"/);
 assert.doesNotMatch(login,/<label>PIN ou senha/);
 assert.doesNotMatch(login,/<label>Email da conta Supabase/);
 assert.doesNotMatch(login,/Para registar a primeira loja, entre com a conta/);
});

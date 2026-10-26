import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/supabase-identity.js',import.meta.url),'utf8');
test('Signup accepts GoTrue direct user response and nested user response',()=>{
 assert.match(source,/value\?\.user\|\|value/);
 assert.match(source,/registration_response_invalid/);
 assert.match(source,/needsEmailConfirmation:!value\.access_token/);
});

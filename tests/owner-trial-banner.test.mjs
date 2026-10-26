import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('Trial status on owner view is scoped and visible',()=>{
 const api=readFileSync(new URL('../src/supabase-identity.js',import.meta.url),'utf8');
 const dash=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/supabase-shop-ui.js',import.meta.url),'utf8');
 assert.match(api,/rpc\/pronto_my_trial_status/);assert.match(dash,/grant.role==='owner'\?await client.myTrialStatus/);
 assert.match(ui,/Teste gratuito/);assert.match(ui,/Faltam /);assert.match(ui,/trialStatus\.expired/);
});

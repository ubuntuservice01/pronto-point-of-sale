import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confirmSelfServiceActivation} from '../src/self-service-activation.js';

const SHOP='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const NOW=Date.parse('2026-10-27T10:00:00Z');
const DAY=864e5;
const trial=(over={})=>({started_at:new Date(NOW).toISOString(),trial_expires_at:new Date(NOW+10*DAY).toISOString(),
 expires_at:new Date(NOW+10*DAY).toISOString(),is_trial:true,expired:false,...over});
const fakeClient=({grants=[{id:SHOP,name:'Mercearia da Ana',role:'owner'}],status=trial()}={})=>{
 const calls=[];
 return {calls,
  account:async()=>{calls.push('account');return {userId:'u',email:'a@b.test',ubuntuAdmin:false,grants};},
  myTrialStatus:async id=>{calls.push('trial:'+id);return typeof status==='function'?status(id):status;}};
};

test('success is confirmed only when the account owns the new shop and its trial lasts 10 days',async()=>{
 const client=fakeClient();
 const ok=await confirmSelfServiceActivation(client,{expectedBusinessId:SHOP,now:NOW});
 assert.equal(ok.businessId,SHOP);
 assert.equal(ok.trialDays,10);
 assert.equal(ok.expiresAt,new Date(NOW+10*DAY).toISOString());
 assert.deepEqual(client.calls,['account','trial:'+SHOP]);
});

test('a register response without a real shop id is never treated as success',async()=>{
 await assert.rejects(confirmSelfServiceActivation(fakeClient(),{expectedBusinessId:'',now:NOW}),{message:'activation_unconfirmed'});
});

test('the shop must appear as an owner grant for this account',async()=>{
 await assert.rejects(confirmSelfServiceActivation(fakeClient({grants:[]}),{expectedBusinessId:SHOP,now:NOW}),{message:'activation_unconfirmed'});
 await assert.rejects(confirmSelfServiceActivation(fakeClient({grants:[{id:SHOP,name:'X',role:'cashier'}]}),{expectedBusinessId:SHOP,now:NOW}),{message:'activation_unconfirmed'});
 await assert.rejects(confirmSelfServiceActivation(fakeClient({grants:[{id:OTHER,name:'X',role:'owner'}]}),{expectedBusinessId:SHOP,now:NOW}),{message:'activation_unconfirmed'});
});

test('a missing, paid, expired or non-10-day trial blocks the success screen',async()=>{
 for(const status of [null,trial({is_trial:false}),trial({expired:true}),
  trial({trial_expires_at:new Date(NOW+30*DAY).toISOString(),expires_at:new Date(NOW+30*DAY).toISOString()}),
  trial({started_at:new Date(NOW-11*DAY).toISOString(),trial_expires_at:new Date(NOW-DAY).toISOString(),expires_at:new Date(NOW-DAY).toISOString()}),
  trial({expires_at:'not-a-date'})])
  await assert.rejects(confirmSelfServiceActivation(fakeClient({status}),{expectedBusinessId:SHOP,now:NOW}),{message:'trial_unconfirmed'});
});

test('after account_already_registered the single owned shop is verified instead of created again',async()=>{
 const ok=await confirmSelfServiceActivation(fakeClient(),{expectedBusinessId:null,now:NOW});
 assert.equal(ok.businessId,SHOP);
 // Staff of another shop, or several owned shops, cannot be guessed as "the new shop".
 await assert.rejects(confirmSelfServiceActivation(fakeClient({grants:[{id:SHOP,name:'A',role:'owner'},{id:OTHER,name:'B',role:'owner'}]}),{expectedBusinessId:null,now:NOW}),{message:'activation_unconfirmed'});
 await assert.rejects(confirmSelfServiceActivation(fakeClient({grants:[{id:SHOP,name:'A',role:'manager'}]}),{expectedBusinessId:null,now:NOW}),{message:'activation_unconfirmed'});
});

test('registration UI only shows the green success screen after the server confirmation',()=>{
 const ui=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 const confirm=ui.indexOf('await confirmSelfServiceActivation(client');
 const shown=ui.indexOf('activated(confirmed)');
 assert.ok(confirm>0&&shown>confirm,'success screen must follow the confirmation');
 assert.equal(ui.match(/activated\(/g).length,1,'the success screen has a single entry point');
 // After the identity exists, a retry never calls signup again.
 assert.match(ui,/if\(!identityReady\)\{\s*const result=await client\.selfServiceSignUp/);
});

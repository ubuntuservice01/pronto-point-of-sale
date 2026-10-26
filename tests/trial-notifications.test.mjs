import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {renderUbuntuAdminTab} from '../src/supabase-admin-ui.js';
test('Dashboard highlights new registrations, ending trials and expired accounts with no automatic marketing',()=>{
 const now=new Date('2026-10-26T12:00:00Z');
 const r={name:'Mercearia',owner_name:'Ana',email:'ana@example.org',phone:'841234567',industry:'Mercearia',plan_name:'Teste gratuito',marketing_consent:false,whatsapp:'258841234567',started_at:'2026-10-26T10:00:00Z'};
 const h=renderUbuntuAdminTab('trials',{}, {now,trials:[{...r,status:'trial',license_expires_at:'2026-10-27T10:00:00Z'},{...r,status:'expired',license_expires_at:'2026-10-20T10:00:00Z'}]});
 assert.match(h,/2 novo\(s\) registo\(s\)/);
 assert.match(h,/1 teste\(s\) a terminar/);
 assert.match(h,/1 expirado\(s\)/);
 assert.match(h,/1 dia\(s\) restantes/);
 assert.match(h,/Mensagens automáticas ainda não estão activadas/);
 assert.doesNotMatch(h,/https:\/\/wa.me\//);
});
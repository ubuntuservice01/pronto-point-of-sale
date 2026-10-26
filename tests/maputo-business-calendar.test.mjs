import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20261026220925_fix_mozambique_calendar_business_operations.sql',import.meta.url),'utf8');

test('Expiry decisions use Mozambique local calendar without changing the database UTC default',()=>{
 const nearMidnight=new Date('2026-10-26T22:30:00Z');
 const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).format(nearMidnight);
 assert.equal(nearMidnight.toISOString().slice(0,10),'2026-10-26');
 assert.equal(localDate,'2026-10-27');
 for(const operation of ['merchant_action','credit_action','return_action','transfer_action']){
  assert.match(migration,new RegExp(`alter function pronto_private\\.${operation}\\(text,jsonb\\)\\s+set timezone to 'Africa/Maputo'`));
 }
 assert.doesNotMatch(migration,/alter database|alter role/i);
});

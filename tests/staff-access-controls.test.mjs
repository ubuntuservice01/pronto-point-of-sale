import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStaffSnapshot,renderStaffManagement} from '../src/supabase-team-management-ui.js';

const staff={user_id:'11111111-1111-4111-8111-111111111111',name:'João',email:'joao@example.test',
 role:'cashier',active:true,manual_mode:'block',schedule_enabled:true,
 start_time:'07:00',end_time:'19:00',weekdays:[1,2,3,4,5],allowed_now:false};
test('normalizes individual time access settings',()=>{
 const {staff:[s]}=normalizeStaffSnapshot({staff:[staff]});
 assert.equal(s.manualMode,'block');
 assert.equal(s.scheduleEnabled,true);
 assert.deepEqual(s.weekdays,[1,2,3,4,5]);
 assert.equal(s.allowedNow,false);
});
test('owner controls appear with time and remote override',()=>{
 const html=renderStaffManagement(normalizeStaffSnapshot({staff:[staff]}));
 assert.match(html,/Bloquear agora/);
 assert.match(html,/Autorizar agora/);
 assert.match(html,/Usar horário/);
 assert.match(html,/name="start_time" value="07:00"/);
 assert.match(html,/name="end_time" value="19:00"/);
 assert.match(html,/Acesso bloqueado/);
});
test('unknown schedule values fall back to safe client rendering',()=>{
 const {staff:[s]}=normalizeStaffSnapshot({staff:[{...staff,manual_mode:'invalid',
  start_time:'99:99',weekdays:[1,1,-2,8],allowed_now:null}]});
 assert.equal(s.manualMode,'auto');
 assert.equal(s.startTime,'07:00');
 assert.deepEqual(s.weekdays,[1]);
 assert.equal(s.allowedNow,false);
});
test('employee names are escaped in owner interface',()=>{
 const html=renderStaffManagement(normalizeStaffSnapshot({staff:[{...staff,name:'<script>bad</script>'}]}));
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
});

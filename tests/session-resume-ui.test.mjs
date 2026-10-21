import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canResumePinContinuity,rememberPinContinuity,clearPinContinuity} from '../src/pronto-pin-continuity.js';
class Storage {
 constructor(){this.records=new Map()}
 getItem(k){return this.records.get(k)??null}
 setItem(k,v){this.records.set(k,v)}
 removeItem(k){this.records.delete(k)}
}
const person='11111111-1111-4111-8111-111111111111';
test('PIN stays unlocked only for a recent refresh of the same tab',()=>{
 const storage=new Storage(),now=50000;
 rememberPinContinuity(storage,person,now);
 const p={storage,userId:person,now:now+500,idleMs:600000};
 assert.equal(canResumePinContinuity({...p,navigationType:'reload'}),true);
 assert.equal(canResumePinContinuity({...p,navigationType:'navigate'}),false);
 assert.equal(canResumePinContinuity({...p,navigationType:'back_forward'}),false);
 assert.equal(canResumePinContinuity({...p,navigationType:'reload',now:now+600001}),false);
 clearPinContinuity(storage,person);
 assert.equal(canResumePinContinuity({...p,navigationType:'reload'}),false);
});
test('Page entry restores auth before showing the password form',()=>{
 const auth=readFileSync(new URL('../src/supabase-auth-check-ui.js',import.meta.url),'utf8');
 const pin=readFileSync(new URL('../src/supabase-pin-lock.js',import.meta.url),'utf8');
 assert.match(auth,/client\.restoreSession\(\)/);
 assert.match(auth,/ready\(account,true\)/);
 assert.match(pin,/allowReloadResume&&/);
 assert.match(pin,/beforeunload/);
 assert.match(pin,/visibilitychange/);
});

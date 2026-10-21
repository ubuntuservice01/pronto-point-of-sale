import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProntoEntry} from '../src/entry-mode.js';

test('public host always requires Supabase authentication even with a demo query',()=>{
 for(const search of ['', '?demo=1', '?mode=server', '?mode=demo', '?auth-check=1']){
  assert.equal(selectProntoEntry({hostname:'pronto-pos.lovable.app',search,siteMode:'demo'}),'supabase');
 }
});
test('development keeps local demo and supports explicit real login',()=>{
 assert.equal(selectProntoEntry({hostname:'localhost'}),'demo');
 assert.equal(selectProntoEntry({hostname:'127.0.0.1',search:'?demo=1'}),'demo');
 assert.equal(selectProntoEntry({hostname:'localhost',search:'?mode=supabase'}),'supabase');
 assert.equal(selectProntoEntry({hostname:'localhost',search:'?auth-check=1'}),'supabase');
});
test('real Node server stays authenticated even with demo query on public host',()=>{
 assert.equal(selectProntoEntry({hostname:'pos.example.com',search:'?demo=1',siteMode:'server'}),'server');
 assert.equal(selectProntoEntry({hostname:'localhost',siteMode:'server'}),'server');
 assert.equal(selectProntoEntry({hostname:'localhost',siteMode:'server',search:'?demo=1'}),'demo');
});

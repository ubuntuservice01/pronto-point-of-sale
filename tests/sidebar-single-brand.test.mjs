import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Merchant sidebar does not duplicate the Pronto POS brand',()=>{
 const source=read('src/supabase-shop-ui.js');
 const css=read('src/shop-sidebar.css');
 const markup=source.slice(source.indexOf("return '<div class=\"shop-shell shop-layout"),source.indexOf("'<div class=\"shop-toolbar"));
 assert.ok(markup.startsWith("return '<div"),'merchant layout template located');
 assert.doesNotMatch(markup,/shop-sidebar-brand/);
 assert.match(markup,/shop-sidebar-top/);
 assert.match(markup,/MENU DO NEGÓCIO/);
 assert.match(markup,/data-shop-sidebar-collapse/);
 assert.match(markup,/<div class=\"shop-workspace\"><header class=\"shop-header\">/);
 assert.equal((markup.match(/<img src=\"\/icon\.svg\"/g)||[]).length,1,'brand visible only in primary header');
 assert.match(css,/shop-sidebar-top/);
 assert.doesNotMatch(css,/shop-sidebar-brand/);
});
test('PWA cache changes for merchant layout refresh',()=>{
 assert.match(read('public/sw.js'),/const CACHE='pronto-pos-v\d+'/);
});

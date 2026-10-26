import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Capulana watermark is available throughout POS, login, admin and offline PWA',()=>{
 const html=read('index.html'),sw=read('public/sw.js'),css=read('src/capulana-theme.css');
 assert.match(html,/src\/capulana-theme\.css/);
 assert.match(sw,/src\/capulana-theme\.css/);
 for(const selector of ['.shop-layout','.shop-workspace','.pronto-admin-shell','.workspace','.login-shell.pronto-auth-test','.pronto-pin-backdrop.pin-city-theme']) assert.ok(css.includes(selector),selector);
 assert.match(css,/--pronto-capulana:url\("data:image\/svg\+xml,/);
 assert.match(css,/@media print/);
 assert.match(css,/background-image:none!important/);
});
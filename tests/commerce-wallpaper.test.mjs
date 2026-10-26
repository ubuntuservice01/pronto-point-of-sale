import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Commerce wallpaper is a self-contained SVG with 20+ low contrast retail motifs',()=>{
 const svg=read('public/patterns/pronto-commerce-pattern.svg');
 assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);
 for(const key of ['umbrella','soap','shoe','pills','bicycle','cement','rice','bottle','shoppingbag','shirt','cart','banknote','coin','medicine','fruit','terminal']){
  assert.ok(svg.includes('id="'+key+'"'),'Missing '+key);
 }
 assert.ok((svg.match(/<use href="#/g)||[]).length>=20);
 assert.match(svg,/opacity="\.27"/);
 assert.match(svg,/MT/);
 assert.doesNotMatch(svg,/<(?:script|image|foreignObject)\b/i);
});
test('Wallpaper affects only POS area, keeps white cards and caches SVG for offline PWA',()=>{
 const css=read('src/capulana-theme.css'),sw=read('public/sw.js'),html=read('index.html');
 assert.ok(html.includes('/src/capulana-theme.css'));
 assert.ok(css.includes("--pronto-commerce-wallpaper:url('/patterns/pronto-commerce-pattern.svg')"));
 assert.ok(css.includes('background-image:var(--pronto-commerce-wallpaper)!important;'));
 assert.ok(css.includes('.shop-layout .shop-main'));
 assert.ok(css.includes('.shop-layout .shop-box'));
 assert.ok(css.includes('@media print'));
 assert.ok(sw.includes('"/patterns/pronto-commerce-pattern.svg"'));
 assert.match(sw,/const CACHE='pronto-pos-v\d+'/);
});

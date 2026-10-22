import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOP_SCAN_FORMATS,findScannedShopProduct,shopSupportedFormats,shopScannerHTML} from '../src/shop-mobile-scanner.js';
const items=[{id:'a',code:'EAN-0042',active:true,stock:2},{id:'b',code:'QR-2026',active:false,stock:2}];
test('Leitor identifica apenas o código exacto de artigos activos',()=>{
 assert.equal(findScannedShopProduct(items,' ean-0042 ')?.id,'a');
 assert.equal(findScannedShopProduct(items,'EAN-004'),null);
 assert.equal(findScannedShopProduct(items,'QR-2026'),null);
 assert.equal(findScannedShopProduct(items,' '),null);
 assert.equal(findScannedShopProduct(null,'EAN-0042'),null);
});
test('Suporta QR, EAN e Code128 quando o navegador disponibiliza esses formatos',()=>{
 assert.ok(SHOP_SCAN_FORMATS.includes('qr_code'));
 assert.ok(SHOP_SCAN_FORMATS.includes('ean_13'));
 assert.deepEqual(shopSupportedFormats(['qr_code','ean_13','unsupported']),['qr_code','ean_13']);
 assert.deepEqual(shopSupportedFormats([]),[]);
 assert.ok(shopSupportedFormats(undefined).includes('code_128'));
});
test('Leitor mantém opção manual e botão para fechar',()=>{
 const html=shopScannerHTML();
 assert.match(html,/data-shop-scan-video/);
 assert.match(html,/data-shop-scan-manual/);
 assert.match(html,/data-shop-scan-close/);
 assert.match(html,/playsinline/);
});

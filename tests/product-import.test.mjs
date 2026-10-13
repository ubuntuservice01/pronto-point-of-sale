import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProductCSV} from '../src/product-import.js';
test('Portuguese CSV rows import prices as integer centavos with optional fields',()=>{
 const result=parseProductCSV('nome;categoria;preco;codigo;unidade;stock;minimo;validade\nArroz;Alimentação;75,50;AR01;kg;12;2;\nSabão;Limpeza;25;SAB;un;30;3;');
 assert.equal(result.products.length,2);
 assert.equal(result.products[0].price,7550);
 assert.equal(result.products[0].photo,'');
 assert.equal(result.products[1].stock,30);
});
test('CSV rejects duplicates within file or existing business and invalid rows',()=>{
 const text='nome;categoria;preco;codigo;unidade;stock\nArroz;Alimentação;75;AR01;un;2\nÓleo;Alimentação;150;AR01;un;2\nPrego;Ferragem;-3;;un;8';
 const r=parseProductCSV(text);
 assert.equal(r.products.length,1);
 assert.deepEqual(r.errors,[3,4]);
 assert.equal(parseProductCSV(text,['AR01']).products.length,0);
});
test('CSV rejects oversized files and absent required columns',()=>{
 assert.throws(()=>parseProductCSV('nome,preco\nArroz,4'),/csv_headers/);
 assert.throws(()=>parseProductCSV('x'.repeat(300001)),/csv_size/);
});

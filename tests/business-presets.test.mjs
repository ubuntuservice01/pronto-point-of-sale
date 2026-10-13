import test from 'node:test';
import assert from 'node:assert/strict';
import {businessPreset,presetCategories,presetSummaryHTML,categorySuggestionsHTML} from '../src/business-presets.js';
test('commerce types show contextual hints without changing product data',()=>{
 assert.equal(businessPreset('Mercearia').pt,'Mercearia');
 assert.equal(businessPreset('Ferragem').pt,'Ferragem');
 assert.equal(businessPreset('Boutique').pt,'Roupa e calçado');
 assert.equal(businessPreset('Cosméticos').pt,'Cosméticos');
 assert.equal(businessPreset('Papelaria').pt,'Papelaria');
 assert.equal(businessPreset('Loja de telefones').pt,'Electrónica e acessórios');
 assert.equal(businessPreset('Outro').pt,'Comércio geral');
 assert.ok(presetCategories('Ferragem').includes('Canalização'));
 assert.match(presetSummaryHTML('Boutique','pt'),/Roupa e calçado/);
 assert.match(categorySuggestionsHTML('Ferragem','pt'),/data-category-suggestion="Electricidade"/);
 assert.match(categorySuggestionsHTML('Mercearia','en'),/Quick category suggestions/);
});

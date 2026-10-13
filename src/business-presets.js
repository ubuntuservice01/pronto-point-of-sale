// Presentation-only business presets; never change financial or stock rules.
const presets=[
 {match:/mercearia|minimercado|supermercado|alimenta|grocery/i,icon:'🛒',pt:'Mercearia',en:'Grocery',hintPt:'Artigos alimentares e de consumo diário.',hintEn:'Food and everyday goods.',categories:['Alimentação','Bebidas','Higiene','Limpeza'],units:['un','kg','l','pacote']},
 {match:/ferrag|constru|hardware/i,icon:'🧰',pt:'Ferragem',en:'Hardware',hintPt:'Materiais de construção, ferramentas e acessórios.',hintEn:'Construction materials, tools and hardware.',categories:['Construção','Ferramentas','Electricidade','Canalização'],units:['un','m','saco','rolo']},
 {match:/roup|boutique|moda|calçado|calcado|vestu|fashion/i,icon:'👕',pt:'Roupa e calçado',en:'Fashion',hintPt:'Roupas, calçado e acessórios.',hintEn:'Clothing, footwear and accessories.',categories:['Roupa','Calçado','Acessórios','Moda'],units:['un','par','conjunto']},
 {match:/cosmét|cosmet|beleza|cremes|beauty/i,icon:'🧴',pt:'Cosméticos',en:'Cosmetics',hintPt:'Produtos de beleza e cuidados pessoais.',hintEn:'Beauty and personal-care products.',categories:['Cremes','Cabelo','Perfumes','Higiene'],units:['un','ml','caixa']},
 {match:/papelar|livrar|stationery/i,icon:'📚',pt:'Papelaria',en:'Stationery',hintPt:'Material escolar e de escritório.',hintEn:'School and office supplies.',categories:['Cadernos','Canetas','Livros','Escritório'],units:['un','pacote','caixa']},
 {match:/telefone|telemóvel|telemovel|acessório|acessorio|electrón|eletron/i,icon:'📱',pt:'Electrónica e acessórios',en:'Electronics',hintPt:'Telefones, acessórios e componentes.',hintEn:'Phones, accessories and electronics.',categories:['Telemóveis','Carregadores','Capas','Acessórios'],units:['un','par','caixa']}
];
const generic={icon:'🏪',pt:'Comércio geral',en:'General retail',hintPt:'Organize os seus artigos e venda com rapidez.',hintEn:'Organise products and sell quickly.',categories:['Produtos gerais','Acessórios','Consumíveis'],units:['un','caixa','pacote']};
export function businessPreset(type=''){const value=String(type??'');return presets.find(p=>p.match.test(value))||generic;}
export function presetCategories(type=''){return [...businessPreset(type).categories];}
export function presetSummaryHTML(type='',lang='pt'){
 const preset=businessPreset(type),en=lang==='en';
 return `<div class="business-preset-note"><span class="business-preset-icon" aria-hidden="true">${preset.icon}</span><div><strong>${en?preset.en:preset.pt}</strong><small>${en?preset.hintEn:preset.hintPt}</small></div></div>`;
}
export function categorySuggestionsHTML(type='',lang='pt'){
 const choices=presetCategories(type);
 const escape=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 return `<div class="category-suggestions" role="group" aria-label="${lang==='en'?'Suggested categories':'Categorias sugeridas'}"><small>${lang==='en'?'Quick category suggestions':'Sugestões de categorias'}</small><div>${choices.map(c=>`<button type="button" class="category-suggestion" data-category-suggestion="${escape(c)}">${escape(c)}</button>`).join('')}</div></div>`;
}
export function bindCategorySuggestions(form){
 const field=form?.querySelector('[name="category"]');
 if(!field)return;
 form.querySelectorAll('[data-category-suggestion]').forEach(button=>button.addEventListener('click',()=>{field.value=button.dataset.categorySuggestion;field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();}));
}

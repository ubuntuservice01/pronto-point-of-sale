// Pharmacy-specific presentation and validation; not a prescription authorisation service.
import {esc} from './supabase-shop-core.js';

export const BUSINESS_TYPES=Object.freeze({
 general:'Comércio geral',grocery:'Mercearia',pharmacy:'Farmácia',hardware:'Ferragem',
 fashion:'Roupa e calçado',cosmetics:'Cosméticos',restaurant:'Restaurante',other:'Outro negócio'
});
export function businessTypeLabel(type){return BUSINESS_TYPES[type]||BUSINESS_TYPES.general;}

// Examples for faster data entry, never a substitute for checking the medicine label.
// Values are ordinary strings; the customer can always pick "Outro" and write a custom value.
export const PHARMACY_OTHER='__other__';
export const PHARMACY_SUGGESTIONS=Object.freeze({
 category:['Medicamentos','Primeiros socorros','Material de penso','Produtos de higiene',
  'Dispositivos médicos','Vitaminas e suplementos','Outros produtos farmacêuticos'],
 active_ingredient:['Paracetamol','Ibuprofeno','Amoxicilina','Azitromicina','Metformina',
  'Omeprazol','Loratadina','Cetirizina','Ácido acetilsalicílico','Diclofenaco',
  'Soro fisiológico','Clorexidina','Salbutamol'],
 strength:['5 mg','10 mg','20 mg','50 mg','100 mg','200 mg','250 mg','400 mg',
  '500 mg','1 g','5 mg/ml','10 mg/ml','100 mg/5 ml','125 mg/5 ml','250 mg/5 ml','0,9%'],
 dosage_form:['Comprimido','Cápsula','Comprimido dispersível','Solução oral',
  'Suspensão oral','Xarope','Gotas','Creme','Pomada','Gel','Supositório',
  'Injecção','Pó para solução','Inalador','Spray','Colírio','Solução tópica'],
 presentation:['Caixa de 10 comprimidos','Caixa de 20 comprimidos',
  'Caixa de 30 comprimidos','Blister de 10 comprimidos','Frasco de 30 ml',
  'Frasco de 60 ml','Frasco de 100 ml','Frasco de 120 ml','Frasco de 250 ml',
  'Bisnaga de 15 g','Bisnaga de 30 g','Ampola de 2 ml','Ampola de 5 ml',
  'Pacote de 10 unidades'],
 manufacturer:['Bayer','Cipla','GSK','Hikma','Novartis','Pfizer','Sanofi','Aspen']
});
const medicineFields=[
 ['active_ingredient','Princípio activo',200,2],
 ['strength','Dosagem / concentração',80,1],
 ['dosage_form','Forma farmacêutica',100,2],
 ['presentation','Apresentação / embalagem',120,2],
 ['manufacturer','Fabricante (opcional)',160,0]
];
export function readSuggestedField(data,name,max,min=0){
 const selected=String(data.get(name)??'').trim();
 const isOther=selected===PHARMACY_OTHER;
 const value=(isOther?String(data.get(name+'_other')??''):selected).trim();
 if((isOther&&value.length<2)||value.length<min||value.length>max||
  value===PHARMACY_OTHER)throw Error('Preencha os dados do medicamento: '+name);
 return value;
}
export function readMedicineFields(data){
 const details={};
 for(const [name,,max,min] of medicineFields)
  details[name]=readSuggestedField(data,name,max,min);
 details.requires_prescription=data.has('requires_prescription');
 return details;
}
export function readPharmacyCategory(data){
 return readSuggestedField(data,'category',100,1);
}
export function renderSuggestedField(name,label,options,value='',max=120,min=0){
 const saved=String(value??'');
 const inList=options.includes(saved);
 const isCustom=Boolean(saved)&&!inList;
 const isOptional=min===0;
 const optionsHtml='<option value=""'+(!saved?' selected':'')+'>'+
  (isOptional?'Não informado':'Seleccione uma sugestão')+'</option>'+
  options.map(item=>'<option value="'+esc(item)+'"'+(item===saved?' selected':'')+'>'+esc(item)+'</option>').join('')+
  '<option value="'+PHARMACY_OTHER+'"'+(isCustom?' selected':'')+'>Outro — escrever manualmente</option>';
 return '<div class="pharmacy-suggested-field" data-pharmacy-suggested-field>'+
  '<label>'+esc(label)+'<select name="'+esc(name)+'" data-pharmacy-choice'+
  (min?' required':'')+'>'+optionsHtml+'</select></label>'+
  '<label class="pharmacy-other-field"'+(isCustom?'':' hidden')+'>'+
  'Especifique '+esc(label.toLowerCase())+
  '<input type="text" name="'+esc(name)+'_other" data-pharmacy-other'+
  ' maxlength="'+max+'" minlength="'+Math.max(2,min)+'" placeholder="Escreva conforme a embalagem"'+
  ' value="'+esc(isCustom?saved:'')+'"'+(isCustom?' required':' disabled')+' autocomplete="off"></label>'+
  '</div>';
}
export function renderPharmacyCategory(value='Medicamentos'){
 return renderSuggestedField('category','Categoria',PHARMACY_SUGGESTIONS.category,value,100,1);
}
export function renderMedicineFields(medicine={}){
 const inputs=medicineFields.map(([name,label,max,min])=>
  renderSuggestedField(name,label,PHARMACY_SUGGESTIONS[name],
   medicine[name]??'',max,min)).join('');
 return '<fieldset class="pharmacy-details"><legend>💊 Identificação do medicamento</legend>'+
  '<p class="shop-help">Escolha uma sugestão ou seleccione «Outro» para escrever. Confirme sempre o princípio activo, a dosagem e a apresentação na embalagem. As sugestões são apenas exemplos.</p>'+
  inputs+'<label class="pharmacy-rx"><input type="checkbox" name="requires_prescription"'+
  (medicine.requires_prescription?' checked':'')+'> Medicamento sujeito a receita médica</label></fieldset>';
}

// Pharmacy-specific presentation and validation; not a prescription authorisation service.
import {esc} from './supabase-shop-core.js';

export const BUSINESS_TYPES=Object.freeze({
 general:'Comércio geral',grocery:'Mercearia',pharmacy:'Farmácia',hardware:'Ferragem',
 fashion:'Roupa e calçado',cosmetics:'Cosméticos',restaurant:'Restaurante',other:'Outro negócio'
});
export function businessTypeLabel(type){return BUSINESS_TYPES[type]||BUSINESS_TYPES.general;}
const fields=[
 ['active_ingredient','Princípio activo',200,2],
 ['strength','Dosagem / concentração',80,1],
 ['dosage_form','Forma farmacêutica',100,2],
 ['presentation','Apresentação (ex.: caixa de 20)',120,2],
 ['manufacturer','Fabricante (opcional)',160,0]
];
export function readMedicineFields(data){
 const details={};
 for(const [name,,max,min] of fields){
  const value=String(data.get(name)??'').trim();
  if(value.length<min||value.length>max)throw Error('Preencha os dados do medicamento: '+name);
  details[name]=value;
 }
 details.requires_prescription=data.has('requires_prescription');
 return details;
}
export function renderMedicineFields(medicine={}){
 const inputs=fields.map(([name,label,max,min])=>'<label>'+esc(label)+
  '<input name="'+esc(name)+'" maxlength="'+max+'" minlength="'+min+'" value="'+
  esc(medicine[name]??'')+'" '+(min?'required':'')+' autocomplete="off"></label>').join('');
 return '<fieldset class="pharmacy-details"><legend>💊 Identificação do medicamento</legend>'+
  '<p class="shop-help">Registe a apresentação e a dosagem exactamente como constam na embalagem. O controlo de receita será activado numa fase posterior.</p>'+
  inputs+'<label class="pharmacy-rx"><input type="checkbox" name="requires_prescription"'+
  (medicine.requires_prescription?' checked':'')+'> Medicamento sujeito a receita médica</label></fieldset>';
}

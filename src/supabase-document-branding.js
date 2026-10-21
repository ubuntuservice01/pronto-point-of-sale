// Document identity is scoped to a business; all user-visible strings are escaped.
import {esc} from './supabase-shop-core.js';

export const DOCUMENT_TEMPLATES=Object.freeze({modern:'Moderno',classic:'Clássico',compact:'Compacto'});
const color=(value,fallback)=>/^#[0-9a-fA-F]{6}$/.test(String(value||''))?String(value):fallback;
const clipped=(value,max)=>String(value??'').trim().slice(0,max);
export function normalizeDocumentBranding(raw={},fallbackName=''){
 const v=raw&&typeof raw==='object'?raw:{};
 return {
  displayName:clipped(v.display_name??v.displayName??fallbackName,120),
  phone:clipped(v.phone,48),address:clipped(v.address,220),email:clipped(v.email,180),
  primaryColor:color(v.primary_color??v.primaryColor,'#0E9384'),
  secondaryColor:color(v.secondary_color??v.secondaryColor,'#17354A'),
  template:Object.hasOwn(DOCUMENT_TEMPLATES,v.template)?v.template:'modern',
  footerNote:clipped(v.footer_note??v.footerNote,250),
  logoPath:clipped(v.logo_path??v.logoPath,180),
 };
}
export function serializeDocumentBranding(branding){
 const b=normalizeDocumentBranding(branding);
 if(!b.displayName)throw Error('document_name_required');
 if(b.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))throw Error('document_email_invalid');
 return {display_name:b.displayName,phone:b.phone,address:b.address,email:b.email,
  primary_color:b.primaryColor,secondary_color:b.secondaryColor,template:b.template,
  footer_note:b.footerNote,logo_path:b.logoPath};
}
export function renderDocumentBrandingSettings({branding,logoUrl='',businessName=''}={}){
 const b=normalizeDocumentBranding(branding,businessName);
 const label=(title,name,value,attr='')=>'<label>'+esc(title)+'<input name="'+name+'" value="'+esc(value)+'" '+attr+'></label>';
 const previewLogo=logoUrl?'<img src="'+esc(logoUrl)+'" alt="Logótipo actual do negócio" class="document-brand-logo">':
  '<span class="document-brand-placeholder">Logótipo</span>';
 return '<section class="shop-box document-brand-settings"><h2>Personalização do negócio</h2>'+
  '<p class="shop-help">Identidade aplicada aos extractos, relatórios PDF e ficheiros Excel. Apenas o proprietário pode alterar estas definições.</p>'+
  '<form id="shop-document-settings-form" class="shop-form" enctype="multipart/form-data">'+
  '<div class="document-brand-form-grid">'+
  '<div class="document-brand-fields">'+
  label('Nome comercial','display_name',b.displayName,'required maxlength="120"')+
  label('Endereço','address',b.address,'maxlength="220"')+
  label('Contacto telefónico','phone',b.phone,'type="tel" maxlength="48"')+
  label('E-mail','email',b.email,'type="email" maxlength="180"')+
  '<div class="document-brand-colors">'+
  label('Cor principal','primary_color',b.primaryColor,'type="color"')+
  label('Cor secundária','secondary_color',b.secondaryColor,'type="color"')+'</div>'+
  '<label>Mensagem do rodapé<textarea name="footer_note" maxlength="250" rows="2" placeholder="Ex.: Obrigado pela preferência">'+esc(b.footerNote)+'</textarea></label>'+
  '</div><div class="document-brand-side"><div class="document-brand-upload">'+previewLogo+
  '<label>Logótipo (PNG, JPG ou WebP, até 2 MB)<input type="file" name="document_logo" accept="image/png,image/jpeg,image/webp"></label>'+
  '<p class="shop-help">Se não escolher uma imagem nova, o logótipo actual será mantido.</p></div>'+
  '<fieldset class="document-brand-templates"><legend>Modelo de documento</legend>'+
  Object.entries(DOCUMENT_TEMPLATES).map(([value,title])=>
   '<label class="document-brand-choice"><input type="radio" name="template" value="'+value+'"'+(b.template===value?' checked':'')+'><span>'+esc(title)+'</span></label>').join('')+
  '</fieldset></div></div>'+
  '<div class="document-brand-actions"><button type="button" data-document-preview class="secondary">Pré-visualizar</button>'+
  '<button type="submit" class="shop-submit">Guardar personalização</button></div></form></section>';
}
const present=value=>String(value??'').trim()||'—';
const lines=(meta=[])=>meta.filter(item=>Array.isArray(item)&&item.length>=2)
 .map(([name,value])=>'<div class="document-meta-item"><span>'+esc(name)+'</span><strong>'+esc(present(value))+'</strong></div>').join('');
const sectionTable=section=>{
 const columns=section.columns||[],rows=section.rows||[];
 return '<section class="document-section"><h2>'+esc(section.title||'Registos')+'</h2><table><thead><tr>'+
  columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
  (rows.length?rows.map(row=>'<tr>'+columns.map((_,i)=>'<td>'+esc(row?.[i]??'')+'</td>').join('')+'</tr>').join(''):
   '<tr class="document-empty"><td colspan="'+Math.max(1,columns.length)+'">Sem registos neste período</td></tr>')+
  '</tbody></table></section>';
};
export function brandedDocumentHTML({branding,logoUrl='',title,subtitle='',meta=[],sections=[],summary=[],scopeNote=''}={}){
 const b=normalizeDocumentBranding(branding,'Pronto POS');
 const htmlLogo=logoUrl?'<img class="document-logo" src="'+esc(logoUrl)+'" alt="Logótipo de '+esc(b.displayName)+'">':'';
 const contacts=[b.address,b.phone,b.email].filter(Boolean).map(esc).join(' · ');
 const footer=[b.displayName,contacts,b.footerNote].filter(Boolean).map(esc).join(' · ');
 const css=`@page{size:A4;margin:15mm 15mm 23mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#243440;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.document{--brand:${b.primaryColor};--deep:${b.secondaryColor};max-width:1050px;margin:auto;padding:20px 22px 64px}.document-head{display:flex;align-items:center;gap:20px;padding:19px 18px;border-bottom:4px solid var(--brand);background:#f4f8f9}.document-logo{width:100px;height:82px;object-fit:contain}.document-business{min-width:0;flex:1}.document-business h1{font-size:20px;line-height:1.25;margin:0;color:var(--deep);overflow-wrap:anywhere}.document-business p{font-size:11px;line-height:1.55;color:#52636b;margin:8px 0 0}.document-title{display:flex;align-items:start;justify-content:space-between;gap:16px;margin:23px 0 16px}.document-title h2{font-size:20px;margin:0 0 7px;color:var(--deep)}.document-subtitle{font-size:11px;line-height:1.5;color:#65747c;margin:0}.document-stamp{font-size:10px;background:var(--brand);color:white;padding:8px 11px;border-radius:5px;white-space:nowrap}.document-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:18px}.document-meta-item{background:#f5f8f9;border-left:3px solid var(--brand);padding:10px 12px;min-width:0}.document-meta-item span{display:block;font-size:10px;color:#667782;margin-bottom:4px}.document-meta-item strong{display:block;font-size:12px;overflow-wrap:anywhere}.document-section{margin:21px 0;break-inside:auto}.document-section h2{font-size:13px;color:var(--deep);margin:0 0 9px;border-left:4px solid var(--brand);padding-left:9px}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10px}thead{display:table-header-group}tr{break-inside:avoid}th{background:var(--deep);color:white;font-weight:700;text-align:left;padding:10px 9px;overflow-wrap:anywhere}td{border-bottom:1px solid #e1e8ea;padding:9px;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f7fafb}.document-empty td{color:#687782;text-align:center;font-style:italic}.document-summary{margin:22px 0 8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.document-total{padding:13px 14px;background:#edf6f4;border-top:3px solid var(--brand)}.document-total span{font-size:10px;color:#4d6461;display:block}.document-total strong{font-size:15px;color:var(--deep);display:block;margin-top:5px}.document-note{font-size:10px;color:#65747c;margin-top:16px}.document-foot{position:fixed;bottom:0;left:15mm;right:15mm;text-align:center;border-top:1px solid #cbd5d7;color:#65747c;font-size:9px;padding:8px 0 5px;background:#fff}.document-classic .document-head{background:#fff;border-bottom:2px solid var(--deep);padding-left:0}.document-classic th{background:var(--brand)}.document-classic .document-meta-item{background:#fff;border:1px solid #e1e8ea;border-left:3px solid var(--brand)}.document-compact{padding-top:6px}.document-compact .document-head{padding:11px 12px}.document-compact .document-title{margin:15px 0 10px}.document-compact .document-section{margin:13px 0}.document-compact td,.document-compact th{padding:6px 7px}@media print{.document{padding:0 0 18px}.document-foot{page-break-inside:avoid}}`;
 const now=new Intl.DateTimeFormat('pt-MZ',{timeZone:'Africa/Maputo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
 return '<!doctype html><html lang="pt-MZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title||'Documento')+'</title><style>'+css+'</style></head><body>'+
  '<main class="document document-'+esc(b.template)+'"><header class="document-head">'+htmlLogo+
  '<div class="document-business"><h1>'+esc(b.displayName)+'</h1><p>'+contacts+'</p></div></header>'+
  '<div class="document-title"><div><h2>'+esc(title||'Documento')+'</h2><p class="document-subtitle">'+esc(subtitle)+'</p></div><span class="document-stamp">'+esc(now)+'</span></div>'+
  (meta.length?'<div class="document-meta">'+lines(meta)+'</div>':'')+
  sections.map(sectionTable).join('')+
  (summary.length?'<div class="document-summary">'+summary.map(([name,value])=>'<div class="document-total"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong></div>').join('')+'</div>':'')+
  (scopeNote?'<p class="document-note">'+esc(scopeNote)+'</p>':'')+
  '</main><footer class="document-foot">'+footer+'</footer></body></html>';
}

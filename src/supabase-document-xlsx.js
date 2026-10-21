// Dependency-free OOXML workbook: genuinely formatted .xlsx (not CSV renamed to XLSX).
// Uncompressed ZIP entries remain valid Office files and work without a network CDN.
import {normalizeDocumentBranding} from './supabase-document-branding.js';

const utf8=new TextEncoder();
const xml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const hex=value=>value.replace(/^#/,'').toUpperCase();
const u16=n=>[n&255,n>>>8&255];
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
let crcTable;
function crc32(bytes){
 if(!crcTable)crcTable=Array.from({length:256},(_,i)=>{
  let n=i;for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;
 });
 let c=0xffffffff;for(const x of bytes)c=crcTable[(c^x)&255]^(c>>>8);
 return (c^0xffffffff)>>>0;
}
function zip(entries){
 const out=[],directory=[];let offset=0;
 const append=bytes=>{out.push(bytes);offset+=bytes.length;};
 for(const [name,data] of entries){
  const filename=utf8.encode(name),bytes=typeof data==='string'?utf8.encode(data):data;
  const size=bytes.length,crc=crc32(bytes),start=offset;
  append(Uint8Array.from([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),
   ...u32(crc),...u32(size),...u32(size),...u16(filename.length),...u16(0)]));
  append(filename);append(bytes);
  directory.push({filename,bytes,crc,start});
 }
 const centralStart=offset;
 for(const e of directory){
  append(Uint8Array.from([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),
   ...u16(0),...u16(0),...u32(e.crc),...u32(e.bytes.length),...u32(e.bytes.length),
   ...u16(e.filename.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(e.start)]));
  append(e.filename);
 }
 const centralSize=offset-centralStart;
 append(Uint8Array.from([...u32(0x06054b50),...u16(0),...u16(0),...u16(directory.length),
  ...u16(directory.length),...u32(centralSize),...u32(centralStart),...u16(0)]));
 const bytes=new Uint8Array(offset);let i=0;for(const part of out){bytes.set(part,i);i+=part.length;}
 return bytes;
}
const col=index=>{let result='';for(let v=index+1;v>0;v=Math.floor((v-1)/26))result=String.fromCharCode(65+(v-1)%26)+result;return result;};
const cell=(row,index,value,style=0)=>{
 const ref=col(index)+row;
 if(typeof value==='number'&&Number.isFinite(value))return '<c r="'+ref+'" s="'+style+'"><v>'+value+'</v></c>';
 const v=String(value??'').replace(/\u00a0/g,' ').trim();
 if(/^-?(?:\d{1,3}(?:[ .]\d{3})*|\d+),\d{2} MT$/.test(v)){
  const number=Number(v.replace(/ MT$/,'').replace(/[ .]/g,'').replace(',','.'));
  if(Number.isFinite(number))return '<c r="'+ref+'" s="3"><v>'+number.toFixed(2)+'</v></c>';
 }
 return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
};
function spreadsheetRows({branding,title,period,summary=[],sections=[]}){
 const b=normalizeDocumentBranding(branding,'Pronto POS');
 let r=0;const lines=[],merges=[];
 const line=(items,style)=>{r++;lines.push('<row r="'+r+'">'+items.map((value,i)=>cell(r,i,value,style)).join('')+'</row>');return r;};
 const merged=(value,style)=>{const row=line([value],style);merges.push('A'+row+':D'+row);};
 merged(b.displayName,1);
 merged([b.address,b.phone,b.email].filter(Boolean).join(' · '),0);
 merged(title,1);merged(period,0);
 merged('Documento informativo; não constitui factura fiscal.',0);
 line([],0);
 if(summary.length){merged('RESUMO',2);for(const [name,value] of summary)line([name,value],0);line([],0);}
 for(const section of sections){
  merged((section.title||'Registos').toUpperCase(),2);
  line(section.columns||[],2);
  if(section.rows?.length){for(const item of section.rows)line(item,0);}
  else line(['Sem registos neste período'],0);
  line([],0);
 }
 const rowXml=lines.join(''),mergeXml='<mergeCells count="'+merges.length+'">'+merges.map(range=>'<mergeCell ref="'+range+'"/>').join('')+'</mergeCells>';
 return {rows:rowXml,merges:mergeXml,end:r};
}
const workbook='<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>';
const relationships='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const workbookRels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
function styles(b){
 return '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;MT&quot;"/></numFmts>'+
  '<fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="14"/><color rgb="FF'+hex(b.secondaryColor)+'"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>'+
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF'+hex(b.primaryColor)+'"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F2"/><bgColor indexed="64"/></patternFill></fill></fills>'+
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+ 
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+ 
  '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'+ 
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'+ 
  '</styleSheet>';
}
const imageDrawing='<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="914400" cy="914400"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logótipo do negócio"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
export function buildBrandedXLSX({branding,title='Relatório',period='',summary=[],sections=[],logoPng=null}={}){
 const b=normalizeDocumentBranding(branding,'Pronto POS'),rows=spreadsheetRows({branding:b,title,period,summary,sections});
 const hasLogo=logoPng instanceof Uint8Array&&logoPng.length>8&&logoPng[0]===137&&logoPng[1]===80&&logoPng[2]===78&&logoPng[3]===71;
 const footer=[b.displayName,b.address,b.phone,b.email,b.footerNote].filter(Boolean).join(' · ').slice(0,200);
 const sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/><col min="4" max="4" width="24" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/></cols><sheetData>'+rows.rows+'</sheetData>'+rows.merges+'<pageMargins left="0.3" right="0.3" top="0.55" bottom="0.6" header="0.2" footer="0.3"/><headerFooter><oddFooter>&amp;C'+xml(footer)+' — Página &amp;P de &amp;N</oddFooter></headerFooter>'+(hasLogo?'<drawing r:id="rId1"/>':'')+'</worksheet>';
 const types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+(hasLogo?'<Default Extension="png" ContentType="image/png"/>':'')+'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+(hasLogo?'<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>':'')+'</Types>';
 const entries=[['[Content_Types].xml',types],['_rels/.rels',relationships],['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',workbookRels],['xl/styles.xml',styles(b)],['xl/worksheets/sheet1.xml',sheet]];
 if(hasLogo)entries.push(['xl/worksheets/_rels/sheet1.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'],['xl/drawings/drawing1.xml',imageDrawing],['xl/drawings/_rels/drawing1.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'],['xl/media/image1.png',logoPng]);
 return zip(entries);
}

import {units} from './model.js';
function rowsFromCSV(text){
 const rows=[],row=[];let field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'&&text[i+1]==='"'){field+='"';i++;}else if(char==='"')quoted=false;else field+=char;}
  else if(char==='"')quoted=true;
  else if(char===','||char===';'||char==='\t'){row.push(field.trim());field='';}
  else if(char==='\n'||char==='\r'){if(char==='\r'&&text[i+1]==='\n')i++;row.push(field.trim());if(row.some(Boolean))rows.push([...row]);row.length=0;field='';}
  else field+=char;
 }
 if(quoted)throw Error('csv_quotes');
 row.push(field.trim());if(row.some(Boolean))rows.push(row);
 return rows;
}
export function parseProductCSV(text,existingCodes=[]){
 if(typeof text!=='string'||text.length>300000)throw Error('csv_size');
 const rows=rowsFromCSV(text.replace(/^\uFEFF/,''));
 if(rows.length<2||rows.length>201)throw Error('csv_rows');
 const headers=rows.shift().map(v=>v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_'));
 const aliases={nome:'name',name:'name',categoria:'category',category:'category',codigo:'code',codigo_de_barras:'code',code:'code',preco:'price',price:'price',unidade:'unit',unit:'unit',stock:'stock',estoque:'stock',minimo:'min',min:'min',validade:'expiryDate',expirydate:'expiryDate'};
 const keys=headers.map(h=>aliases[h]||'');
 if(!['name','category','price'].every(k=>keys.includes(k)))throw Error('csv_headers');
 const seen=new Set(existingCodes.filter(Boolean)),products=[],errors=[];
 for(const [i,row] of rows.entries()){
  const raw=Object.fromEntries(keys.map((k,j)=>[k,row[j]??'']).filter(([k])=>k));
  const amount=v=>Number(String(v||'0').replace(/\s/g,'').replace(',','.'));
  const name=raw.name?.trim()||'',category=raw.category?.trim()||'',code=raw.code?.trim()||'';
  const price=amount(raw.price),stock=amount(raw.stock),min=amount(raw.min),unit=raw.unit||'un',expiryDate=raw.expiryDate||'';
  if(!name||name.length>100||!category||category.length>60||code.length>80||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(Math.round(price*100))||Math.abs(Math.round(price*100)-price*100)>1e-6||!units.includes(unit)||!Number.isFinite(stock)||stock<0||!Number.isFinite(min)||min<0||(['un','caixa','pacote','saco','rolo','par','conjunto'].includes(unit)&&!Number.isInteger(stock))|| (expiryDate&&!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate))||(code&&seen.has(code))){
   errors.push(i+2);continue;
  }
  if(code)seen.add(code);
  products.push({name,category,code,price:Math.round(price*100),unit,stock,min,expiryDate,photo:'',emoji:'📦'});
 }
 return {products,errors,total:rows.length};
}

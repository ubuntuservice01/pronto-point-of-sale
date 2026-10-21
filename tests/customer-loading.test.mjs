import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {customerMessage,customerError} from '../src/customer-copy.js';
import {startProntoLoading,stopProntoLoading} from '../src/ui/pronto-loading.js';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Business text never exposes backend terms or transitional status messages',()=>{
 assert.equal(customerMessage('A consultar relatórios do Supabase…'),'');
 assert.equal(customerMessage('A verificar o acesso…'),'');
 assert.equal(customerMessage('A guardar no Supabase…'),'');
 assert.equal(customerMessage('Dados sincronizados com o Supabase.'),'');
 assert.equal(customerMessage('Cliente guardado no Supabase.'),'Cliente guardado no sistema.');
 assert.match(customerMessage('Não foi possível enviar ao Supabase.',{warning:true}),/sistema/);
 assert.doesNotMatch(customerMessage('Erro PGRST116: permission denied for table x',{warning:true}),/PGRST|table/i);
 assert.doesNotMatch(customerError({message:'supabase_unauthorized'}),/supabase/i);
 assert.doesNotMatch(customerError({message:'23505 duplicate key value violates unique constraint'}),/23505|constraint/i);
 assert.equal(customerMessage('Venda concluída.'),'Venda concluída.');
});
test('Visible merchant screens and PIN contain no backend product or database name',()=>{
 for(const path of ['src/supabase-shop-ui.js','src/supabase-pin-lock.js','src/supabase-credit-ui.js',
  'src/supabase-finance-ui.js','src/supabase-inventory-ui.js','src/supabase-returns-ui.js',
  'src/supabase-audit-ui.js','src/supabase-transfers-ui.js','src/supabase-team-management-ui.js',
  'src/supabase-staff-cash-ui.js']){
  const content=source(path);
  // Ignore source imports and internal identifiers; check user-visible prose in quotes.
  const lines=content.split('\n').filter(s=>!/^(?:import|\s*\/\/)/.test(s));
  for(const line of lines){
   const customerFacing=/(?:<p|<h\d|showMessage\(|\.textContent=|<small|<label|shop-help)/.test(line);
   if(customerFacing)assert.doesNotMatch(line,/(?:>[^<]*|['"`][^'"`]*)(?:Supabase|PostgreSQL|A consultar|A verificar|A carregar)\b/i,
    'Technical text in '+path+': '+line.slice(0,120));
  }
 }
});
test('Animated loader displays skeleton, illustrated shopkeeper and genuine progress',async()=>{
 const previous=globalThis.document;
 let lastNode;
 const make=(tag)=>({
  tag, dataset:{},style:{},attributes:new Map(),isConnected:false,className:'',
  classList:{add(){}},
  setAttribute(key,value){this.attributes.set(key,String(value));},
  querySelector(selector){
   if(!this.parts)this.parts=new Map();
   if(!this.parts.has(selector))this.parts.set(selector,{
    textContent:'',style:{},attributes:new Map(),setAttribute(name,value){this.attributes.set(name,String(value));}
   });
   return this.parts.get(selector);
  },
  remove(){this.isConnected=false;}
 });
 globalThis.document={body:{append(node){lastNode=node;node.isConnected=true;}},createElement:make};
 try{
  const loader=startProntoLoading();
  assert.equal(lastNode.querySelector('.pronto-load-number').textContent,'');
  assert.match(lastNode.innerHTML,/pronto-load-ghost/);
  assert.match(lastNode.innerHTML,/pronto-load-arm/);
  assert.match(lastNode.innerHTML,/pronto-load-illustration/);
  await new Promise(r=>setTimeout(r,175));
  assert.ok(Number(lastNode.querySelector('.pronto-load-number').textContent.replace('%',''))<100);
  assert.equal(startProntoLoading(),loader,'reuse same loader across boot/auth');
  await loader.finish();
  assert.equal(lastNode.querySelector('.pronto-load-number').textContent,'100%');
  assert.equal(lastNode.isConnected,false);
  const next=startProntoLoading();
  const fresh=lastNode;
  next.cancel();
  assert.equal(fresh.isConnected,false);
  assert.notEqual(fresh.querySelector('.pronto-load-number').textContent,'100%');
 }finally{stopProntoLoading();globalThis.document=previous;}
});
test('PWA precaches loader and app never prints a fake completion on errors',()=>{
 const boot=source('src/boot.js');
 const auth=source('src/supabase-auth-check-ui.js');
 const sw=source('public/sw.js');
 const merchant=source('src/supabase-shop-dashboard.js');
 assert.match(boot,/startProntoLoading\(\)/);
 assert.match(auth,/client\.restoreSession\(\)/);
 assert.match(auth,/loading\.cancel\(\)/);
 assert.match(auth,/loading\.finish\(\)/);
 assert.match(merchant,/startProntoLoading/);
 assert.match(merchant,/customerMessage/);
 assert.match(merchant,/loading\.cancel\(\)/);
 assert.match(sw,/src\/ui\/pronto-loading\.js/);
 assert.match(sw,/src\/ui\/pronto-loading\.css/);
 assert.match(sw,/src\/customer-copy\.js/);
 assert.match(source('index.html'),/src\/ui\/pronto-loading\.css/);
 const css=source('src/ui/pronto-loading.css');
 assert.match(css,/pronto-stock-arm/);
 assert.match(css,/pronto-skeleton-pulse/);
 assert.match(css,/prefers-reduced-motion/);
});

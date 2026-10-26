import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prontoFeedbackKind,showProntoFeedback,clearProntoFeedback} from '../src/ui/pronto-feedback.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Operation messages distinguish in progress, confirmed success, and failure',()=>{
 assert.equal(prontoFeedbackKind('A guardar fornecedor…'),'loading');
 assert.equal(prontoFeedbackKind('A registar compra e receber stock…'),'loading');
 assert.equal(prontoFeedbackKind('A confirmar pagamento ao fornecedor…'),'loading');
 assert.equal(prontoFeedbackKind('Fornecedor criado com sucesso.'),'success');
 assert.equal(prontoFeedbackKind('Compra registada e stock recebido.'),'success');
 assert.equal(prontoFeedbackKind('Pagamento registado com sucesso.'),'success');
 assert.equal(prontoFeedbackKind('Operação falhou',true),'error');
 assert.equal(prontoFeedbackKind('Abrir a área de vendas'),'info');
});

test('Supplier/purchase/expenses acknowledgement only happens after server confirmation',()=>{
 const s=read('src/supabase-shop-dashboard.js');
 const from=s.indexOf("if(['supplier_save','purchase_receive','purchase_payment','expense_add','expense_schedule_save'].includes(action))");
 const until=s.indexOf("if(['customer_save','credit_policy','debt_payment'].includes(action))",from);
 assert.ok(from>0&&until>from);
 const finance=s.slice(from,until);
 assert.match(finance,/showMessage\(action==='supplier_save'\?'A guardar fornecedor/);
 assert.match(finance,/submitButton\.disabled=true/);
 assert.match(finance,/submitButton\.disabled=false/);
 assert.ok(finance.indexOf('await client.financeAction(')<finance.indexOf('await refresh();render();'));
 assert.ok(finance.indexOf('await refresh();render();')<finance.indexOf('void showSuccessModal('));
 assert.match(finance,/Fornecedor criado com sucesso/);
 assert.match(finance,/Fornecedor actualizado com sucesso/);
 assert.match(finance,/Compra e stock confirmados!/);
 assert.match(finance,/Pagamento registado!/);
 assert.match(finance,/Despesa registada!/);
 assert.match(finance,/confirmText:'OK'/);
 assert.ok(finance.indexOf('void showSuccessModal(')<finance.indexOf('}catch(error){'));
});
test('Manual logout requires user confirmation while automatic security logout stays available',()=>{
 const s=read('src/supabase-shop-dashboard.js');
 assert.match(s,/if\(el\.hasAttribute\('data-shop-logout'\)\)/);
 assert.match(s,/if\(await confirmShop\('Pretende terminar a sessão do Pronto POS\?'\)\)await leave\(\)/);
 assert.match(s,/if\(\['supabase_unauthorized','shop_access_required'\]\.includes\(e\.message\)\)\{await leave\(\)/);
});
test('Feedback is cached offline and accessible; server messages use textContent',()=>{
 const s=read('src/supabase-shop-dashboard.js'),mod=read('src/ui/pronto-feedback.js');
 assert.match(s,/const progress=!warning&&prontoFeedbackKind\(text,false\)==='loading'/);
 assert.match(s,/showProntoFeedback\(progress,\{kind:'loading'\}\)/);
 assert.match(s,/else if\(safe\)showProntoFeedback/);
 assert.match(mod,/content\.textContent=text/);
 assert.match(mod,/aria-live/);
 assert.match(mod,/pronto-feedback-error/);
 const index=read('index.html'),sw=read('public/sw.js');
 assert.match(index,/src\/ui\/pronto-feedback\.css/);
 assert.match(sw,/src\/ui\/pronto-feedback\.js/);
 assert.match(sw,/src\/ui\/pronto-feedback\.css/);
});
test('Toast element can close safely without HTML injection',()=>{
 class StubNode {
  constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.textContent='';}
  setAttribute(n,v){this.attributes[n]=v;}
  append(...nodes){this.children.push(...nodes);}
  addEventListener(){}
  remove(){this.removed=true;}
 }
 const original=globalThis.document;
 const body=new StubNode('body');
 globalThis.document={body,createElement:name=>new StubNode(name)};
 try{
  const toast=showProntoFeedback('<script>alert(1)</script>',{kind:'error',duration:2000});
  assert.equal(toast.attributes.role,'alert');
  assert.equal(toast.children[1].textContent,'<script>alert(1)</script>');
  assert.equal(toast.children.filter(x=>x.tag==='script').length,0);
  clearProntoFeedback();
  assert.equal(toast.removed,true);
 }finally{
  clearProntoFeedback();
  if(original===undefined)delete globalThis.document;
  else globalThis.document=original;
 }
});

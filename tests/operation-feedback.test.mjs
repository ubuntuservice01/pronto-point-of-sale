import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('POS confirms successful operations after server acknowledgement and refreshed data',()=>{
 const c=readFileSync(new URL('../src/supabase-shop-dashboard.js',import.meta.url),'utf8');
 const mod=readFileSync(new URL('../src/ui/pronto-modal.js',import.meta.url),'utf8');
 const start=c.indexOf('const execute=async(action,payload,productPhoto=null)=>');
 const end=c.indexOf('// Close the notification popover',start);
 assert.ok(start>0&&end>start);const action=c.slice(start,end);
 assert.ok(action.indexOf('await refresh();')<action.indexOf('void showSuccessModal('));
 for(const msg of ['Produto cadastrado!','Recebimento confirmado!','Caixa aberto!','Caixa fechado!','Cliente guardado!','Pagamento confirmado!'])assert.ok(action.includes(msg),msg);
 assert.match(action,/void showInfoModal\(\{title:'Operação não concluída'/);
 assert.match(mod,/export function showSuccessModal/);
 assert.match(mod,/kind==='success'\?'✓'/);
 assert.match(c,/showSaleCompleteModal\(receipt\)/);
});
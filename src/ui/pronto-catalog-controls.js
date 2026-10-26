// Common CRUD controls. Only authenticated merchant owners/managers see these.
const allowedKinds=new Set(['product','supplier','customer']);
const safeUuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''))?String(value):'';
export function catalogControls({kind,id,active,revision=null}={}){
 if(!allowedKinds.has(kind)||!safeUuid(id))return '';
 const rev=Number.isInteger(revision)&&revision>=0?' data-catalog-revision="'+revision+'"':'';
 const attrs=' data-catalog-kind="'+kind+'" data-catalog-id="'+safeUuid(id)+'"'+rev;
 return '<div class="pronto-crud-actions" role="group" aria-label="Acções sobre o registo">'+
 '<button type="button" class="pronto-crud-button '+(active?'pronto-crud-archive':'pronto-crud-restore')+'"'+attrs+
 ' data-catalog-action="'+(active?'archive':'restore')+'">'+(active?'Desactivar':'Reactivar')+'</button>'+
 '<button type="button" class="pronto-crud-button pronto-crud-delete"'+attrs+
 ' data-catalog-action="delete">Eliminar</button></div>'+
 '<p class="pronto-crud-caption">Registos ligados a operações serão desactivados para preservar o histórico.</p>';
}
export function catalogFeedback(kind,action,outcome){
 const label={product:'Produto',supplier:'Fornecedor',customer:'Cliente'}[kind]||'Registo';
 if(outcome==='deleted')return {title:label+' eliminado!',message:'O registo foi eliminado definitivamente porque não tinha dependências.'};
 if(outcome==='archived'&&action==='delete')return {title:label+' desactivado!',message:'Existem dados associados. O registo foi desactivado para preservar vendas, compras ou movimentos anteriores; poderá reactivá-lo.'};
 if(outcome==='archived')return {title:label+' desactivado!',message:'Deixou de estar disponível para novas operações. O histórico foi preservado.'};
 if(outcome==='restored')return {title:label+' reactivado!',message:'O registo está novamente disponível para utilização.'};
 return {title:'Operação concluída',message:'A alteração foi confirmada.'};
}

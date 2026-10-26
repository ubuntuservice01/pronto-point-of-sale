// Administration-only lifecycle presentation. Server RPCs own authorization.
export const merchantStates=['all','active','suspended','archived','removed'];
const labels={active:'Activo',suspended:'Suspenso',archived:'Arquivado',removed:'Retirado'};
export function merchantState(business,markers=[]){
 const mark=(Array.isArray(markers)?markers:[]).find(x=>x&&x.id===business?.id)||{};
 if(mark.removed_at)return 'removed';
 if(mark.archived_at)return 'archived';
 return business?.status==='active'?'active':'suspended';
}
export function merchantCounts(businesses=[],markers=[]){
 const result={all:0,active:0,suspended:0,archived:0,removed:0};
 for(const b of businesses){
  if(!b?.id)continue;
  result.all++;
  result[merchantState(b,markers)]++;
 }
 return result;
}
export function merchantLabel(state){return labels[state]||'Estado desconhecido';}
export function merchantOutcome(action,result){
 const state=result?.state||result?.status||null;
 const descriptions={
  business_suspend:'Comerciante suspenso. Os dados e o histórico foram preservados.',
  business_activate:'Comerciante reactivado. Verifique também a validade da licença.',
  business_archive:'Comerciante arquivado e suspenso. Pode restaurá-lo posteriormente.',
  business_remove:'Comerciante retirado da lista activa. Não houve eliminação definitiva de dados.',
  business_restore:'Comerciante restaurado. Continua suspenso; confirme proprietário e licença antes de o reactivar.',
  business_edit:'Dados do comerciante actualizados com sucesso.'
 };
 return descriptions[action]||('Operação concluída'+(state?' ('+state+')':'')+'.');
}

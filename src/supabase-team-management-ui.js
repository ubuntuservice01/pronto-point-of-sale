// Owner-only employee management; PINs/passwords are never shown or changed here.
import {esc} from './supabase-shop-core.js';
const titles={manager:'Gerente',cashier:'Caixa / Vendedor',stock:'Stock',finance:'Financeiro'};
export function normalizeStaffSnapshot(raw){
 if(!raw||!Array.isArray(raw.staff))throw Error('staff_snapshot_invalid');
 return {staff:raw.staff.filter(x=>x&&x.user_id&&titles[x.role]).map(x=>({
  id:String(x.user_id),name:String(x.name||''),email:String(x.email||''),
  role:x.role,active:x.active===true,joinedAt:x.joined_at
 }))};
}
export function renderStaffManagement(snapshot){
 if(!snapshot)return '<p class="shop-help">A carregar colaboradores…</p>';
 const staff=snapshot.staff;
 return '<div class="shop-box"><h3>Colaboradores registados</h3>'+
  '<p class="shop-help">O proprietário pode alterar funções, suspender ou reactivar colaboradores. A suspensão bloqueia imediatamente o acesso aos dados do negócio no servidor. O PIN pessoal não é apresentado.</p>'+
  (staff.length?staff.map(person=>
   '<article class="credit-debt-item"><strong>'+esc(person.name||'Colaborador')+'</strong>'+
   '<small> · '+esc(person.email)+'</small>'+
   '<span class="credit-tag">'+(person.active?'Activo':'Suspenso')+'</span>'+
   '<form class="shop-form" data-shop-form="staff_role_change">'+
   '<input type="hidden" name="user_id" value="'+esc(person.id)+'">'+
   '<label>Função<select name="role" required>'+
   Object.entries(titles).map(([id,title])=>'<option value="'+id+'"'+(id===person.role?' selected':'')+'>'+
    esc(title)+'</option>').join('')+'</select></label>'+
   '<button type="submit">Guardar função</button></form>'+
   '<div class="credit-debt-actions">'+
   (person.active?'<button type="button" data-staff-suspend="'+esc(person.id)+'">Suspender acesso</button>':
    '<button type="button" data-staff-reactivate="'+esc(person.id)+'">Reactivar acesso</button>')+
   '</div></article>').join(''):
   '<p class="shop-help">Ainda não existem colaboradores associados. Utilize o convite acima.</p>')+
  '</div>';
}

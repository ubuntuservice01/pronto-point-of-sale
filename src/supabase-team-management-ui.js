// Owner-only employee management; PINs/passwords are never shown or changed here.
import {esc} from './supabase-shop-core.js';
const titles={manager:'Gerente',cashier:'Caixa / Vendedor',stock:'Stock',finance:'Financeiro'};
const dayNames=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const validTime=s=>typeof s==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
export function normalizeStaffSnapshot(raw){
 if(!raw||!Array.isArray(raw.staff))throw Error('staff_snapshot_invalid');
 return {staff:raw.staff.filter(x=>x&&x.user_id&&titles[x.role]).map(x=>({
  id:String(x.user_id),name:String(x.name||''),email:String(x.email||''),
  role:x.role,active:x.active===true,joinedAt:x.joined_at,
  manualMode:['auto','allow','block'].includes(x.manual_mode)?x.manual_mode:'auto',
  scheduleEnabled:x.schedule_enabled===true,
  startTime:validTime(x.start_time)?x.start_time:'07:00',
  endTime:validTime(x.end_time)?x.end_time:'19:00',
  weekdays:Array.isArray(x.weekdays)?[...new Set(x.weekdays.filter(d=>Number.isInteger(d)&&d>=0&&d<=6))]:[0,1,2,3,4,5,6],
  allowedNow:x.allowed_now===true
 }))};
}
export function renderStaffManagement(snapshot){
 if(!snapshot)return '<p class="shop-help"></p>';
 const staff=snapshot.staff;
 return '<div class="shop-box"><h3>Colaboradores registados</h3>'+
  '<p class="shop-help">Só o proprietário define o acesso individual. Horários seguem a hora de Moçambique. O bloqueio é aplicado no servidor, inclusive a sessões abertas. A autorização manual mantém-se até escolher «Usar horário». Suspensão da conta tem sempre prioridade.</p>'+
  (staff.length?staff.map(person=>
   '<article class="credit-debt-item"><strong>'+esc(person.name||'Colaborador')+'</strong>'+
   '<small> · '+esc(person.email)+'</small>'+
   '<span class="credit-tag">'+(person.allowedNow?'Acesso permitido':'Acesso bloqueado')+'</span>'+
   '<form class="shop-form" data-shop-form="staff_role_change">'+
   '<input type="hidden" name="user_id" value="'+esc(person.id)+'">'+
   '<label>Função<select name="role" required>'+
   Object.entries(titles).map(([id,title])=>'<option value="'+id+'"'+(id===person.role?' selected':'')+'>'+
    esc(title)+'</option>').join('')+'</select></label>'+
   '<button type="submit">Guardar função</button></form>'+
   '<div class="credit-debt-actions">'+
   (person.active?'<button type="button" data-staff-suspend="'+esc(person.id)+'">Suspender conta</button>':
    '<button type="button" data-staff-reactivate="'+esc(person.id)+'">Reactivar conta</button>')+
   '</div>'+
   '<h4>Controlo remoto do acesso</h4>'+
   '<p class="shop-help">Modo: '+esc(person.manualMode==='block'?'Bloqueado manualmente':person.manualMode==='allow'?'Autorizado manualmente':'Horário automático')+'.</p>'+
   '<div class="credit-debt-actions">'+
   '<button type="button" data-staff-access-mode="block" data-staff-user="'+esc(person.id)+'">Bloquear agora</button>'+
   '<button type="button" data-staff-access-mode="allow" data-staff-user="'+esc(person.id)+'">Autorizar agora</button>'+
   '<button type="button" data-staff-access-mode="auto" data-staff-user="'+esc(person.id)+'">Usar horário</button>'+
   '</div>'+
   '<form class="shop-form" data-shop-form="staff_access_schedule">'+
   '<input type="hidden" name="user_id" value="'+esc(person.id)+'">'+
   '<label><input type="checkbox" name="schedule_enabled"'+(person.scheduleEnabled?' checked':'')+'> Activar horário de acesso</label>'+
   '<label>Abre às<input type="time" name="start_time" value="'+esc(person.startTime)+'" required></label>'+
   '<label>Fecha às<input type="time" name="end_time" value="'+esc(person.endTime)+'" required></label>'+
   '<div><strong>Dias de trabalho (início do turno)</strong><div class="credit-debt-actions">'+
   dayNames.map((name,n)=>'<label><input type="checkbox" name="weekdays" value="'+n+'"'+(person.weekdays.includes(n)?' checked':'')+'> '+name+'</label>').join('')+
   '</div></div>'+
   '<button type="submit">Guardar horário</button>'+
   '<small>Turnos que passam da meia-noite também são permitidos. O horário só actua no modo automático.</small></form>'+
   '</article>').join(''):
   '<p class="shop-help">Ainda não existem colaboradores associados. Utilize o formulário de criação de acesso acima.</p>')+
  '</div>';
}

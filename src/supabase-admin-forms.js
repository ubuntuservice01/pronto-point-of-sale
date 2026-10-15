// Forms are presentation only. Supabase RPCs and Edge Functions validate the JWT
// and authorisation again, and keep their own audit trail. No payments are made.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const option=(id,label)=>'<option value="'+esc(id)+'">'+esc(label)+'</option>';
const selectBusinesses=(businesses,includeSuspended=true)=>
 '<select name="business_id" required><option value="">Escolha a empresa</option>'+businesses.filter(b=>includeSuspended||b.status==='active').map(b=>option(b.id,b.name)).join('')+'</select>';
const selectPlans=plans=>'<select name="plan_id" required><option value="">Escolha um plano activo</option>'+
 plans.filter(p=>p.active).map(p=>option(p.id,p.name+' · '+p.durationDays+' dias')).join('')+'</select>';
const roles=[['owner','Proprietário'],['manager','Gerente'],['cashier','Caixa'],['stock','Stock'],['finance','Financeiro']];
const selectRoles=()=>'<select name="role" required>'+roles.map(([v,name])=>option(v,name)).join('')+'</select>';
const block=(title,note,fields,action,submit)=>'<section class="pronto-admin-panel pronto-admin-form-panel"><h3>'+esc(title)+'</h3><p>'+esc(note)+'</p>'+
 '<form data-provision-action="'+action+'" class="pronto-admin-form"><div class="pronto-admin-fields">'+fields+'</div>'+
 '<button type="submit" class="primary">'+esc(submit)+'</button></form></section>';
const field=(label,name,type='text',extra='',required=true)=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" '+extra+(required?' required':'')+'></label>';
const help='<p class="pronto-admin-note">Todas as alterações são verificadas e auditadas no Supabase. Estas acções não alteram vendas, stock ou movimentos financeiros.</p>';

export function renderProvisioningForms(tab,data){
 const businesses=data.businesses||[],plans=data.plans||[];
 if(tab==='businesses'){
  return '<div class="pronto-admin-form-sections">'+block('Registar comerciante',
   'A empresa e a filial principal são criadas no Supabase. A loja começa suspensa até ter proprietário e licença válida.',
   field('Nome da empresa','name','text','minlength="2" maxlength="120"')+
   field('Telefone de contacto','phone','tel','maxlength="60"',false)+
   field('Localização / endereço','address','text','maxlength="250"',false)+
   field('Nome da filial principal','branch_name','text','maxlength="120" placeholder="Principal"',false),
   'business_create','Registar empresa')+'</div>'+help;
 }
 if(tab==='plans'){
  return '<div class="pronto-admin-form-sections">'+block('Criar plano comercial',
   'Defina o valor em meticais e o prazo da subscrição. Nenhuma cobrança automática é efectuada.',
   field('Nome do plano','name','text','minlength="2" maxlength="100"')+
   field('Preço (MT)','price_mzn','number','min="0" max="9999999999" step="0.01" inputmode="decimal"')+
   field('Duração (dias)','duration_days','number','min="1" max="3660" step="1"'),
   'plan_create','Criar plano')+'</div>'+help;
 }
 if(tab==='licenses'){
  if(!businesses.length||!plans.some(p=>p.active))return '<div class="pronto-admin-form-sections"><p class="pronto-admin-note">Registe um comerciante e crie um plano activo antes de atribuir licenças.</p></div>';
  return '<div class="pronto-admin-form-sections">'+block('Atribuir ou renovar licença',
   'Atribuir inicia um novo período. Renovar acrescenta a duração ao prazo existente, ou à data actual se já tiver expirado.',
   '<label>Comerciante'+selectBusinesses(businesses)+'</label>'+
   '<label>Plano'+selectPlans(plans)+'</label>'+
   '<label>Operação<select name="license_action"><option value="license_assign">Atribuir licença</option><option value="license_renew">Renovar licença</option></select></label>',
   'license_manage','Guardar licença')+'</div>'+help;
 }
 if(tab==='members'){
  if(!businesses.length)return '<div class="pronto-admin-form-sections"><p class="pronto-admin-note">Primeiro registe uma empresa para convidar o proprietário e os colaboradores.</p></div>';
  const invite=block('Convidar por email',
   'O Supabase envia um convite para a conta do colaborador. Este deve aceitar e definir a palavra-passe. Não são criadas palavras-passe pelo operador.',
   '<label>Empresa'+selectBusinesses(businesses)+'</label>'+
   field('Nome do colaborador','display_name','text','minlength="2" maxlength="120"')+
   field('Email do colaborador','email','email','maxlength="254"')+
   '<label>Perfil'+selectRoles()+'</label>',
   'member_invite','Enviar convite e associar');
  const associate=block('Associar conta já existente',
   'Se a conta Supabase já existir, confirme o UUID do utilizador em Authentication → Users. Nunca copie a palavra-passe.',
   '<label>Empresa'+selectBusinesses(businesses)+'</label>'+
   field('Nome do colaborador','display_name','text','minlength="2" maxlength="120"')+
   field('UUID da conta existente','user_id','text','maxlength="36" pattern="[0-9a-fA-F-]{36}"')+
   '<label>Perfil'+selectRoles()+'</label>',
   'member_assign','Associar conta');
  const members=businesses.flatMap(b=>(b.members||[]).map(m=>({b,m})));
  const list='<section class="pronto-admin-panel"><h3>Utilizadores associados ('+members.length+')</h3>'+
   (members.length?'<div class="pronto-admin-table-wrap"><table class="pronto-admin-table"><thead><tr><th>Empresa</th><th>Utilizador</th><th>Perfil</th><th>Estado</th></tr></thead><tbody>'+
   members.map(({b,m})=>'<tr><td>'+esc(b.name)+'</td><td><strong>'+esc(m.name||m.email)+'</strong><small>'+esc(m.email)+'</small></td><td>'+esc(roles.find(r=>r[0]===m.role)?.[1]||m.role)+'</td><td>'+(m.active?'Activo':'Inactivo')+'</td></tr>').join('')+
   '</tbody></table></div>':'<p>Ainda não existem contas associadas às empresas.</p>')+'</section>';
  return '<div class="pronto-admin-form-sections">'+invite+associate+list+'</div>'+help;
 }
 return '';
}

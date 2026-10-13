const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words={
 pt:{title:'Gestão de Filiais',tag:'Várias lojas, uma conta',subtitle:'Controle cada loja separadamente e acompanhe os resultados de todas num único painel.',create:'Adicionar filial',main:'Loja matriz',branch:'Filial',open:'Entrar na loja',selected:'Loja seleccionada',active:'Activa',paused:'Suspensa',pause:'Suspender filial',resume:'Reactivar filial',trades:'Vendas válidas',sales:'Vendas líquidas',products:'Produtos',stock:'Unidades em stock',cash:'Caixas abertos',workers:'Colaboradores activos',total:'Total consolidado',count:'Lojas activas',enter:'Entrar',address:'Endereço / bairro',phone:'Contacto da filial',name:'Nome da filial',save:'Criar filial',reason:'Motivo da alteração',confirm:'Confirmar',warning:'A suspensão impede novas operações e novos logins da equipa desta filial, sem apagar registos.',notice:'Cada filial tem vendas, caixa, colaboradores, stock e lotes próprios. O proprietário pode mudar entre filiais. Os dados da matriz não são transferidos automaticamente.',copy:'Copiar catálogo de produtos da matriz, sem stock',copyHint:'Copia nomes, códigos e preços, mas as novas existências começam em zero. Os catálogos podem divergir depois.',noRemote:'A gestão de filiais exige o servidor autenticado. A demonstração não cria filiais reais.',error:'Não foi possível concluir a operação. Verifique os dados ou actualize a página.',done:'Operação concluída.',existing:'Já existe uma filial com este nome.',limit:'Foi atingido o limite inicial de 20 filiais.',root:'Regressar à matriz',select:'Seleccionar loja',overview:'Resultados de todas as lojas',independent:'Dados separados por filial',onlyRoot:'Para adicionar, suspender ou reactivar filiais, regresse primeiro à loja matriz.'},
 en:{title:'Branch Management',tag:'Multiple stores, one account',subtitle:'Run each store separately and see consolidated results in one dashboard.',create:'Add branch',main:'Main shop',branch:'Branch',open:'Open shop',selected:'Selected shop',active:'Active',paused:'Suspended',pause:'Suspend branch',resume:'Reactivate branch',trades:'Valid sales',sales:'Net sales',products:'Products',stock:'Stock units',cash:'Open registers',workers:'Active staff',total:'Consolidated total',count:'Active stores',enter:'Enter',address:'Location / address',phone:'Branch contact',name:'Branch name',save:'Create branch',reason:'Reason for change',confirm:'Confirm',warning:'Suspension blocks transactions and staff logins for this branch without deleting records.',notice:'Each branch has its own sales, cash registers, staff, stock and batches. The owner can switch locations. Main-store data is not automatically transferred.',copy:'Copy main shop product catalogue, without stock',copyHint:'Copies names, codes and prices; stock starts at zero. Branch catalogues can diverge later.',noRemote:'Branch management requires authenticated server mode. No real branches are created in the demo.',error:'Operation failed. Check the details or refresh.',done:'Operation completed.',existing:'A branch with this name exists already.',limit:'The initial 20-branch limit has been reached.',root:'Back to main shop',select:'Select shop',overview:'Results across all stores',independent:'Separate data per branch',onlyRoot:'Switch to the main shop before creating, suspending or reactivating branches.'}
};
const L=lang=>words[lang]||words.pt;
export function branchSwitchHTML({state,tenantId,lang}){
 const group=state.branchGroup,labels=L(lang);
 if(!group?.branches||group.branches.length<1)return '';
 const current=group.branches.find(b=>b.id===tenantId),name=current?.name||labels.main;
 return `<div class="branch-switch"><span class="branch-switch-caption">${labels.select}</span><select id="active-branch" aria-label="${labels.select}">${group.branches.map(b=>`<option value="${esc(b.id)}" ${b.id===tenantId?'selected':''} ${b.active?'':'disabled'}>${b.id===group.rootId?'★ ':''}${esc(b.name)}${b.active?'':' ('+labels.paused+')'}</option>`).join('')}</select><button class="branch-manage-link" type="button" data-page="branches">▦ ${labels.title}</button></div>`;
}
export function branchHighlightsHTML({state,tenantId,lang,money}){
 const group=state.branchGroup,labels=L(lang);
 if(!group?.branches||group.branches.length<2)return '';
 const count=group.branches.filter(b=>b.active).length;
 const net=group.branches.reduce((s,b)=>s+b.netSales,0);
 return `<section class="panel branch-home-overview"><div><p class="eyebrow">${labels.tag}</p><h2>${labels.overview}</h2><p>${count} ${labels.count.toLowerCase()} · ${labels.independent}</p></div><strong>${money(net)}</strong><button class="primary" type="button" data-page="branches">${labels.title} →</button></section>`;
}
export function branchesPage({state,tenantId,lang,money,remote}){
 const labels=L(lang),group=state.branchGroup,branches=group?.branches||[],root=group?.rootId;
 if(!remote||!group)return `<div class="page-heading"><h1>${labels.title}</h1></div><section class="panel"><p class="info-note">${labels.noRemote}</p></section>`;
 const rootSelected=tenantId===root;
 const active=branches.filter(b=>b.active).length,net=branches.reduce((s,b)=>s+b.netSales,0),trans=branches.reduce((s,b)=>s+b.transactions,0),stock=branches.reduce((s,b)=>s+b.stockUnits,0);
 return `<div class="page-heading"><div><p class="eyebrow">PRONTO POS · ${labels.tag}</p><h1 tabindex="-1">${labels.title}</h1><p>${labels.subtitle}</p></div>${rootSelected?`<button type="button" class="primary" id="new-branch">＋ ${labels.create}</button>`:`<button type="button" class="secondary" data-branch-switch="${esc(root)}">← ${labels.root}</button>`}</div>
 <section class="management-stats branch-stats">${[[labels.count,active],[labels.sales,money(net)],[labels.trades,trans],[labels.stock,stock]].map(([title,value])=>`<article><small>${esc(title)}</small><strong>${value}</strong></article>`).join('')}</section>
 <p class="info-note">${labels.notice} ${rootSelected?'':labels.onlyRoot}</p>
 <div class="branch-cards">${branches.map(b=>{
  const selected=tenantId===b.id,matrix=b.id===root;
  return `<article class="branch-card ${selected?'branch-selected':''}"><div class="branch-head"><span class="branch-icon">▦</span><div><span class="eyebrow">${matrix?labels.main:labels.branch}</span><h2>${esc(b.name)}</h2><small>${esc(b.address||'')}${b.phone?' · '+esc(b.phone):''}</small></div><span class="branch-status ${b.active?'branch-active':'branch-paused'}">${b.active?labels.active:labels.paused}</span></div>
   <div class="branch-metrics">${[[labels.sales,money(b.netSales)],[labels.trades,b.transactions],[labels.products,b.productCount],[labels.stock,b.stockUnits],[labels.cash,b.openCashRegisters],[labels.workers,b.activeTeamMembers]].map(([caption,value])=>`<div><small>${caption}</small><strong>${value}</strong></div>`).join('')}</div>
   <div class="branch-actions">${b.active?`<button type="button" class="primary" data-branch-switch="${esc(b.id)}" ${selected?'disabled':''}>${selected?labels.selected:labels.open}</button>`:''}${!matrix&&rootSelected?`<button type="button" class="secondary ${b.active?'danger-outline':''}" data-branch-status="${esc(b.id)}">${b.active?labels.pause:labels.resume}</button>`:''}</div>
  </article>`;
 }).join('')}</div>`;
}
export function bindBranchActions({getState,getTenantId,lang,money,remote,submit,switchBranch,render,modal,toast}){
 const labels=L(lang);
 document.querySelector('#active-branch')?.addEventListener('change',async e=>{
  const target=e.target.value;
  try{await switchBranch(target);}catch{toast(labels.error);render();}
 });
 document.querySelectorAll('[data-branch-switch]').forEach(b=>b.onclick=async()=>{
  if(getTenantId()===b.dataset.branchSwitch)return;
  try{await switchBranch(b.dataset.branchSwitch);}catch{toast(labels.error);}
 });
 if(!remote)return;
 const group=getState().branchGroup,root=group?.rootId;
 if(!group||getTenantId()!==root)return;
 const create=document.querySelector('#new-branch');
 if(create)create.onclick=()=>{
  const d=modal(`<h2>＋ ${labels.create}</h2><form id="branch-create-form"><label>${labels.name}<input name="name" maxlength="100" required></label><label>${labels.address}<input name="address" maxlength="160"></label><label>${labels.phone}<input name="phone" maxlength="40" type="tel"></label><label class="debt-checkbox"><input type="checkbox" name="copyProducts" checked><span>${labels.copy}</span></label><p class="form-hint">${labels.copyHint}</p><button type="submit" class="primary full">${labels.save}</button></form>`);
  d.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const body=new FormData(e.target),button=e.target.querySelector('button');
   const name=String(body.get('name')||'').trim(),address=String(body.get('address')||'').trim(),phone=String(body.get('phone')||'').trim();
   if(!name)return toast(labels.error);button.disabled=true;
   try{await submit('branches',{name,address,phone,copyProducts:body.get('copyProducts')==='on'});d.close();render();toast(labels.done);}
   catch(err){button.disabled=false;toast(err.message==='branch_name_exists'?labels.existing:err.message==='branch_limit'?labels.limit:labels.error);}
  };
 };
 document.querySelectorAll('[data-branch-status]').forEach(b=>b.onclick=()=>{
  const branch=group.branches.find(x=>x.id===b.dataset.branchStatus);
  if(!branch||branch.id===root)return;
  const d=modal(`<h2>${branch.active?labels.pause:labels.resume}</h2><p><strong>${esc(branch.name)}</strong></p><p class="info-note">${labels.warning}</p><form><label>${labels.reason}<textarea name="reason" maxlength="250" required></textarea></label><button class="primary full">${labels.confirm}</button></form>`);
  d.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const reason=String(new FormData(e.target).get('reason')||'').trim(),button=e.target.querySelector('button');
   if(!reason)return toast(labels.error);button.disabled=true;
   try{await submit('branches/status',{branchId:branch.id,active:!branch.active,expectedRevision:branch.revision,reason});d.close();render();toast(labels.done);}
   catch{button.disabled=false;toast(labels.error);}
  };
 });
}

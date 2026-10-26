'use strict';
(() => {
  const toggle=document.querySelector('.menu-toggle');
  const menu=document.querySelector('#menu');
  function closeMenu(){menu?.classList.remove('open');toggle?.setAttribute('aria-expanded','false');toggle?.setAttribute('aria-label','Abrir menu');}
  toggle?.addEventListener('click',()=>{
    const opened=menu?.classList.toggle('open')===true;
    toggle.setAttribute('aria-expanded',String(opened));
    toggle.setAttribute('aria-label',opened?'Fechar menu':'Abrir menu');
  });
  menu?.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
  document.addEventListener('click',event=>{
    if(menu?.classList.contains('open')&&!menu.contains(event.target)&&!toggle?.contains(event.target))closeMenu();
  });
  const year=document.querySelector('#year');if(year)year.textContent=String(new Date().getFullYear());
  // Accessible FAQ: only one expanded at a time, without external libraries.
  const faq=[...document.querySelectorAll('.faq-items details')];
  faq.forEach(details=>details.addEventListener('toggle',()=>{
    if(details.open)faq.forEach(other=>{if(other!==details)other.open=false;});
  }));
})();

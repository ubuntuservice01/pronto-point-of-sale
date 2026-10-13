// Product photographs are compact JPEG thumbnails so even the authenticated
// JSON API (64 KiB per write) and the local offline database can store them.
export const MAX_PHOTO_DATA_URL = 48000;
export function normaliseProductPhoto(value) {
 if (value == null || value === '') return '';
 if (typeof value !== 'string' || value.length > MAX_PHOTO_DATA_URL ||
  !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('invalid_product_photo');
 return value;
}
export function productPhotoHTML(product, escape = value => String(value)) {
 const src = product?.photo;
 try {
  if (src && normaliseProductPhoto(src)) return `<img class="product-photo" src="${escape(src)}" alt="" loading="lazy" decoding="async">`;
 } catch { /* Old or invalid image: keep a safe fallback. */ }
 return `<span class="product-photo-fallback" aria-hidden="true">${escape(product?.emoji || '📦')}</span>`;
}
export function photoFieldHTML(photo = '', en = false, required = false) {
 const current = (() => { try { return normaliseProductPhoto(photo); } catch { return ''; } })();
 return `<div class="product-photo-field">
  <label>${en ? 'Product photograph' : 'Fotografia real do produto'}${required ? ' *' : ''}
   <input type="file" name="productPhoto" accept="image/*" ${required ? 'required' : ''} aria-describedby="product-photo-help">
  </label>
  <div class="product-photo-preview">
   <img data-photo-preview src="${current}" alt="${en ? 'Product photo preview' : 'Pré-visualização da fotografia'}" ${current ? '' : 'hidden'}>
   <span data-photo-placeholder ${current ? 'hidden' : ''}>${en ? 'No photograph selected' : 'Sem fotografia seleccionada'}</span>
  </div>
  ${current ? `<label class="photo-remove"><input name="removeProductPhoto" type="checkbox"> ${en ? 'Remove current photograph' : 'Remover fotografia actual'}</label>` : ''}
  <p class="form-hint" id="product-photo-help">${en ? 'Choose a real product photo from your phone or camera. JPG, PNG and WebP are accepted and automatically resized.' : 'Escolha uma fotografia real do produto na galeria ou câmara. JPG, PNG e WebP são aceites e reduzidos automaticamente.'}</p>
 </div>`;
}
export async function compressProductPhoto(file) {
 if (!file || !file.type?.startsWith('image/') || file.size > 8 * 1024 * 1024) throw Error('photo_file_invalid');
 const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file) : await new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
  img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('photo_file_invalid'));};
  img.src=url;
 });
 try {
  const width=bitmap.width,height=bitmap.height;
  if(!width||!height)throw Error('photo_file_invalid');
  const ratio=Math.min(1,320/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*ratio));
  canvas.height=Math.max(1,Math.round(height*ratio));
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('photo_not_supported');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for (const quality of [0.8,0.68,0.54,0.4,0.28]) {
   const photo=canvas.toDataURL('image/jpeg',quality);
   if(photo.length <= MAX_PHOTO_DATA_URL)return normaliseProductPhoto(photo);
  }
  throw Error('photo_too_complex');
 } finally { if(typeof bitmap.close === 'function') bitmap.close(); }
}
export function bindProductPhoto(form, onError = () => {}) {
 const input=form.querySelector('[name="productPhoto"]');
 if(!input)return;
 input.addEventListener('change',async()=>{
  const file=input.files?.[0];
  form._photoFile=null;form._photoValue=null;
  if(!file)return;
  try {
   const photo=await compressProductPhoto(file);
   if(input.files?.[0]!==file)return;
   form._photoFile=file;form._photoValue=photo;
   const image=form.querySelector('[data-photo-preview]'),placeholder=form.querySelector('[data-photo-placeholder]');
   image.src=photo;image.hidden=false;placeholder.hidden=true;
   const remove=form.querySelector('[name="removeProductPhoto"]');if(remove)remove.checked=false;
  } catch(error) {
   input.value='';onError(error);
  }
 });
}
export async function photoFromForm(form, existing='') {
 if(form.querySelector('[name="removeProductPhoto"]')?.checked)return '';
 const file=form.querySelector('[name="productPhoto"]')?.files?.[0];
 if(!file)return normaliseProductPhoto(existing);
 return file===form._photoFile&&form._photoValue?form._photoValue:compressProductPhoto(file);
}

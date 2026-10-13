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
 return `<div class="product-photo-field" data-photo-required="${required ? 'true' : 'false'}">
  <p class="product-photo-label">${en ? 'Product photograph' : 'Fotografia real do produto'}${required ? ' *' : ''}</p>
  <div class="product-photo-actions" role="group" aria-label="${en ? 'Choose a product photo' : 'Escolher fotografia do produto'}">
   <label class="product-photo-action photo-upload">
    <span aria-hidden="true">▧</span><span>${en ? 'Upload photograph' : 'Carregar fotografia'}</span>
    <input type="file" name="productPhoto" accept="image/*" aria-label="${en ? 'Upload a product photo' : 'Carregar fotografia do produto'}" aria-describedby="product-photo-help">
   </label>
   <label class="product-photo-action photo-camera">
    <span aria-hidden="true">📷</span><span>${en ? 'Take photograph' : 'Tirar fotografia'}</span>
    <input type="file" name="productCamera" accept="image/*" capture="environment" aria-label="${en ? 'Take a product photo with the camera' : 'Tirar fotografia com a câmara'}" aria-describedby="product-photo-help">
   </label>
  </div>
  <div class="product-photo-preview" aria-live="polite">
   <img data-photo-preview src="${current}" alt="${en ? 'Product photo preview' : 'Pré-visualização da fotografia'}" ${current ? '' : 'hidden'}>
   <span data-photo-placeholder ${current ? 'hidden' : ''}>${en ? 'No photograph selected' : 'Sem fotografia seleccionada'}</span>
  </div>
  ${current ? `<label class="photo-remove"><input name="removeProductPhoto" type="checkbox"> ${en ? 'Remove current photograph' : 'Remover fotografia actual'}</label>` : ''}
  <p class="form-hint" id="product-photo-help">${en ? 'Upload an image from the gallery or take a new photo with the phone camera. The rear camera is preferred when available. JPG, PNG and WebP are automatically resized.' : 'Carregue uma imagem da galeria ou tire uma nova fotografia com a câmara do telemóvel. Sempre que possível, será usada a câmara traseira. JPG, PNG e WebP são reduzidos automaticamente.'}</p>
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
// Both capture and gallery feed the same compressed preview and saved photo.
export function bindProductPhoto(form, onError = () => {}) {
 const inputs=[form.querySelector('[name="productPhoto"]'),form.querySelector('[name="productCamera"]')].filter(Boolean);
 if(!inputs.length)return;
 let serial=0;
 const preview=(src)=>{
  const image=form.querySelector('[data-photo-preview]'),placeholder=form.querySelector('[data-photo-placeholder]');
  if(!image||!placeholder)return;
  image.src=src||'';
  image.hidden=!src;
  placeholder.hidden=Boolean(src);
 };
 for(const input of inputs){
  input.addEventListener('change',async()=>{
   const file=input.files?.[0];
   if(!file)return; // Cancelling the camera should not discard the previous photo.
   const token=++serial;
   form._photoInput=input;form._photoFile=null;form._photoValue=null;
   for(const other of inputs)if(other!==input)other.value='';
   try {
    const photo=await compressProductPhoto(file);
    if(serial!==token || input.files?.[0]!==file)return;
    form._photoFile=file;form._photoValue=photo;
    preview(photo);
    const remove=form.querySelector('[name="removeProductPhoto"]');if(remove)remove.checked=false;
   } catch(error) {
    if(serial!==token)return;
    input.value='';form._photoInput=null;form._photoFile=null;form._photoValue=null;
    preview(form.querySelector('[data-photo-preview]')?.getAttribute('data-original-photo')||'');
    onError(error);
   }
  });
 }
 const image=form.querySelector('[data-photo-preview]');
 if(image)image.setAttribute('data-original-photo',image.getAttribute('src')||'');
}
export async function photoFromForm(form, existing='') {
 if(form.querySelector('[name="removeProductPhoto"]')?.checked)return '';
 const selected=[form.querySelector('[name="productPhoto"]'),form.querySelector('[name="productCamera"]')].filter(Boolean);
 const input=selected.find(node=>node===form._photoInput&&node.files?.[0])||selected.find(node=>node.files?.[0]);
 const file=input?.files?.[0];
 if(!file)return normaliseProductPhoto(existing);
 return file===form._photoFile&&form._photoValue?form._photoValue:compressProductPhoto(file);
}

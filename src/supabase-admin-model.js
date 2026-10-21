// Presentation-only data model. The database RPC enforces all admin access.
const uuid = value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const safeText=(value,max=200)=>typeof value==='string'?value.slice(0,max):'';
const nonNegativeInteger=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const validDate=value=>typeof value==='string'&&Number.isFinite(new Date(value).getTime());
export const ADMIN_TABS=['overview','businesses','members','licenses','plans','finance','audit','security'];

export function normalizeAdminOverview(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.businesses)||!Array.isArray(raw.plans))throw Error('supabase_response');
 const businesses=raw.businesses.filter(b=>uuid(b?.id)).map(b=>({
  id:b.id,name:safeText(b.name,120),status:b.status==='suspended'?'suspended':'active',
  phone:safeText(b.phone,45),address:safeText(b.address,160),
  createdAt:validDate(b.created_at)?b.created_at:null,
  branches:nonNegativeInteger(Number(b.branches)),operators:nonNegativeInteger(Number(b.operators)),
  planName:safeText(b.plan_name,120),planId:uuid(b.plan_id)?b.plan_id:null,
  expiresAt:validDate(b.expires_at)?b.expires_at:null,
  licenseCancelled:b.license_cancelled===true,
  members:Array.isArray(b.members)?b.members.filter(m=>uuid(m?.user_id)).map(m=>({
   userId:m.user_id,role:['owner','manager','cashier','stock','finance'].includes(m.role)?m.role:'cashier',
   active:m.active===true,name:safeText(m.name,120),email:safeText(m.email,254)
  })):[]
 }));
 const plans=raw.plans.filter(p=>uuid(p?.id)).map(p=>({
  id:p.id,name:safeText(p.name,120),priceCents:nonNegativeInteger(Number(p.price_cents)),
  durationDays:nonNegativeInteger(Number(p.duration_days)),active:p.active===true
 }));
 return {businesses,plans,generatedAt:validDate(raw.generated_at)?raw.generated_at:null};
}

export function licenseState(business,now=new Date()){
 if(!business.planId||!business.expiresAt)return 'unassigned';
 if(business.licenseCancelled)return 'cancelled';
 if(new Date(business.expiresAt).getTime()<=new Date(now).getTime())return 'expired';
 return 'active';
}

export function adminSummary(data,now=new Date()){
 const businesses=data.businesses||[];
 const states=businesses.map(b=>licenseState(b,now));
 return {
  total:businesses.length,
  activeBusinesses:businesses.filter(b=>b.status==='active').length,
  suspendedBusinesses:businesses.filter(b=>b.status==='suspended').length,
  activeLicenses:states.filter(x=>x==='active').length,
  expiredLicenses:states.filter(x=>x==='expired').length,
  unassignedLicenses:states.filter(x=>x==='unassigned').length,
  cancelledLicenses:states.filter(x=>x==='cancelled').length,
  branches:businesses.reduce((n,b)=>n+b.branches,0),
  operators:businesses.reduce((n,b)=>n+b.operators,0),
  plans:data.plans.length
 };
}
export function matchAdminBusiness(b,term){
 const value=String(term||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!value)return true;
 return [b.name,b.phone,b.address,b.planName,b.id].some(x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(value));
}

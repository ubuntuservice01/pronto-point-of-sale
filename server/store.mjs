import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { addProduct, createSale, can, roles } from '../src/model.js';
import {activeCash,openCash,moveCash,closeCash,attachCashSale,refundSale} from '../src/cash.js';
import {saveCustomer,recordPurchase,recordExpense} from '../src/commercial.js';
import {editInventoryProduct,setInventoryStatus,recordInventoryMovement} from '../src/inventory.js';
export class HttpError extends Error {constructor(status, message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
function passwordHash(password){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
function verify(password,hash){const [salt,key]=hash.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'));}
function validPassword(p){if(typeof p!=='string'||p.length<12||p.length>128)fail(400,'password_policy');}
function text(v,max=100){if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'invalid');return v.trim();}
function username(v){const s=text(v,80).toLowerCase();if(!/^[a-z0-9][a-z0-9._@-]{2,79}$/.test(s))fail(400,'username');return s;}
function optionalBusinessText(v,max){if(v==null)return '';if(typeof v!=='string'||v.length>max)fail(400,'invalid');return v.trim();}
function businessFields(input){
 const name=text(input?.name),type=text(input?.type,60),owner=text(input?.owner);
 const phone=optionalBusinessText(input.phone,40),email=optionalBusinessText(input.email,120),address=optionalBusinessText(input.address,160);
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'invalid_email');
 return {name,type,owner,phone,email,address};
}
function businessReason(input){return text(input?.reason,250);}
const validInventoryId=v=>typeof v==='string'&&v.length>0&&v.length<=80;
const empty=()=>({version:1,tenants:[],products:[],sales:[],members:[],cashSessions:[],refunds:[],customers:[],purchases:[],expenses:[],inventoryEvents:[],stockMovements:[],memberEvents:[]});
export function createStore(path,{bootstrapUser,bootstrapPassword,secure=true,now=()=>Date.now()}={}){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,owner TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,business_id TEXT REFERENCES businesses(id),role TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,device TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payloads(business_id TEXT PRIMARY KEY REFERENCES businesses(id),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,business_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);`);
 // Additive schema migrations preserve businesses and logins from earlier releases.
 if(!db.prepare('PRAGMA table_info(users)').all().some(col=>col.name==='revision'))db.exec('ALTER TABLE users ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
 for(const [name,definition] of [['phone',"TEXT NOT NULL DEFAULT ''"],['email',"TEXT NOT NULL DEFAULT ''"],['address',"TEXT NOT NULL DEFAULT ''"],['active','INTEGER NOT NULL DEFAULT 1'],['revision','INTEGER NOT NULL DEFAULT 0']]){
  if(!db.prepare('PRAGMA table_info(businesses)').all().some(col=>col.name===name))db.exec('ALTER TABLE businesses ADD COLUMN '+name+' '+definition);
 }
 db.exec("CREATE TABLE IF NOT EXISTS business_events(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,before_data TEXT NOT NULL,after_data TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_business_events_recent ON business_events(business_id,created_at DESC);");
 db.exec(`CREATE TABLE IF NOT EXISTS subscription_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,price_cents INTEGER NOT NULL,duration_days INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS subscriptions(business_id TEXT PRIMARY KEY REFERENCES businesses(id),plan_id TEXT NOT NULL REFERENCES subscription_plans(id),started_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0,cancelled INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS license_events(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,plan_id TEXT,previous_expiry_ms INTEGER,new_expiry_ms INTEGER,reason TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_license_events_biz ON license_events(business_id,created_at DESC);`);
 
 const DAY=86400000;
 function licenseFor(id){
  const row=db.prepare('SELECT s.*,p.name AS planName,p.price_cents AS priceCents,p.duration_days AS durationDays FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.business_id=?').get(id);
  if(!row)return {status:'legacy',planId:null,revision:0};
  return {status:row.cancelled?'cancelled':row.expires_ms<=now()?'expired':'active',planId:row.plan_id,planName:row.planName,priceCents:row.priceCents,durationDays:row.durationDays,startedAt:new Date(row.started_ms).toISOString(),expiresAt:new Date(row.expires_ms).toISOString(),revision:row.revision};
 }
 function licenseGate(id){const l=licenseFor(id);if(['expired','cancelled'].includes(l.status))fail(403,'license_'+l.status);}
 function superOnly(user){ready(user);if(user.role!=='super')fail(403,'forbidden');}
 function validatedBusiness(input){
  const id=input?.businessId;
  if(typeof id!=='string'||id.length<1||id.length>80)fail(400,'business_id');
  if(!db.prepare('SELECT id FROM businesses WHERE id=?').get(id))fail(404,'not_found');
  return id;
 }
 function licenseEvent(id,actor,action,planId,prior,next,reason,reference='',eventId=randomUUID()){
  db.prepare('INSERT INTO license_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(eventId,id,actor.id,action,planId,prior,next,reason,reference,new Date(now()).toISOString());
  audit(actor,id,'license_'+action);
 }
 const dummyHash=passwordHash(randomBytes(24).toString('hex'));
 if(bootstrapUser&&bootstrapPassword&&!db.prepare("SELECT id FROM users WHERE role='super'").get()){validPassword(bootstrapPassword);db.prepare('INSERT INTO users(id,username,name,password_hash,business_id,role,must_change,active) VALUES(?,?,?,?,?,?,0,1)').run(randomUUID(),username(bootstrapUser),'Ubuntu Service',passwordHash(bootstrapPassword),null,'super');}
 function audit(user,business,action){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),user?.id||null,business||null,action,new Date(now()).toISOString());}
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
 function publicUser(user){return {id:user.id,name:user.name,username:user.username,tenantId:user.business_id,role:user.role,mustChange:!!user.must_change};}
 function session(token){if(!token)fail(401,'unauthorized');const row=db.prepare('SELECT users.*, sessions.expires, sessions.device AS session_device, businesses.active AS business_active FROM sessions JOIN users ON users.id=sessions.user_id LEFT JOIN businesses ON businesses.id=users.business_id WHERE token_hash=?').get(digest(token));if(!row||row.expires<=now()||!row.active||(row.business_id&&row.business_active!==1))fail(401,'unauthorized');if(row.business_id)licenseGate(row.business_id);return row;}
 function ready(user){if(user.must_change)fail(403,'password_change_required');}
 function businessFor(user,id){ready(user);const business=id||user.business_id;if(!business)fail(400,'business_required');if(user.role!=='super'&&business!==user.business_id)fail(403,'forbidden');const found=db.prepare('SELECT id,active FROM businesses WHERE id=?').get(business);if(!found)fail(404,'not_found');if(user.role!=='super'&&!found.active)fail(403,'business_suspended');if(user.role!=='super')licenseGate(business);return business;}
 function authorize(user,action,id){const business=businessFor(user,id);if(user.role==='super'||!can(user.role,action))fail(403,'forbidden');return business;}
 function snapshot(user,id){ready(user);if(user.role==='super'&&!id)return {...empty(),tenants:db.prepare('SELECT * FROM businesses ORDER BY name COLLATE NOCASE').all().map(b=>({...b,license:licenseFor(b.id)})),plans:db.prepare('SELECT id,name,price_cents AS priceCents,duration_days AS durationDays,active,created_at AS createdAt FROM subscription_plans ORDER BY created_at DESC').all().map(p=>({...p,active:!!p.active})),licenseEvents:db.prepare('SELECT e.id,e.business_id AS tenantId,e.actor_id AS actorId,u.name AS actorName,e.action,e.plan_id AS planId,e.previous_expiry_ms AS previousExpiryMs,e.new_expiry_ms AS newExpiryMs,e.reason,e.reference,e.created_at AS createdAt FROM license_events e JOIN users u ON u.id=e.actor_id ORDER BY e.created_at DESC LIMIT 250').all(),businessEvents:db.prepare('SELECT e.id,e.business_id AS tenantId,e.actor_id AS actorId,u.name AS actorName,e.action,e.before_data AS beforeData,e.after_data AS afterData,e.reason,e.created_at AS createdAt FROM business_events e JOIN users u ON u.id=e.actor_id ORDER BY e.created_at DESC,e.rowid DESC LIMIT 250').all().map(e=>({...e,before:JSON.parse(e.beforeData),after:JSON.parse(e.afterData),beforeData:undefined,afterData:undefined})),auth:publicUser(user)};const business=businessFor(user,id);const row=db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business);const data=JSON.parse(row.data);const members=['owner','super'].includes(user.role)?db.prepare('SELECT id,name,username,role,active,revision,business_id AS tenantId FROM users WHERE business_id=? ORDER BY name COLLATE NOCASE').all(business).map(m=>({...m,active:!!m.active})):[];const actorNames=new Map(db.prepare('SELECT id,name FROM users WHERE business_id=?').all(business).map(m=>[m.id,m.name]));return {...data,
  customers:can(user.role,'customers')?(data.customers||[]):[],
  purchases:can(user.role,'purchases')||can(user.role,'reports')?(data.purchases||[]):[],
  expenses:can(user.role,'expenses')||can(user.role,'reports')?(data.expenses||[]):[],
  products:user.role==='cashier'?(data.products||[]).map(({cost,...product})=>product):(data.products||[]),
  inventoryEvents:can(user.role,'stock')||can(user.role,'reports')?(data.inventoryEvents||[]).map(e=>({...e,actorName:actorNames.get(e.actorId)||null})):[],
  stockMovements:can(user.role,'stock')||can(user.role,'reports')?(data.stockMovements||[]).map(e=>({...e,actorName:actorNames.get(e.actorId||e.userId)||null})):[],
  cashSessions:(can(user.role,'sell')||can(user.role,'reports')||user.role==='super'?(data.cashSessions||[]):[]).filter(s=>user.role!=='cashier'||s.userId===user.id),
  refunds:(can(user.role,'history')||can(user.role,'reports')||user.role==='super'?(data.refunds||[]):[]).filter(r=>user.role!=='cashier'||r.userId===user.id),tenants:[{...db.prepare('SELECT * FROM businesses WHERE id=?').get(business),license:licenseFor(business)}],members,
  memberEvents:can(user.role,'team')?(data.memberEvents||[]).map(e=>({...e,actorName:actorNames.get(e.actorId)||null})):[],
  sales:user.role==='cashier'?data.sales.filter(s=>s.userId===user.id).map(s=>({...s,lines:(s.lines||[]).map(({cost,...line})=>line)})):can(user.role,'history')||user.role==='super'?data.sales:[],auth:publicUser(user)};}
 function save(business,fn){return transaction(()=>{const current=JSON.parse(db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business).data);const next=fn(current);db.prepare('UPDATE payloads SET data=? WHERE business_id=?').run(JSON.stringify(next),business);return next;});}
 function onboard(business,name,role){const login='pos-'+randomBytes(5).toString('hex');const password=randomBytes(15).toString('base64url');const id=randomUUID();db.prepare('INSERT INTO users(id,username,name,password_hash,business_id,role,must_change,active) VALUES(?,?,?,?,?,?,1,1)').run(id,login,text(name),passwordHash(password),business,role);return {username:login,temporaryPassword:password,name,role};}
 return {secure,close:()=>db.close(), publicUser,
 login(login,password,device){const u=db.prepare('SELECT users.*,businesses.active AS business_active FROM users LEFT JOIN businesses ON businesses.id=users.business_id WHERE users.username=?').get(String(login||'').toLowerCase());const match=typeof password==='string'&&password.length<=128&&verify(password,u?.password_hash||dummyHash);if(!u||!u.active||!match||(u.business_id&&u.business_active!==1))fail(401,'invalid_credentials');if(u.business_id)licenseGate(u.business_id);const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),u.id,now()+8*60*60*1000,String(device||'browser').slice(0,80));audit(u,u.business_id,'login');return {token,user:publicUser(u)};},
 session,
 logout(token){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token||''));},
 changePassword(user,current,next,token){validPassword(next);if(!verify(String(current||''),user.password_hash))fail(401,'invalid_credentials');if(current===next)fail(400,'password_policy');transaction(()=>{db.prepare('UPDATE users SET password_hash=?,must_change=0 WHERE id=?').run(passwordHash(next),user.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,digest(token));audit(user,user.business_id,'password_changed');});return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));},
 sessions(user,token){ready(user);return db.prepare('SELECT token_hash,device,expires FROM sessions WHERE user_id=? AND expires>?').all(user.id,now()).map(s=>({id:s.token_hash,device:s.device,expires:s.expires,current:s.token_hash===digest(token)}));},
 revoke(user,id){ready(user);db.prepare('DELETE FROM sessions WHERE token_hash=? AND user_id=?').run(text(id,64),user.id);audit(user,user.business_id,'session_revoked');},
 snapshot,
 planCreate(user,input){
  superOnly(user);
  const name=text(input?.name,80),price=input?.priceCents,days=input?.durationDays;
  if(!Number.isSafeInteger(price)||price<0||price>100000000000||!Number.isSafeInteger(days)||days<1||days>3660)fail(400,'invalid_plan');
  return transaction(()=>{
   if(db.prepare('SELECT id FROM subscription_plans WHERE name=? COLLATE NOCASE').get(name))fail(409,'plan_name_exists');
   db.prepare('INSERT INTO subscription_plans VALUES(?,?,?,?,1,?)').run(randomUUID(),name,price,days,new Date(now()).toISOString());
   audit(user,null,'plan_created');return snapshot(user);
  });
 },
 planStatus(user,input){
  superOnly(user);
  if(typeof input?.planId!=='string'||typeof input?.active!=='boolean')fail(400,'invalid_plan');
  return transaction(()=>{
   const plan=db.prepare('SELECT * FROM subscription_plans WHERE id=?').get(input.planId);
   if(!plan)fail(404,'not_found');
   if(!!plan.active===input.active)fail(400,'no_change');
   db.prepare('UPDATE subscription_plans SET active=? WHERE id=?').run(input.active?1:0,input.planId);
   audit(user,null,input.active?'plan_reactivated':'plan_deactivated');return snapshot(user);
  });
 },
 licenseAssign(user,input){
  superOnly(user);
  const id=validatedBusiness(input),reason=text(input?.reason,250);
  if(typeof input.planId!=='string'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'license_input');
  if(typeof input.operationId!=='string'||input.operationId.length<10||input.operationId.length>80)fail(400,'operation_id');
  return transaction(()=>{
   const duplicate=db.prepare('SELECT * FROM license_events WHERE id=?').get(input.operationId);
   if(duplicate){if(duplicate.business_id===id&&duplicate.action==='assigned'&&duplicate.plan_id===input.planId&&duplicate.reason===reason)return snapshot(user);fail(409,'operation_conflict');}
   const plan=db.prepare('SELECT * FROM subscription_plans WHERE id=?').get(input.planId);
   if(!plan||!plan.active)fail(400,'plan_unavailable');
   const previous=db.prepare('SELECT * FROM subscriptions WHERE business_id=?').get(id);
   if((previous?.revision??0)!==input.expectedRevision)fail(409,'revision_conflict');
   if(previous&&!previous.cancelled&&previous.expires_ms>now())fail(409,'license_already_active');
   const start=now(),end=start+plan.duration_days*DAY;
   if(!Number.isSafeInteger(end)||end>Date.UTC(9999,0,1))fail(400,'license_input');
   if(previous)db.prepare('UPDATE subscriptions SET plan_id=?,started_ms=?,expires_ms=?,cancelled=0,revision=revision+1 WHERE business_id=?').run(plan.id,start,end,id);
   else db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,0,0)').run(id,plan.id,start,end);
   licenseEvent(id,user,'assigned',plan.id,previous?.expires_ms??null,end,reason,'',input.operationId);
   return snapshot(user);
  });
 },
 licenseRenew(user,input){
  superOnly(user);
  const id=validatedBusiness(input),reason=text(input?.reason,250),periods=input?.periods,ref=input?.reference??'';
  if(!Number.isSafeInteger(periods)||periods<1||periods>12||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||typeof ref!=='string'||ref.length>100)fail(400,'license_input');
  if(typeof input.operationId!=='string'||input.operationId.length<10||input.operationId.length>80)fail(400,'operation_id');
  return transaction(()=>{
   const duplicate=db.prepare('SELECT * FROM license_events WHERE id=?').get(input.operationId);
   if(duplicate){if(duplicate.business_id===id&&duplicate.action==='renewed'&&duplicate.reason===reason&&duplicate.reference===ref)return snapshot(user);fail(409,'operation_conflict');}
   const previous=db.prepare('SELECT s.*,p.duration_days FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.business_id=?').get(id);
   if(!previous)fail(404,'license_not_found');
   if(previous.revision!==input.expectedRevision)fail(409,'revision_conflict');
   const base=previous.cancelled?now():Math.max(now(),previous.expires_ms),end=base+previous.duration_days*periods*DAY;
   if(!Number.isSafeInteger(end)||end>Date.UTC(9999,0,1))fail(400,'license_input');
   db.prepare('UPDATE subscriptions SET expires_ms=?,cancelled=0,revision=revision+1 WHERE business_id=?').run(end,id);
   licenseEvent(id,user,'renewed',previous.plan_id,previous.expires_ms,end,reason,ref,input.operationId);
   return snapshot(user);
  });
 },
 licenseCancel(user,input){
  superOnly(user);
  const id=validatedBusiness(input),reason=text(input?.reason,250);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'revision');
  return transaction(()=>{
   const previous=db.prepare('SELECT * FROM subscriptions WHERE business_id=?').get(id);
   if(!previous)fail(404,'license_not_found');
   if(previous.revision!==input.expectedRevision)fail(409,'revision_conflict');
   if(previous.cancelled)fail(400,'no_change');
   db.prepare('UPDATE subscriptions SET cancelled=1,revision=revision+1 WHERE business_id=?').run(id);
   db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(id);
   licenseEvent(id,user,'cancelled',previous.plan_id,previous.expires_ms,previous.expires_ms,reason);
   return snapshot(user);
  });
 },
 createBusiness(user,input){
  ready(user);if(user.role!=='super')fail(403,'forbidden');
  const fields=businessFields(input);
  return transaction(()=>{
   const id=randomUUID();
   db.prepare('INSERT INTO businesses(id,name,type,owner,phone,email,address,active,revision) VALUES(?,?,?,?,?,?,?,1,0)').run(id,fields.name,fields.type,fields.owner,fields.phone,fields.email,fields.address);
   db.prepare('INSERT INTO payloads VALUES(?,?)').run(id,JSON.stringify({...empty(),tenants:[{id,...fields,active:1,revision:0}]}));
   const onboarding=onboard(id,fields.owner,'owner');
   const entry={id:randomUUID(),business:id,actor:user.id,action:'created',before:{},after:fields,reason:'Business onboarding',createdAt:new Date(now()).toISOString()};
   db.prepare('INSERT INTO business_events VALUES(?,?,?,?,?,?,?,?)').run(entry.id,id,entry.actor,entry.action,JSON.stringify(entry.before),JSON.stringify(entry.after),entry.reason,entry.createdAt);
   audit(user,id,'business_created');return {...snapshot(user),onboarding};
  });
 },
 businessEdit(user,input){
  ready(user);if(user.role!=='super')fail(403,'forbidden');
  const id=typeof input?.businessId==='string'?input.businessId:'';
  if(!id||id.length>80)fail(400,'business_id');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'revision');
  const fields=businessFields(input),reason=businessReason(input);
  return transaction(()=>{
   const previous=db.prepare('SELECT * FROM businesses WHERE id=?').get(id);
   if(!previous)fail(404,'not_found');
   if(previous.revision!==input.expectedRevision)fail(409,'revision_conflict');
   const before=Object.fromEntries(Object.keys(fields).map(key=>[key,previous[key]??'']));
   if(Object.keys(fields).every(k=>fields[k]===before[k]))fail(400,'no_change');
   db.prepare('UPDATE businesses SET name=?,type=?,owner=?,phone=?,email=?,address=?,revision=revision+1 WHERE id=?').run(fields.name,fields.type,fields.owner,fields.phone,fields.email,fields.address,id);
   // The owner name here is display metadata. Account identity and password remain unchanged.
   const entry={id:randomUUID(),actor:user.id,action:'edited',before,after:fields,reason,createdAt:new Date(now()).toISOString()};
   db.prepare('INSERT INTO business_events VALUES(?,?,?,?,?,?,?,?)').run(entry.id,id,entry.actor,entry.action,JSON.stringify(before),JSON.stringify(fields),entry.reason,entry.createdAt);
   audit(user,id,'business_edited');return snapshot(user);
  });
 },
 businessStatus(user,input){
  ready(user);if(user.role!=='super')fail(403,'forbidden');
  const id=typeof input?.businessId==='string'?input.businessId:'';
  if(!id||id.length>80||typeof input.active!=='boolean')fail(400,'business_status');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'revision');
  const reason=businessReason(input);
  return transaction(()=>{
   const previous=db.prepare('SELECT id,active,revision FROM businesses WHERE id=?').get(id);
   if(!previous)fail(404,'not_found');
   if(previous.revision!==input.expectedRevision)fail(409,'revision_conflict');
   if(!!previous.active===input.active)fail(400,'no_change');
   db.prepare('UPDATE businesses SET active=?,revision=revision+1 WHERE id=?').run(input.active?1:0,id);
   // Revoking all merchant sessions prevents access across devices immediately.
   db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(id);
   const before={active:!!previous.active},after={active:input.active};
   const entry={id:randomUUID(),actor:user.id,action:'status',before,after,reason,createdAt:new Date(now()).toISOString()};
   db.prepare('INSERT INTO business_events VALUES(?,?,?,?,?,?,?,?)').run(entry.id,id,entry.actor,entry.action,JSON.stringify(before),JSON.stringify(after),reason,entry.createdAt);
   audit(user,id,input.active?'business_reactivated':'business_suspended');return snapshot(user);
  });
 },
 createMember(user,input){
  const business=authorize(user,'team');
  if(!roles.includes(input.role)||input.role==='owner')fail(400,'role');
  return transaction(()=>{
   const onboarding=onboard(business,input.name,input.role);
   const person=db.prepare('SELECT id,name,role FROM users WHERE username=?').get(onboarding.username);
   const row=db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business);
   const data=JSON.parse(row.data);
   data.memberEvents=[{id:randomUUID(),tenantId:business,memberId:person.id,memberName:person.name,actorId:user.id,action:'created',createdAt:new Date(now()).toISOString(),after:{role:person.role,active:true}},...(data.memberEvents||[])];
   db.prepare('UPDATE payloads SET data=? WHERE business_id=?').run(JSON.stringify(data),business);
   audit(user,business,'member_created:'+person.id);
   return {...snapshot(user),onboarding};
  });
 },
 memberEdit(user,input){
  const business=authorize(user,'team');
  const id=typeof input?.memberId==='string'?input.memberId:'';
  if(!id||id.length>80)fail(400,'member_id');
  const name=text(input.name,100),role=input.role;
  if(!roles.includes(role)||role==='owner')fail(400,'role');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'revision');
  return transaction(()=>{
   const target=db.prepare('SELECT id,name,role,active,revision FROM users WHERE id=? AND business_id=?').get(id,business);
   if(!target)fail(404,'not_found');
   if(target.role==='owner'||target.id===user.id)fail(403,'forbidden');
   if(target.revision!==input.expectedRevision)fail(409,'revision_conflict');
   if(target.name===name&&target.role===role)fail(400,'no_change');
   db.prepare('UPDATE users SET name=?,role=?,revision=revision+1 WHERE id=? AND business_id=?').run(name,role,id,business);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
   const data=JSON.parse(db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business).data);
   data.memberEvents=[{id:randomUUID(),tenantId:business,memberId:id,memberName:name,actorId:user.id,action:'edited',createdAt:new Date(now()).toISOString(),before:{name:target.name,role:target.role},after:{name,role}},...(data.memberEvents||[])];
   db.prepare('UPDATE payloads SET data=? WHERE business_id=?').run(JSON.stringify(data),business);
   audit(user,business,'member_updated:'+id);
   return snapshot(user);
  });
 },
 memberStatus(user,input){
  const business=authorize(user,'team');
  const id=typeof input?.memberId==='string'?input.memberId:'';
  if(!id||id.length>80||typeof input.active!=='boolean')fail(400,'member_id');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'revision');
  return transaction(()=>{
   const target=db.prepare('SELECT id,name,role,active,revision FROM users WHERE id=? AND business_id=?').get(id,business);
   if(!target)fail(404,'not_found');
   if(target.role==='owner'||target.id===user.id)fail(403,'forbidden');
   if(target.revision!==input.expectedRevision)fail(409,'revision_conflict');
   if(!!target.active===input.active)fail(400,'no_change');
   db.prepare('UPDATE users SET active=?,revision=revision+1 WHERE id=? AND business_id=?').run(input.active?1:0,id,business);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
   const data=JSON.parse(db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business).data);
   data.memberEvents=[{id:randomUUID(),tenantId:business,memberId:id,memberName:target.name,actorId:user.id,action:'status',createdAt:new Date(now()).toISOString(),before:{active:!!target.active},after:{active:input.active}},...(data.memberEvents||[])];
   db.prepare('UPDATE payloads SET data=? WHERE business_id=?').run(JSON.stringify(data),business);
   audit(user,business,(input.active?'member_reactivated:':'member_deactivated:')+id);
   return snapshot(user);
  });
 },
 product(user,input){
  const business=authorize(user,'stock',input.tenantId);
  try{
   save(business,current=>{
    const next=addProduct(current,business,{name:text(input.name),category:text(input.category,60),code:typeof input.code==='string'?input.code.trim().slice(0,80):'',unit:input.unit,price:input.price,stock:input.stock,min:input.min,emoji:'📦'});
    const product=next.products.find(p=>!current.products.some(x=>x.id===p.id));
    if(!product)fail(500,'product_not_created');
    return {...next,inventoryEvents:[{id:randomUUID(),tenantId:business,productId:product.id,productName:product.name,action:'created',actorId:user.id,createdAt:new Date().toISOString(),reason:'Criação de produto',after:{name:product.name,category:product.category,price:product.price,stock:product.stock}},...(current.inventoryEvents||[])]};
   });
  }catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}
  audit(user,business,'product_created');return snapshot(user);
 },
 productEdit(user,input){
  const business=authorize(user,'stock',input.tenantId);
  try{save(business,current=>editInventoryProduct(current,business,input,user.id));}
  catch(e){if(e instanceof HttpError)throw e;fail(['revision_conflict','operation_conflict','barcode_in_use'].includes(e.message)?409:400,e.message);}
  audit(user,business,'product_edited');return snapshot(user);
 },
 productStatus(user,input){
  const business=authorize(user,'stock',input.tenantId);
  try{save(business,current=>setInventoryStatus(current,business,input,user.id));}
  catch(e){if(e instanceof HttpError)throw e;fail(['revision_conflict','operation_conflict'].includes(e.message)?409:400,e.message);}
  audit(user,business,'product_status_changed');return snapshot(user);
 },
 inventoryMovement(user,input){
  const business=authorize(user,'stock',input.tenantId);
  try{save(business,current=>recordInventoryMovement(current,business,input,user.id));}
  catch(e){if(e instanceof HttpError)throw e;fail(['stock_conflict','operation_conflict'].includes(e.message)?409:400,e.message);}
  audit(user,business,'inventory_'+(input.kind==='adjust'?'adjusted':'received'));return snapshot(user);
 },
 restock(user,input){
  const business=authorize(user,'stock',input.tenantId);
  const qty=Number(input.quantity);
  try{save(business,current=>recordInventoryMovement(current,business,{id:validInventoryId(input.id)?input.id:randomUUID(),productId:input.productId,kind:'receive',quantity:qty,reason:input.reason||'Entrada de stock (legado)'},user.id));}
  catch(e){if(e instanceof HttpError)throw e;fail(['stock_conflict','operation_conflict'].includes(e.message)?409:400,e.message);}
  audit(user,business,'stock_received');return snapshot(user);
 },
 customerSave(user,input){const business=authorize(user,'customers');try{save(business,current=>saveCustomer(current,business,input));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'customer_saved');return snapshot(user);},
 purchaseCreate(user,input){const business=authorize(user,'purchases');try{save(business,current=>recordPurchase(current,business,input,user.id));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'purchase_created');return snapshot(user);},
 expenseCreate(user,input){const business=authorize(user,'expenses');try{save(business,current=>recordExpense(current,business,input,user.id));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'expense_created');return snapshot(user);},
 cashOpen(user,input){const business=authorize(user,'sell');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>openCash(current,context,input.opening));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'cash_open');return snapshot(user);},
 cashMove(user,input){const business=authorize(user,'sell');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>moveCash(current,context,{type:input.type,amount:input.amount,reason:input.reason}));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'cash_move');return snapshot(user);},
 cashClose(user,input){const business=authorize(user,'sell');if(!input.counted||typeof input.counted!=='object'||Array.isArray(input.counted))fail(400,'cash_amount');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>closeCash(current,context,input.counted,input.note));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'cash_close');return snapshot(user);},
 refund(user,input){const business=authorize(user,'refund');if(input.manualConfirmed!==true)fail(400,'refund_not_confirmed');if(typeof input.id!=='string'||input.id.length>80||typeof input.saleId!=='string'||input.saleId.length>80)fail(400,'invalid');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>refundSale(current,context,input));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'refund_recorded');return snapshot(user);},
 sale(user,input){
  const business=authorize(user,'sell',input.tenantId);
  if(typeof input.id!=='string'||input.id.length>80||!Array.isArray(input.cart)||!input.cart.length||input.cart.length>500)fail(400,'invalid');
  const deviceId=user.session_device,context={tenantId:business,userId:user.id,role:user.role,deviceId};
  const signature=JSON.stringify({cart:input.cart,method:input.method,payments:input.payments??null,discount:input.discount??0,customerId:input.customerId??null,received:input.received??null});
  try{save(business,current=>{
    const previous=current.sales.find(s=>s.id===input.id);
    if(previous){
     if(previous.userId!==user.id||(previous.requestSignature?previous.requestSignature!==signature:JSON.stringify(previous.lines.map(l=>({productId:l.productId,quantity:l.quantity})))!==JSON.stringify(input.cart)))fail(409,'idempotency_conflict');
     return current;
    }
    if(!activeCash(current,context))fail(409,'cash_not_open');
    const next=createSale(current,{...input,tenantId:business,role:user.role,userId:user.id,deviceId});
    next.sales[0].syncStatus='confirmed';next.sales[0].requestSignature=signature;
    return attachCashSale(next,context,input.id);
  });}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}
  audit(user,business,'sale_confirmed');return snapshot(user);
 }
 };
}

import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { addProduct, createSale, can, roles } from '../src/model.js';
import {activeCash,openCash,moveCash,closeCash,attachCashSale,refundSale} from '../src/cash.js';
export class HttpError extends Error {constructor(status, message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
function passwordHash(password){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
function verify(password,hash){const [salt,key]=hash.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'));}
function validPassword(p){if(typeof p!=='string'||p.length<12||p.length>128)fail(400,'password_policy');}
function text(v,max=100){if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'invalid');return v.trim();}
function username(v){const s=text(v,80).toLowerCase();if(!/^[a-z0-9][a-z0-9._@-]{2,79}$/.test(s))fail(400,'username');return s;}
const empty=()=>({version:1,tenants:[],products:[],sales:[],members:[],cashSessions:[],refunds:[]});
export function createStore(path,{bootstrapUser,bootstrapPassword,secure=true,now=()=>Date.now()}={}){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,owner TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,business_id TEXT REFERENCES businesses(id),role TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,device TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payloads(business_id TEXT PRIMARY KEY REFERENCES businesses(id),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,business_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const dummyHash=passwordHash(randomBytes(24).toString('hex'));
 if(bootstrapUser&&bootstrapPassword&&!db.prepare("SELECT id FROM users WHERE role='super'").get()){validPassword(bootstrapPassword);db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,0,1)').run(randomUUID(),username(bootstrapUser),'Ubuntu Service',passwordHash(bootstrapPassword),null,'super');}
 function audit(user,business,action){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),user?.id||null,business||null,action,new Date(now()).toISOString());}
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
 function publicUser(user){return {id:user.id,name:user.name,username:user.username,tenantId:user.business_id,role:user.role,mustChange:!!user.must_change};}
 function session(token){if(!token)fail(401,'unauthorized');const row=db.prepare('SELECT users.*, sessions.expires, sessions.device AS session_device FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=?').get(digest(token));if(!row||row.expires<=now()||!row.active)fail(401,'unauthorized');return row;}
 function ready(user){if(user.must_change)fail(403,'password_change_required');}
 function businessFor(user,id){ready(user);const business=id||user.business_id;if(!business)fail(400,'business_required');if(user.role!=='super'&&business!==user.business_id)fail(403,'forbidden');if(!db.prepare('SELECT id FROM businesses WHERE id=?').get(business))fail(404,'not_found');return business;}
 function authorize(user,action,id){const business=businessFor(user,id);if(user.role==='super'||!can(user.role,action))fail(403,'forbidden');return business;}
 function snapshot(user,id){ready(user);if(user.role==='super'&&!id)return {...empty(),tenants:db.prepare('SELECT * FROM businesses').all(),auth:publicUser(user)};const business=businessFor(user,id);const row=db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business);const data=JSON.parse(row.data);const members=['owner','super'].includes(user.role)?db.prepare('SELECT id,name,role,business_id AS tenantId FROM users WHERE business_id=?').all():[];return {...data,cashSessions:(data.cashSessions||[]).filter(s=>user.role!=='cashier'||s.userId===user.id),refunds:(data.refunds||[]).filter(r=>user.role!=='cashier'||r.userId===user.id),tenants:[db.prepare('SELECT * FROM businesses WHERE id=?').get(business)],members,sales:user.role==='cashier'?data.sales.filter(s=>s.userId===user.id):can(user.role,'history')||user.role==='super'?data.sales:[],auth:publicUser(user)};}
 function save(business,fn){return transaction(()=>{const current=JSON.parse(db.prepare('SELECT data FROM payloads WHERE business_id=?').get(business).data);const next=fn(current);db.prepare('UPDATE payloads SET data=? WHERE business_id=?').run(JSON.stringify(next),business);return next;});}
 function onboard(business,name,role){const login='pos-'+randomBytes(5).toString('hex');const password=randomBytes(15).toString('base64url');const id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,1,1)').run(id,login,text(name),passwordHash(password),business,role);return {username:login,temporaryPassword:password,name,role};}
 return {secure,close:()=>db.close(), publicUser,
 login(login,password,device){const u=db.prepare('SELECT * FROM users WHERE username=?').get(String(login||'').toLowerCase());const match=typeof password==='string'&&password.length<=128&&verify(password,u?.password_hash||dummyHash);if(!u||!u.active||!match)fail(401,'invalid_credentials');const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),u.id,now()+8*60*60*1000,String(device||'browser').slice(0,80));audit(u,u.business_id,'login');return {token,user:publicUser(u)};},
 session,
 logout(token){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token||''));},
 changePassword(user,current,next,token){validPassword(next);if(!verify(String(current||''),user.password_hash))fail(401,'invalid_credentials');if(current===next)fail(400,'password_policy');transaction(()=>{db.prepare('UPDATE users SET password_hash=?,must_change=0 WHERE id=?').run(passwordHash(next),user.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,digest(token));audit(user,user.business_id,'password_changed');});return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));},
 sessions(user,token){ready(user);return db.prepare('SELECT token_hash,device,expires FROM sessions WHERE user_id=? AND expires>?').all(user.id,now()).map(s=>({id:s.token_hash,device:s.device,expires:s.expires,current:s.token_hash===digest(token)}));},
 revoke(user,id){ready(user);db.prepare('DELETE FROM sessions WHERE token_hash=? AND user_id=?').run(text(id,64),user.id);audit(user,user.business_id,'session_revoked');},
 snapshot,
 createBusiness(user,input){ready(user);if(user.role!=='super')fail(403,'forbidden');return transaction(()=>{const id=randomUUID();const name=text(input.name),type=text(input.type,60),owner=text(input.owner);db.prepare('INSERT INTO businesses VALUES(?,?,?,?)').run(id,name,type,owner);const data={...empty(),tenants:[{id,name,type,owner}]};db.prepare('INSERT INTO payloads VALUES(?,?)').run(id,JSON.stringify(data));const onboarding=onboard(id,owner,'owner');audit(user,id,'business_created');return {...snapshot(user),onboarding};});},
 createMember(user,input){const business=authorize(user,'team');if(!roles.includes(input.role)||input.role==='owner')fail(400,'role');return transaction(()=>{const onboarding=onboard(business,input.name,input.role);audit(user,business,'member_created');return {...snapshot(user),onboarding};});},
 product(user,input){const business=authorize(user,'stock',input.tenantId);try{save(business,current=>addProduct(current,business,{name:text(input.name),category:text(input.category,60),code:typeof input.code==='string'?input.code.slice(0,80):'',unit:input.unit,price:input.price,stock:input.stock,min:input.min,emoji:'📦'}));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'product_created');return snapshot(user);},
 restock(user,input){const business=authorize(user,'stock',input.tenantId);const qty=Number(input.quantity);if(!Number.isFinite(qty)||qty<=0)fail(400,'quantity');save(business,current=>{const p=current.products.find(p=>p.id===input.productId&&p.tenantId===business);if(!p)fail(404,'not_found');if(['un','caixa','pacote','saco','rolo','par','conjunto'].includes(p.unit)&&!Number.isInteger(qty))fail(400,'quantity');return {...current,products:current.products.map(p=>p.id===input.productId?{...p,stock:Math.round((p.stock+qty)*1000)/1000}:p)};});audit(user,business,'stock_received');return snapshot(user);},
 cashOpen(user,input){const business=authorize(user,'sell');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>openCash(current,context,input.opening));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'cash_open');return snapshot(user);},
 cashMove(user,input){const business=authorize(user,'sell');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>moveCash(current,context,{type:input.type,amount:input.amount,reason:input.reason}));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'cash_move');return snapshot(user);},
 cashClose(user,input){const business=authorize(user,'sell');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>closeCash(current,context,input.counted,input.note));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'cash_close');return snapshot(user);},
 refund(user,input){const business=authorize(user,'refund');if(typeof input.id!=='string'||input.id.length>80||typeof input.saleId!=='string'||input.saleId.length>80)fail(400,'invalid');const context={tenantId:business,userId:user.id,role:user.role,deviceId:user.session_device};try{save(business,current=>refundSale(current,context,input));}catch(e){if(e instanceof HttpError)throw e;fail(400,e.message);}audit(user,business,'refund_recorded');return snapshot(user);},
 sale(user,input){
  const business=authorize(user,'sell',input.tenantId);
  if(typeof input.id!=='string'||input.id.length>80||!Array.isArray(input.cart)||!input.cart.length||input.cart.length>500)fail(400,'invalid');
  const deviceId=user.session_device,context={tenantId:business,userId:user.id,role:user.role,deviceId};
  const signature=JSON.stringify({cart:input.cart,method:input.method,payments:input.payments??null,discount:input.discount??0,received:input.received??null});
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

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {HttpError} from './store.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
export function createApp(store,{root=process.cwd(),origin}={}){
 root=resolve(root);const attempts=new Map();
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const cookie=(token,remove=false)=>`pronto_session=${remove?'':token}; HttpOnly; SameSite=Strict; Path=/; ${store.secure?'Secure; ':''}Max-Age=${remove?0:28800}`;
 return createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
 if(!['GET','POST'].includes(req.method))throw new HttpError(405,'method');
 if(req.method==='POST'){const expected=origin||`${store.secure?'https':'http'}://${req.headers.host}`;if(req.headers.origin!==expected)throw new HttpError(403,'origin');if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'content_type');}
 let input={};if(req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw new HttpError(413,'body_too_large');}try{input=JSON.parse(body||'{}');}catch{throw new HttpError(400,'json');}if(!input||Array.isArray(input)||typeof input!=='object')throw new HttpError(400,'json');}
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('pronto_session='))?.slice(15);
 const path=url.pathname;
 if(path==='/api/login'&&req.method==='POST'){const key=req.socket.remoteAddress;const time=Date.now();for(const [k,v]of attempts)if(v.until<time)attempts.delete(k);const rate=attempts.get(key)||{count:0,until:time+600000};if(rate.count>=10)throw new HttpError(429,'rate_limit');rate.count++;attempts.set(key,rate);const result=store.login(input.username,input.password,input.deviceId);attempts.delete(key);res.setHeader('Set-Cookie',cookie(result.token));send(res,200,result.user);return;}
 const user=store.session(token);
 if(path==='/api/me'&&req.method==='GET')send(res,200,store.publicUser(user));
 else if(path==='/api/logout'&&req.method==='POST'){store.logout(token);res.setHeader('Set-Cookie',cookie('',true));send(res,200,{ok:true});}
 else if(path==='/api/password'&&req.method==='POST')send(res,200,store.changePassword(user,input.currentPassword,input.newPassword,token));
 else if(path==='/api/sessions'&&req.method==='GET')send(res,200,store.sessions(user,token));
 else if(path==='/api/sessions/revoke'&&req.method==='POST'){store.revoke(user,input.id);send(res,200,{ok:true});}
 else if(path==='/api/state'&&req.method==='GET')send(res,200,store.snapshot(user,url.searchParams.get('tenantId')));
 else if(path==='/api/businesses'&&req.method==='POST')send(res,201,store.createBusiness(user,input));
 else if(path==='/api/businesses/edit'&&req.method==='POST')send(res,200,store.businessEdit(user,input));
 else if(path==='/api/businesses/status'&&req.method==='POST')send(res,200,store.businessStatus(user,input));
 else if(path==='/api/plans'&&req.method==='POST')send(res,201,store.planCreate(user,input));
 else if(path==='/api/plans/status'&&req.method==='POST')send(res,200,store.planStatus(user,input));
 else if(path==='/api/licenses/assign'&&req.method==='POST')send(res,200,store.licenseAssign(user,input));
 else if(path==='/api/licenses/renew'&&req.method==='POST')send(res,200,store.licenseRenew(user,input));
 else if(path==='/api/licenses/cancel'&&req.method==='POST')send(res,200,store.licenseCancel(user,input));
 else if(path==='/api/members'&&req.method==='POST')send(res,201,store.createMember(user,input));
 else if(path==='/api/members/edit'&&req.method==='POST')send(res,200,store.memberEdit(user,input));
 else if(path==='/api/members/status'&&req.method==='POST')send(res,200,store.memberStatus(user,input));
 else if(path==='/api/products'&&req.method==='POST')send(res,201,store.product(user,input));
 else if(path==='/api/products/edit'&&req.method==='POST')send(res,200,store.productEdit(user,input));
 else if(path==='/api/products/status'&&req.method==='POST')send(res,200,store.productStatus(user,input));
 else if(path==='/api/stock/movements'&&req.method==='POST')send(res,200,store.inventoryMovement(user,input));
 else if(path==='/api/batches/receive'&&req.method==='POST')send(res,200,store.batchReceive(user,input));
 else if(path==='/api/batches/adjust'&&req.method==='POST')send(res,200,store.batchAdjust(user,input));
 else if(path==='/api/stock'&&req.method==='POST')send(res,200,store.restock(user,input));
 else if(path==='/api/customers'&&req.method==='POST')send(res,200,store.customerSave(user,input));
 else if(path==='/api/purchases'&&req.method==='POST')send(res,201,store.purchaseCreate(user,input));
 else if(path==='/api/expenses'&&req.method==='POST')send(res,201,store.expenseCreate(user,input));
 else if(path==='/api/cash/open'&&req.method==='POST')send(res,200,store.cashOpen(user,input));
 else if(path==='/api/cash/move'&&req.method==='POST')send(res,200,store.cashMove(user,input));
 else if(path==='/api/cash/close'&&req.method==='POST')send(res,200,store.cashClose(user,input));
 else if(path==='/api/refunds'&&req.method==='POST')send(res,201,store.refund(user,input));
 else if(path==='/api/sales'&&req.method==='POST')send(res,201,store.sale(user,input));
 else throw new HttpError(404,'not_found');return;
 }
 if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'method');
 const pathname=decodeURIComponent(url.pathname);if(pathname!=='/'&&!/^\/(src\/[\w.-]+\.(js|css)|icon\.svg|manifest\.webmanifest|sw\.js|index\.html)$/.test(pathname))throw new HttpError(404,'not_found');
 const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep))throw new HttpError(403,'forbidden');let data;try{data=await readFile(file);}catch{data=await readFile(resolve(root,'public','.'+pathname));}if(extname(file)==='.html')data=Buffer.from(data.toString().replace('name="pronto-mode" content="demo"','name="pronto-mode" content="server"'));res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){if(!(e instanceof HttpError)&&e.code!=='ENOENT')console.error('Pronto POS request failed:',e.name);send(res,e.status||(e.code==='ENOENT'?404:500),{error:e.status?e.message:e.code==='ENOENT'?'not_found':'server_error'});}});
}

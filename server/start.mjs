import {createStore} from './store.mjs';
import {createApp} from './http.mjs';
const production=process.env.NODE_ENV==='production';
if(production&&(!process.env.APP_ORIGIN||!process.env.APP_ORIGIN.startsWith('https://')))throw Error('APP_ORIGIN is required in production');
const store=createStore(process.env.DATABASE_PATH||'var/pronto.sqlite',{bootstrapUser:process.env.UBUNTU_ADMIN_USERNAME,bootstrapPassword:process.env.UBUNTU_ADMIN_PASSWORD,secure:production});
const server=createApp(store,{root:process.env.STATIC_ROOT||process.cwd(),origin:process.env.APP_ORIGIN});
server.listen(Number(process.env.PORT||5173),process.env.HOST||'127.0.0.1',()=>console.log('Pronto POS server ready. Use the configured Ubuntu account; /?demo=1 opens the local demo.'));
function shutdown(){server.close(()=>{store.close();process.exit(0);});}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

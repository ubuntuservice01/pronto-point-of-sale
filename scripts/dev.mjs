import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
export function parseArguments(args,env=process.env){
 let directory='.',port=Number(env.PORT||5173),host=env.HOST||'0.0.0.0';
 for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--port')port=Number(args[++i]);else if(arg.startsWith('--port='))port=Number(arg.slice(7));else if(arg==='--host'){host=args[i+1]&&!args[i+1].startsWith('-')?args[++i]:'0.0.0.0';}else if(arg.startsWith('--host='))host=arg.slice(7);else if(arg==='--strictPort'||arg==='--')continue;else if(arg.startsWith('-'))throw Error(`Unknown option: ${arg}`);else directory=arg;}
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');return {root:resolve(directory),port,host};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
export function createPreviewServer(root){return createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}let data;try{data=await readFile(file);}catch{data=await readFile(resolve(root,'public','.'+pathname));}res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end('Not found');}});}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){const {root,port,host}=parseArguments(process.argv.slice(2));createPreviewServer(root).listen(port,host,()=>console.log(`Pronto POS → http://${host}:${port}`));}

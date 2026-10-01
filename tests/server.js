import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const pathname=decodeURIComponent(url.pathname).replace(/^\/health-log(?=\/)/,'');
    const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
    if(!file.startsWith(root) || !types[path.extname(file)]){res.writeHead(404).end();return;}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'}).end(content);
  }catch{res.writeHead(404).end();}
}).listen(4173,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4173/health-log/'));

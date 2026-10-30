import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
let testDeploymentAVersion=3;
http.createServer(async(req,res)=>{
  const requestUrl=new URL(req.url,'http://localhost');
  const pathname=decodeURIComponent(requestUrl.pathname);
  if(pathname==='/__test_deployment_control'){
    const version=Number(requestUrl.searchParams.get('version'));
    if(!Number.isInteger(version)||version<3||version>9){res.writeHead(400).end();return;}
    testDeploymentAVersion=version;res.writeHead(204).end();return;
  }
  // Browser tests exercise independent Pages deployments on one origin.
  const deployment=pathname.match(/^\/__test_deployment_(a|b)\/(.*)$/);
  const relative=deployment?deployment[2]+(pathname.endsWith('/')?'index.html':''):pathname.slice(1)+(pathname.endsWith('/')?'index.html':'');
  const fixture=deployment?.[1]==='b'&&relative.startsWith('conference/');
  const file=resolve(root,fixture?'fixtures/multiple-poster-sessions/'+relative.slice('conference/'.length):relative);
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{
    let body=await readFile(file);
    if(fixture&&relative==='conference/conference.json'){
      const conference=JSON.parse(body);conference.id='conference-companion-demo';body=Buffer.from(JSON.stringify(conference));
    }
    if(fixture&&relative==='conference/conference-manifest.json'){
      const conference=JSON.parse(await readFile(resolve(root,'fixtures/multiple-poster-sessions/conference.json')));
      conference.id='conference-companion-demo';const manifest=JSON.parse(body);
      manifest.checksums['conference.json']=createHash('sha256').update(JSON.stringify(conference)).digest('hex');body=Buffer.from(JSON.stringify(manifest));
    }
    if(deployment?.[1]==='a'&&relative==='conference/conference-manifest.json'&&testDeploymentAVersion!==3){
      const manifest=JSON.parse(body);manifest.dataVersion=testDeploymentAVersion;
      manifest.publishedAt=new Date(Date.UTC(2035,0,testDeploymentAVersion)).toISOString();body=Buffer.from(JSON.stringify(manifest));
    }
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404).end();}
}).listen(8080,'127.0.0.1');

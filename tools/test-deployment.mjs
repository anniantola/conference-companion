import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageZip} from '../src/builder/package.js';
import {rowsFromStructuredPackage} from '../src/builder/importers.js';
import {readStoredZip,textEntry} from '../src/zip.js';
import {engineRoot,attendeeFiles,verifyStagedDeployment} from './deployment-engine.mjs';
for(const base of ['conference','fixtures/multi-track-no-posters','fixtures/multiple-poster-sessions']){
 const pkg={};for(const name of ['conference','programme','people','locations','branding'])pkg[name]=JSON.parse(await readFile(`${base}/${name}.json`,'utf8'));
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async path=>{if(String(path).endsWith('.nojekyll'))return new Response('',{status:404});try{return new Response(await readFile(String(path).replace(/^\.\//,'')));}catch{return new Response('',{status:404});}};
 let zip;
 try{zip=await packageZip({conference:pkg.conference,rows:rowsFromStructuredPackage(pkg),branding:pkg.branding,features:pkg.conference.features,identityRegistry:{people:{},locations:{},tracks:{}},dataVersion:1});}finally{globalThis.fetch=originalFetch;}
 const entries=await readStoredZip(zip.blob);
 assert.ok(entries.has('tools/deployment.mjs'));assert.ok(entries.has('.github/workflows/deploy.yml'));assert.ok(entries.has('.nojekyll'));
 for(const path of attendeeFiles.filter(path=>path!=='tools/deployment.mjs'))assert.ok(!entries.has(path),`Engine file duplicated in deployment repository: ${path}`);
 assert.ok(![...entries.keys()].some(path=>path.startsWith('schemas/')||path.startsWith('assets/fonts/')));assert.ok(!entries.has('assets/utu-template.zip'),'Shared engine assets must not be duplicated in conference packages');
 const webManifest=JSON.parse(textEntry(entries,'manifest.webmanifest'));assert.equal(webManifest.id,'./');assert.equal(webManifest.start_url,'./');assert.equal(webManifest.scope,'./');assert.equal(webManifest.display,'standalone');
 const workflow=textEntry(entries,'.github/workflows/deploy.yml');assert.match(workflow,/path: "_site"/);assert.match(workflow,/run: npm test/);assert.match(workflow,/repository: anniantola\/conference-companion/);assert.match(workflow,/ref: f074811735dbdd1b179488a35b69e45003fe9323/);assert.match(workflow,/run: npm run stage/);
 assert.ok(![...entries.keys()].some(x=>x.includes('node_modules')||x.includes('sourceFiles')));
 const target=await mkdtemp(join(tmpdir(),'conference-deployment-'));
 try{
   for(const [path,data] of entries){await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),data);}
   const env={...process.env,CONFERENCE_ENGINE_DIR:engineRoot};
   execFileSync(process.execPath,['tools/deployment.mjs','check'],{cwd:target,env,stdio:'pipe'});
   execFileSync(process.execPath,['tools/deployment.mjs','stage'],{cwd:target,env,stdio:'pipe'});
   await verifyStagedDeployment(target,join(target,'_site'));
   assert.ok((await readFile(join(target,'_site','service-worker.js'),'utf8')).includes('encodeURIComponent(self.registration.scope)'));
 }finally{await rm(target,{recursive:true,force:true});}
}
console.log('All three conference deployment ZIPs validate after extraction');

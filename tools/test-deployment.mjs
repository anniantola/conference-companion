import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {packageZip} from '../src/builder/package.js';
import {rowsFromStructuredPackage} from '../src/builder/importers.js';
import {readStoredZip,textEntry} from '../src/zip.js';
for(const base of ['conference','fixtures/multi-track-no-posters','fixtures/multiple-poster-sessions']){
 const pkg={};for(const name of ['conference','programme','people','locations','branding'])pkg[name]=JSON.parse(await readFile(`${base}/${name}.json`,'utf8'));
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async path=>{if(String(path).endsWith('.nojekyll'))return new Response('',{status:404});try{return new Response(await readFile(String(path).replace(/^\.\//,'')));}catch{return new Response('',{status:404});}};
 let zip;
 try{zip=await packageZip({conference:pkg.conference,rows:rowsFromStructuredPackage(pkg),branding:pkg.branding,features:pkg.conference.features,identityRegistry:{people:{},locations:{},tracks:{}},dataVersion:1});}finally{globalThis.fetch=originalFetch;}
 const entries=await readStoredZip(zip.blob);
 assert.ok(entries.has('service-worker.js'));assert.ok(entries.has('.github/workflows/deploy.yml'));assert.ok(entries.has('.nojekyll'));
 const workflow=textEntry(entries,'.github/workflows/deploy.yml');assert.match(workflow,/path: "_site"/);assert.match(workflow,/run: npm test/);
 assert.ok(![...entries.keys()].some(x=>x.includes('node_modules')||x.includes('sourceFiles')));
 const target=await mkdtemp(join(tmpdir(),'conference-deployment-'));
 try{
   for(const [path,data] of entries){await mkdir(dirname(join(target,path)),{recursive:true});await writeFile(join(target,path),data);}
   for(const tool of ['schema-check','validate-conference'])execFileSync(process.execPath,[`tools/${tool}.mjs`,'conference'],{cwd:target,stdio:'pipe'});
   // Every explicit generated workflow copy source must exist in the archive.
   const copy=workflow.match(/cp -r (.+) _site\//)[1].split(' ');
   for(const source of copy)assert.ok([...entries.keys()].some(name=>name===source||name.startsWith(source+'/')||(source==='icon-*.png'&&/^icon-\d+\.png$/.test(name))),`Missing generated staging source ${source}`);
 }finally{await rm(target,{recursive:true,force:true});}
}
console.log('All three conference deployment ZIPs validate after extraction');

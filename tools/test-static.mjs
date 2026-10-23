import fs from 'node:fs';

function assert(condition,message){if(!condition)throw new Error(message);}
function ids(html){return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);}
function checkHtml(file){
  const html=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
  const all=ids(html),seen=new Set(),dupes=[];
  for(const id of all){if(seen.has(id))dupes.push(id);seen.add(id);}
  assert(!dupes.length,`${file}: duplicate id(s): ${[...new Set(dupes)].join(', ')}`);
  for(const m of html.matchAll(/<img\b([^>]*)>/gi))assert(/\balt\s*=/.test(m[1]),`${file}: image without alt attribute`);
  for(const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)){
    const attrs=m[1],text=m[2].replace(/<[^>]+>/g,'').trim();
    assert(text||/aria-label\s*=/.test(attrs),`${file}: button without accessible text/aria-label`);
  }
}

checkHtml('index.html');
checkHtml('builder.html');

const sw=fs.readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');
for(const required of ['src/json-schema.js','src/migrations.js','schemas/conference.schema.json'])assert(sw.includes(required),`service-worker.js: missing engine cache asset ${required}`);
const workflow=fs.readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
assert(/npm test/.test(workflow),'deploy workflow must gate GitHub Pages deployment with npm test');
console.log('Static/accessibility smoke tests OK');
assert(workflow.includes('npm ci'),'CI must use locked dependencies');
assert(workflow.includes('playwright install --with-deps chromium'),'CI must provision browser dependencies');
assert(workflow.includes('path: "_site"'),'CI must not upload dependencies or browser traces');
const {workflowText}=await import('../src/builder/package.js');
assert(workflowText().includes('path: "_site"'),'Generated deployments must stage public assets');
assert(workflowText().includes('run: npm test'),'Generated deployments must validate before publishing');
const {execFileSync}=await import('node:child_process');
execFileSync(process.execPath,['tools/stage-site.mjs']);
for(const path of ['index.html','builder.html','src/builder/main.js','schemas/programme.schema.json','conference/conference-manifest.json','tools/validate-conference.mjs'])assert(fs.existsSync(`_site/${path}`),`Missing staged public file ${path}`);
for(const path of ['node_modules','tests','test-results','.git','package-lock.json'])assert(!fs.existsSync(`_site/${path}`),`Private/development file published: ${path}`);
console.log('Pages artifact and generated workflow regressions OK');

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

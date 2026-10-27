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
for(const required of ['src/json-schema.js','src/migrations.js','schemas/conference.schema.json','src/vendor/qr-scanner/qr-scanner.min.js','src/vendor/qr-scanner/qr-scanner-worker.min.js','assets/fonts/manifest.json','fontAssets'])assert(sw.includes(required),`service-worker.js: missing engine cache asset ${required}`);
assert(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').includes('./assets/fonts/fonts.css'),'attendee page must load the local fonts stylesheet');
assert(fs.readFileSync(new URL('../builder.html',import.meta.url),'utf8').includes('./assets/fonts/fonts.css'),'Builder must load local fonts for previews');
const fonts=JSON.parse(fs.readFileSync(new URL('../assets/fonts/manifest.json',import.meta.url),'utf8'));
for(const family of ['inter','source-sans-3','space-grotesk','ibm-plex-sans','ibm-plex-sans-condensed','noto-serif'])assert(fonts.assets.includes(family+'/OFL.txt'),'Missing '+family+' OFL attribution');
assert(fonts.assets.filter(path=>path.endsWith('.woff2')).length>=40,'offline font subset manifest is incomplete');
for(const path of fonts.assets)assert(fs.existsSync(new URL('../assets/fonts/'+path,import.meta.url)),'Missing bundled font asset '+path);
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
assert(manifest.id==='.'||manifest.id==='./','manifest id must stay inside the deployed Pages directory');
assert(manifest.start_url==='.'||manifest.start_url==='./','manifest start_url must be relative to the deployed Pages directory');
assert(manifest.scope==='.'||manifest.scope==='./','manifest scope must be relative to the deployed Pages directory');
assert(manifest.display==='standalone','installed application must open in standalone mode');
for(const size of [192,512]){
  const icon=manifest.icons.find(x=>x.sizes===`${size}x${size}`);assert(icon,`manifest missing ${size}x${size} icon`);
  const bytes=fs.readFileSync(new URL(`../${icon.src.replace(/^\.\//,'')}`,import.meta.url));
  assert(bytes.readUInt32BE(16)===size&&bytes.readUInt32BE(20)===size,`${icon.src} dimensions do not match manifest`);
}
const workflow=fs.readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
assert(/npm test/.test(workflow),'deploy workflow must gate GitHub Pages deployment with npm test');
console.log('Static/accessibility smoke tests OK');
assert(workflow.includes('npm ci'),'CI must use locked dependencies');
assert(workflow.includes('runs-on: ubuntu-24.04'),'CI must pin the runner supported by its browser dependency installer');
assert(workflow.includes('playwright install --with-deps chromium firefox webkit'),'CI must provision all three browser engines');
assert(workflow.includes('path: "_site"'),'CI must not upload dependencies or browser traces');
const {workflowText}=await import('../src/builder/package.js');
assert(workflowText().includes('path: "_site"'),'Generated deployments must stage public assets');
assert(workflowText().includes('run: npm test'),'Generated deployments must validate before publishing');
assert(workflowText().includes('runs-on: ubuntu-24.04'),'Generated deployments must use the tested runner image');
const {execFileSync}=await import('node:child_process');
execFileSync(process.execPath,['tools/stage-site.mjs']);
for(const path of ['index.html','builder.html','src/builder/main.js','src/vendor/qr-scanner/qr-scanner.min.js','src/vendor/qr-scanner/qr-scanner-worker.min.js','schemas/programme.schema.json','conference/conference-manifest.json','tools/validate-conference.mjs','assets/fonts/fonts.css','assets/fonts/manifest.json','assets/fonts/inter/OFL.txt'])assert(fs.existsSync(`_site/${path}`),`Missing staged public file ${path}`);
for(const path of ['node_modules','tests','test-results','.git','package-lock.json'])assert(!fs.existsSync(`_site/${path}`),`Private/development file published: ${path}`);
console.log('Pages artifact and generated workflow regressions OK');

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPackage,packageZip,workflowText} from '../src/builder/package.js';
import {rowsFromStructuredPackage} from '../src/builder/importers.js';
import {readStoredZip,textEntry} from '../src/zip.js';

const base='fixtures/multiple-poster-sessions',fixture={};
for(const name of ['conference','programme','people','locations','branding'])fixture[name]=JSON.parse(await readFile(base+'/'+name+'.json','utf8'));
const oldFetch=globalThis.fetch;
globalThis.fetch=async path=>{try{return new Response(await readFile(String(path).replace(/^\.\//,'')));}catch{return new Response('',{status:404});}};
try{
  const legacy={conference:fixture.conference,rows:rowsFromStructuredPackage(fixture),features:fixture.conference.features,branding:{...fixture.branding,darkMode:false,headerStyle:'text',typography:'serif'},identityRegistry:{people:{},locations:{},tracks:{}},dataVersion:1};
  const old=await buildPackage(legacy);
  assert.equal(old.pkg.branding.defaultAppearance,'system','legacy false must retain follow-device behavior');
  assert.equal(old.pkg.branding.brandMode,'combined','legacy text header remains logo plus text when a logo exists');
  assert.equal(old.pkg.branding.headingFont,'noto-serif');assert.equal(old.pkg.branding.bodyFont,'noto-serif');
  const dark=await buildPackage({...legacy,branding:{...legacy.branding,darkMode:true}});
  assert.equal(dark.pkg.branding.defaultAppearance,'dark');

  const lightSvg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#123456"/></svg>';
  const darkSvg=lightSvg.replace('#123456','#abcdef');
  const sponsorSvg=lightSvg.replace('#123456','#765432');
  const asset=(name,content)=>({name,type:'image/svg+xml',extension:'.svg',bytes:new TextEncoder().encode(content)});
  const project={...legacy,branding:{...legacy.branding,defaultAppearance:'light',previewAppearance:'dark',brandMode:'combined',logoAlignment:'right',logoSize:48,headerBackgroundLight:'#ffffff',headerBackgroundDark:'#222222',headingFont:'space-grotesk',bodyFont:'source-sans-3',primary:'#134679',secondary:'#237755',accent:'#c43168'},logoLight:asset('light.svg',lightSvg),logoDark:asset('dark.svg',darkSvg),appIcon:asset('icon.svg',sponsorSvg),sponsorFiles:[{id:'s1',name:'First sponsor',light:asset('sponsor.svg',sponsorSvg),dark:asset('dark-sponsor.svg',darkSvg),height:64},{id:'s2',name:'Second sponsor',light:asset('second.svg',lightSvg),dark:null,height:40}]};
  const built=await buildPackage(project);
  assert.deepEqual(built.report.errors,[]);
  assert.equal(built.pkg.branding.defaultAppearance,'light');
  assert.equal(built.pkg.branding.headingFont,'space-grotesk');
  assert.equal(built.pkg.branding.bodyFont,'source-sans-3');
  assert.equal(built.pkg.branding.previewAppearance,undefined,'preview appearance must never enter published branding');
  assert.equal(built.pkg.branding.sponsorLogos[0].name,'First sponsor');
  assert.equal(built.pkg.branding.sponsorLogos[0].height,64);
  assert.ok(built.pkg.branding.logoLight);assert.ok(built.pkg.branding.logoDark);
  const {blob}=await packageZip(project),entries=await readStoredZip(blob);
  const published=JSON.parse(textEntry(entries,'conference/branding.json'));
  assert.equal(published.defaultAppearance,'light');assert.equal(published.previewAppearance,undefined);
  assert.equal(published.headingFont,'space-grotesk');assert.equal(published.bodyFont,'source-sans-3');
  assert.equal(published.sponsorLogos[0].height,64);assert.equal(published.sponsorLogos[1].name,'Second sponsor');
  assert.equal(new TextDecoder().decode(entries.get('conference/'+published.logoLight)),lightSvg);
  assert.equal(new TextDecoder().decode(entries.get('conference/'+published.logoDark)),darkSvg);
  assert.ok(entries.has('assets/fonts/fonts.css'));assert.ok(entries.has('assets/fonts/manifest.json'));
  assert.ok(entries.has('assets/fonts/inter/OFL.txt'));assert.ok(entries.has('assets/fonts/noto-serif/OFL.txt'));
  assert.ok([...entries.keys()].some(x=>x.startsWith('assets/fonts/inter/')&&x.endsWith('.woff2')));
  assert.ok(textEntry(entries,'index.html').includes('./assets/fonts/fonts.css'));
  assert.ok(textEntry(entries,'service-worker.js').includes('conference-companion-engine-1.2.7'));
  assert.match(workflowText(),/cp -r .* assets src schemas conference tools _site\//);
}finally{globalThis.fetch=oldFetch;}
console.log('Branding regressions passed: legacy appearance/logo migration, theme assets, sponsor order, offline fonts and deployment parity');

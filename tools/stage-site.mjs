import {mkdir,cp,rm,readFile,writeFile} from 'node:fs/promises';
// Publish only application assets, excluding dependencies, tests and private project files.
await rm('_site',{recursive:true,force:true});
await mkdir('_site',{recursive:true});
for(const path of ['index.html','app.js','bootstrap.js','styles.css','service-worker.js','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png','builder.html','builder.css','assets','src','schemas','conference','fixtures','tools/validate-conference.mjs','tools/schema-check.mjs','tools/deployment.mjs']){
  const target=`_site/${path}`;await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});await cp(path,target,{recursive:true});
}
const branding=JSON.parse(await readFile('conference/branding.json','utf8'));
const headerLight=/^#[\da-f]{6}$/i.test(branding.headerBackgroundLight||'')?branding.headerBackgroundLight:'#FFFFFF';
const headerDark=/^#[\da-f]{6}$/i.test(branding.headerBackgroundDark||'')?branding.headerBackgroundDark:'#191A1D';
const defaultAppearance=[branding.previewAppearance,branding.defaultAppearance].find(value=>['light','dark','system'].includes(value))||(branding.darkMode===true?'dark':'system');
const bootColors=`<meta name="conference-header-background-light" content="${headerLight}">\n  <meta name="conference-header-background-dark" content="${headerDark}">\n  <meta name="conference-default-appearance" content="${defaultAppearance}">`;
const index=await readFile('_site/index.html','utf8');
if(!index.includes('<!-- CONFERENCE_HEADER_BOOT_COLORS -->'))throw new Error('Engine page has no conference theme bootstrap marker');
await writeFile('_site/index.html',index.replace('<!-- CONFERENCE_HEADER_BOOT_COLORS -->',bootColors));

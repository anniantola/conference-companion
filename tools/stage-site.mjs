import {mkdir,cp,rm} from 'node:fs/promises';
// Publish only application assets, excluding dependencies, tests and private project files.
await rm('_site',{recursive:true,force:true});
await mkdir('_site',{recursive:true});
for(const path of ['index.html','app.js','bootstrap.js','styles.css','service-worker.js','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png','builder.html','builder.css','assets','src','schemas','conference','fixtures','tools/validate-conference.mjs','tools/schema-check.mjs']){
  const target=`_site/${path}`;await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});await cp(path,target,{recursive:true});
}

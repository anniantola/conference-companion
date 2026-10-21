import {createStoredZip,readStoredZip,textEntry} from '../zip.js';

async function bytesOf(value){
  if(!value)return null;
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(value.bytes instanceof Uint8Array)return value.bytes;
  if(value.bytes instanceof ArrayBuffer)return new Uint8Array(value.bytes);
  if(value.blob instanceof Blob)return new Uint8Array(await value.blob.arrayBuffer());
  if(value instanceof Blob)return new Uint8Array(await value.arrayBuffer());
  return null;
}
function cleanName(value='file'){return String(value).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'file';}

export async function createBuilderProjectFile(project){
  const safe=structuredClone(project);
  const entries=[];
  const addAsset=async(asset,path)=>{const bytes=await bytesOf(asset);if(!bytes)return null;entries.push({name:path,data:bytes});return path;};

  if(safe.logo){const path=`assets/logo-${cleanName(safe.logo.name||'logo')}`;await addAsset(project.logo,path);safe.logo={...safe.logo,bytes:undefined,blob:undefined,archivePath:path};}
  if(safe.appIcon){const path=`assets/icon-${cleanName(safe.appIcon.name||'icon')}`;await addAsset(project.appIcon,path);safe.appIcon={...safe.appIcon,bytes:undefined,blob:undefined,archivePath:path};}

  safe.sponsorFiles=[];
  for(let i=0;i<(project.sponsorFiles||[]).length;i++){
    const src=project.sponsorFiles[i],path=`assets/sponsor-${i+1}-${cleanName(src.name||'logo')}`;await addAsset(src,path);safe.sponsorFiles.push({...src,bytes:undefined,blob:undefined,archivePath:path});
  }

  safe.sourceFiles=[];
  for(let i=0;i<(project.sourceFiles||[]).length;i++){
    const src=project.sourceFiles[i],path=`sources/${i+1}-${cleanName(src.name||'source')}`;await addAsset(src,path);safe.sourceFiles.push({...src,blob:undefined,bytes:undefined,archivePath:path});
  }

  entries.unshift({name:'project.json',data:JSON.stringify({format:'conference-companion-builder-project',version:1,exportedAt:new Date().toISOString(),project:safe},null,2)});
  return createStoredZip(entries);
}

export async function readBuilderProjectFile(file){
  const entries=await readStoredZip(file),wrapper=JSON.parse(textEntry(entries,'project.json'));
  if(wrapper.format!=='conference-companion-builder-project')throw new Error('Not a Conference Companion Builder project');
  const project=wrapper.project||{};
  const restoreAsset=(asset)=>{if(!asset?.archivePath)return asset;const bytes=entries.get(asset.archivePath);if(!bytes)return {...asset,archivePath:undefined};return {...asset,bytes:new Uint8Array(bytes),archivePath:undefined};};
  project.logo=restoreAsset(project.logo);project.appIcon=restoreAsset(project.appIcon);project.sponsorFiles=(project.sponsorFiles||[]).map(restoreAsset);
  project.sourceFiles=(project.sourceFiles||[]).map(src=>{const bytes=src.archivePath?entries.get(src.archivePath):null;return {...src,archivePath:undefined,blob:bytes?new Blob([bytes],{type:src.type||'application/octet-stream'}):undefined};});
  return project;
}

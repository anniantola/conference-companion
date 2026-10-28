import {createStoredZip,readStoredZip,textEntry} from '../zip.js';

async function bytesOf(value){
  if(!value)return null;
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(value.bytes instanceof Uint8Array)return value.bytes;
  if(value.bytes instanceof ArrayBuffer)return new Uint8Array(value.bytes);
  if(isLegacyByteObject(value.bytes))return Uint8Array.from(Object.values(value.bytes));
  if(value.bytes instanceof Blob)return new Uint8Array(await value.bytes.arrayBuffer());
  if(value.blob instanceof Blob)return new Uint8Array(await value.blob.arrayBuffer());
  if(value instanceof Blob)return new Uint8Array(await value.arrayBuffer());
  return null;
}
function isLegacyByteObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)return false;
  const keys=Object.keys(value);
  return keys.every((key,index)=>key===String(index)&&Number.isInteger(value[key])&&value[key]>=0&&value[key]<=255);
}
function normalizeAsset(asset){
  if(!asset||typeof asset!=='object')return asset;
  if(isLegacyByteObject(asset.bytes))return {...asset,bytes:Uint8Array.from(Object.values(asset.bytes))};
  return asset;
}
export function normalizeBuilderProjectAssets(project){
  for(const key of ['logo','logoLight','logoDark','appIcon'])project[key]=normalizeAsset(project[key]);
  project.peoplePhotos=Object.fromEntries(Object.entries(project.peoplePhotos||{}).map(([id,asset])=>[id,normalizeAsset(asset)]));
  project.sponsorFiles=(project.sponsorFiles||[]).map(item=>{
    const normalized=normalizeAsset(item);
    if(normalized!==item)return normalized;
    if(!item||typeof item!=='object')return item;
    return {...item,light:normalizeAsset(item.light),dark:normalizeAsset(item.dark)};
  });
  project.sourceFiles=(project.sourceFiles||[]).map(normalizeAsset);
  return project;
}
function cleanName(value='file'){return String(value).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'file';}

export async function createBuilderProjectFile(project){
  const safe=structuredClone(project);
  const entries=[];
  const usedPaths=new Set();let assetIndex=0;
  const addAsset=async(asset,area,label)=>{
    if(asset==null)return null;
    const bytes=await bytesOf(asset);
    if(!bytes?.byteLength)throw new Error(`Cannot export Builder project: ${label} asset data is missing or empty`);
    const originalName=cleanName(asset.name||'file'),extension=/\.[a-z0-9]{1,8}$/i.exec(originalName)?.[0]||'';
    const stem=extension?originalName.slice(0,-extension.length):originalName;
    let path;
    do{assetIndex++;path=`${area}/${String(assetIndex).padStart(4,'0')}-${cleanName(label)}-${stem}${extension}`;}while(usedPaths.has(path));
    usedPaths.add(path);entries.push({name:path,data:bytes});
    return {...asset,bytes:undefined,blob:undefined,archivePath:path};
  };
  const addSponsorVariants=async(source,target,label)=>{
    for(const key of ['light','dark'])target[key]=await addAsset(source?.[key],'assets',`${label}-${key}`);
  };

  for(const key of ['logo','logoLight','logoDark','appIcon'])safe[key]=await addAsset(project[key],'assets',key);
  safe.peoplePhotos={};
  for(const [personId,src] of Object.entries(project.peoplePhotos||{}))safe.peoplePhotos[personId]=await addAsset(src,'assets',`person-${personId}`);
  safe.sponsorFiles=[];
  for(let i=0;i<(project.sponsorFiles||[]).length;i++){
    const src=project.sponsorFiles[i];
    if(src?.bytes instanceof Uint8Array||src?.bytes instanceof ArrayBuffer||src?.blob instanceof Blob||src instanceof Blob){
      safe.sponsorFiles.push(await addAsset(src,'assets',`sponsor-${i+1}`));
    }else{
      const target={...src};
      await addSponsorVariants(src,target,`sponsor-${i+1}`);
      safe.sponsorFiles.push(target);
    }
  }
  safe.sourceFiles=[];
  for(let i=0;i<(project.sourceFiles||[]).length;i++)safe.sourceFiles.push(await addAsset(project.sourceFiles[i],'sources',`source-${i+1}`));

  entries.unshift({name:'project.json',data:JSON.stringify({format:'conference-companion-builder-project',version:1,exportedAt:new Date().toISOString(),project:safe},null,2)});
  return createStoredZip(entries);
}

export async function readBuilderProjectFile(file){
  const entries=await readStoredZip(file),wrapper=JSON.parse(textEntry(entries,'project.json'));
  if(wrapper.format!=='conference-companion-builder-project')throw new Error('Not a Conference Companion Builder project');
  const version=Number(wrapper.version||1);
  if(!Number.isInteger(version)||version<1||version>1)throw new Error(`Unsupported Builder project backup version: ${wrapper.version}`);
  const project=wrapper.project;
  if(!project||typeof project!=='object'||Array.isArray(project))throw new Error('Builder project backup does not contain a valid project');
  const restoreAsset=(asset,label,area='assets')=>{
    if(asset==null)return asset;
    if(typeof asset!=='object'||Array.isArray(asset))throw new Error(`Invalid ${label} asset in Builder project backup`);
    if(!asset.archivePath){
      // Allow inline legacy descriptors only when they contain actual data.
      if(asset.bytes||asset.blob instanceof Blob)return asset;
      throw new Error(`Builder project backup is missing the file reference for ${label}`);
    }
    const path=String(asset.archivePath);
    if(!path.startsWith(`${area}/`)||path.includes('\\')||path.split('/').some(part=>part==='..'))throw new Error(`Invalid ${label} asset path in Builder project backup`);
    const bytes=entries.get(path);
    if(!bytes?.byteLength)throw new Error(`Builder project backup is missing or has an empty ${label} asset: ${path}`);
    return {...asset,bytes:new Uint8Array(bytes),blob:undefined,archivePath:undefined};
  };
  for(const key of ['logo','logoLight','logoDark','appIcon'])project[key]=restoreAsset(project[key],key);
  project.peoplePhotos=Object.fromEntries(Object.entries(project.peoplePhotos||{}).map(([id,asset])=>[id,restoreAsset(asset,`person photo ${id}`)]));
  project.sponsorFiles=(project.sponsorFiles||[]).map((src,index)=>{
    if(src==null)return src;
    if(src.archivePath||src.bytes||src.blob instanceof Blob)return restoreAsset(src,`sponsor ${index+1}`);
    const result={...src};
    for(const key of ['light','dark'])result[key]=restoreAsset(src[key],`sponsor ${src.name||index+1} ${key} variant`);
    return result;
  });
  project.sourceFiles=(project.sourceFiles||[]).map((src,index)=>{
    const restored=restoreAsset(src,`source file ${src?.name||index+1}`,'sources');
    if(!restored)return restored;
    const bytes=restored.bytes;
    return {...restored,bytes:undefined,blob:new Blob([bytes],{type:src.type||'application/octet-stream'})};
  });
  return project;
}

import {createStoredZip,readStoredZip,textEntry} from '../zip.js';
import {buildPackage} from './package.js';

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
  project.mergedPersonPhotos=Object.fromEntries(Object.entries(project.mergedPersonPhotos||{}).map(([id,assets])=>[id,(assets||[]).map(normalizeAsset)]));
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

const isRecord=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!(typeof Blob!=='undefined'&&value instanceof Blob)&&!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value);
function recordCollection(project,key,{required=false,asset=false}={}){
  const value=project[key];
  if(value===undefined&&!required)return;
  if(asset?(!isRecord(value)):!Array.isArray(value))throw new Error(`Builder project backup has an invalid ${key} collection`);
}
function validateAssetDescriptor(value,label,{required=false}={}){
  if(value==null){if(required)throw new Error(`Builder project backup is missing ${label}`);return;}
  if(!isRecord(value)&&!(value instanceof Blob))throw new Error(`Builder project backup has an invalid ${label} asset`);
  if(isRecord(value)&&value.name!==undefined&&typeof value.name!=='string')throw new Error(`Builder project backup has an invalid ${label} asset name`);
  if(isRecord(value)&&value.type!==undefined&&typeof value.type!=='string')throw new Error(`Builder project backup has an invalid ${label} asset type`);
  if(isRecord(value)&&value.bytes!==undefined&&!(value.bytes instanceof Uint8Array)&&!(value.bytes instanceof ArrayBuffer)&&!(value.bytes instanceof Blob)&&!isLegacyByteObject(value.bytes))throw new Error(`Builder project backup has invalid ${label} asset bytes`);
  if(isRecord(value)&&value.bytes!==undefined&&value.bytes.byteLength===0)throw new Error(`Builder project backup has empty ${label} asset bytes`);
  if(isRecord(value)&&value.bytes instanceof Blob&&value.bytes.size===0)throw new Error(`Builder project backup has empty ${label} asset bytes`);
  if(isRecord(value)&&value.blob!==undefined&&!(value.blob instanceof Blob))throw new Error(`Builder project backup has invalid ${label} asset blob`);
}
function validateMap(value,label,{stringValues=false,records=false}={}){
  if(value===undefined)return;
  if(!isRecord(value))throw new Error(`Builder project backup has an invalid ${label} identity structure`);
  for(const [key,item] of Object.entries(value)){
    if(!key)throw new Error(`Builder project backup has an empty key in ${label}`);
    if(stringValues&&typeof item!=='string')throw new Error(`Builder project backup has a non-string identity in ${label}`);
    if(records&&!isRecord(item))throw new Error(`Builder project backup has an invalid record in ${label}`);
  }
}

/** Validate persisted Builder state, while allowing semantically incomplete programme drafts. */
export function validateBuilderProjectStructure(project){
  if(!isRecord(project))throw new Error('Builder project backup does not contain a valid project');
  if(!isRecord(project.conference))throw new Error('Builder project backup is missing a valid conference object');
  for(const key of ['name','shortName','fullName','startDate','endDate','timezone','timezoneLabel','locale','language','city','country','officialWebsite','contactEmail','venueName','venueAddress'])if(project.conference[key]!==undefined&&typeof project.conference[key]!=='string')throw new Error(`Builder project backup has an invalid conference.${key}`);
  recordCollection(project,'rows',{required:true});
  const rowStrings=['id','entityId','sessionId','posterSessionId','calendarUid','posterSessionCalendarUid','date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber','abstract','doi'];
  project.rows.forEach((row,index)=>{
    if(!isRecord(row))throw new Error(`Builder project backup has an invalid programme row ${index+1}`);
    for(const key of rowStrings)if(row[key]!==undefined&&typeof row[key]!=='string')throw new Error(`Builder project backup has an invalid row ${index+1} field ${key}`);
    for(const key of ['speakerEntityIds','chairEntityIds','authorEntityIds','personIdentityCandidates','importWarnings'])if(row[key]!==undefined&&(!Array.isArray(row[key])||row[key].some(item=>typeof item!=='string')))throw new Error(`Builder project backup has an invalid row ${index+1} collection ${key}`);
    for(const key of ['personIdentityConflict','personIdentityResolved'])if(row[key]!==undefined&&typeof row[key]!=='boolean')throw new Error(`Builder project backup has an invalid row ${index+1} identity flag ${key}`);
    if(row.personIdentityAssignments!==undefined){
      if(!isRecord(row.personIdentityAssignments))throw new Error(`Builder project backup has invalid row ${index+1} personIdentityAssignments`);
      for(const [role,assignments] of Object.entries(row.personIdentityAssignments)){
        if(!['speaker','chair','author'].includes(role)||!isRecord(assignments))throw new Error(`Builder project backup has invalid row ${index+1} ${role} identity assignments`);
        for(const [position,assignment] of Object.entries(assignments))if(!/^\d+$/.test(position)||!isRecord(assignment)||typeof(assignment.personId??assignment.id)!=='string'||!['automatic','confirmed','unresolved'].includes(assignment.status)||assignment.status==='confirmed'&&!(assignment.personId||assignment.id))throw new Error(`Builder project backup has invalid row ${index+1} ${role} assignment ${position}`);
      }
    }
    if(row.personIdentityIssues!==undefined&&(!Array.isArray(row.personIdentityIssues)||row.personIdentityIssues.some(issue=>!isRecord(issue)||!['speaker','chair','author'].includes(issue.role)||!Number.isInteger(issue.index)||issue.index<0||typeof issue.name!=='string'||!Array.isArray(issue.candidateIds)||issue.candidateIds.some(id=>typeof id!=='string'))))throw new Error(`Builder project backup has invalid row ${index+1} personIdentityIssues`);
    if(row.personIdentityCandidatesByName!==undefined&&(!isRecord(row.personIdentityCandidatesByName)||Object.values(row.personIdentityCandidatesByName).some(ids=>!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))))throw new Error(`Builder project backup has invalid row ${index+1} personIdentityCandidatesByName`);
    if(row.personIdentityResolvedNames!==undefined&&(!isRecord(row.personIdentityResolvedNames)||Object.values(row.personIdentityResolvedNames).some(value=>typeof value!=='boolean')))throw new Error(`Builder project backup has invalid row ${index+1} personIdentityResolvedNames`);
    if(row.manualFields!==undefined&&(!isRecord(row.manualFields)||Object.values(row.manualFields).some(value=>typeof value!=='boolean')))throw new Error(`Builder project backup has invalid row ${index+1} manual field markers`);
    if(row.source!==undefined&&!isRecord(row.source))throw new Error(`Builder project backup has an invalid source descriptor on row ${index+1}`);
    if(row.sequence!==undefined&&(!Number.isInteger(row.sequence)||row.sequence<0))throw new Error(`Builder project backup has an invalid sequence on row ${index+1}`);
  });
  for(const key of ['features','policy','branding','mapping'])if(project[key]!==undefined&&!isRecord(project[key]))throw new Error(`Builder project backup has an invalid ${key} object`);
  for(const [key,value] of Object.entries(project.features||{}))if(typeof value!=='boolean')throw new Error(`Builder project backup has an invalid feature flag ${key}`);
  for(const [key,value] of Object.entries(project.policy||{}))if(typeof value!=='boolean')throw new Error(`Builder project backup has an invalid policy flag ${key}`);
  const brandingEnums={defaultAppearance:['light','dark','system'],previewAppearance:['light','dark'],headingFont:['inter','source-sans-3','space-grotesk','ibm-plex-sans','ibm-plex-sans-condensed','noto-serif'],bodyFont:['inter','source-sans-3','space-grotesk','ibm-plex-sans','ibm-plex-sans-condensed','noto-serif'],brandMode:['text','logo','combined'],headerStyle:['text','logo','combined'],logoAlignment:['left','center','right']};
  for(const [key,values] of Object.entries(brandingEnums))if(project.branding?.[key]!==undefined&&!values.includes(project.branding[key]))throw new Error(`Builder project backup has an invalid branding.${key}`);
  for(const key of ['primary','secondary','accent','headerBackgroundLight','headerBackgroundDark','typography'])if(project.branding?.[key]!==undefined&&typeof project.branding[key]!=='string')throw new Error(`Builder project backup has an invalid branding.${key}`);
  for(const [key,value] of Object.entries(project.mapping||{}))if(typeof value!=='string')throw new Error(`Builder project backup has an invalid mapping field ${key}`);
  for(const key of ['sourceFiles','sourceState','extraPeople','extraLocations','announcements','deletedSourceIds','changelog','confirmedPublications','identityWarnings','reimportConflicts','sponsorFiles'])if(project[key]!==undefined&&!Array.isArray(project[key]))throw new Error(`Builder project backup has an invalid ${key} collection`);
  for(const key of ['extraPeople','extraLocations','announcements'])for(const [index,item] of (project[key]||[]).entries())if(!isRecord(item))throw new Error(`Builder project backup has an invalid ${key} record ${index+1}`);
  for(const key of ['sourceState','changelog','confirmedPublications'])for(const [index,item] of (project[key]||[]).entries())if(!isRecord(item))throw new Error(`Builder project backup has an invalid ${key} record ${index+1}`);
  for(const [index,item] of (project.reimportConflicts||[]).entries())if(typeof item!=='string')throw new Error(`Builder project backup has an invalid reimport conflict ${index+1}`);
  for(const key of ['peopleOverrides','locationOverrides','sessionOverrides','peoplePhotos'])validateMap(project[key],key,{records:key!=='peoplePhotos'});
  if(project.mergedPersonPhotos!==undefined&&!isRecord(project.mergedPersonPhotos))throw new Error('Builder project backup has an invalid mergedPersonPhotos collection');
  for(const [id,assets] of Object.entries(project.mergedPersonPhotos||{})){if(!Array.isArray(assets))throw new Error(`Builder project backup has invalid merged photos for ${id}`);assets.forEach((asset,index)=>validateAssetDescriptor(asset,`merged person photo ${id} ${index+1}`));}
  if(project.identityDecisions!==undefined){if(!isRecord(project.identityDecisions))throw new Error('Builder project backup has an invalid identityDecisions structure');validateMap(project.identityDecisions.pairs,'identityDecisions.pairs',{stringValues:true});for(const [pair,decision] of Object.entries(project.identityDecisions.pairs||{}))if(!pair.includes('::')||!['same','different','unresolved'].includes(decision))throw new Error(`Builder project backup has an invalid identity decision for ${pair}`);}
  validateMap(project.personIdAliases,'personIdAliases',{stringValues:true});
  for(const key of ['logo','logoLight','logoDark','appIcon'])validateAssetDescriptor(project[key],key);
  for(const [id,asset] of Object.entries(project.peoplePhotos||{}))validateAssetDescriptor(asset,`person photo ${id}`);
  for(const [index,item] of (project.sponsorFiles||[]).entries()){
    if(!isRecord(item))throw new Error(`Builder project backup has an invalid sponsor record ${index+1}`);
    if(item.name!==undefined&&typeof item.name!=='string')throw new Error(`Builder project backup has an invalid sponsor name ${index+1}`);
    if(item.id!==undefined&&typeof item.id!=='string')throw new Error(`Builder project backup has an invalid sponsor ID ${index+1}`);
    if(item.height!==undefined&&(!Number.isFinite(Number(item.height))||Number(item.height)<0))throw new Error(`Builder project backup has an invalid sponsor size ${index+1}`);
    if(item.bytes!==undefined||item.blob!==undefined)validateAssetDescriptor(item,`sponsor ${index+1}`,{required:true});
    else for(const theme of ['light','dark'])validateAssetDescriptor(item[theme],`sponsor ${index+1} ${theme} variant`);
  }
  for(const [index,item] of (project.sourceFiles||[]).entries())validateAssetDescriptor(item,`source file ${index+1}`,{required:true});
  const registry=project.identityRegistry;
  if(registry!==undefined){
    if(!isRecord(registry))throw new Error('Builder project backup has an invalid identityRegistry');
    for(const key of ['people','locations','tracks'])validateMap(registry[key],`identityRegistry.${key}`,{stringValues:true});
    validateMap(registry.personRecords,'identityRegistry.personRecords',{records:true});
    const personRecords=registry.personRecords||{},aliases=project.personIdAliases||{};
    for(const [identity,id] of Object.entries(registry.people||{})){
      let canonical=id;const seen=new Set();while(aliases[canonical]&&!seen.has(canonical)){seen.add(canonical);canonical=aliases[canonical];}
      if(seen.has(canonical))throw new Error(`Builder project backup has a cyclic person identity alias for ${identity}`);
      if(Object.keys(personRecords).length&&!personRecords[canonical])throw new Error(`Builder project backup has a person index pointing to missing identity ${canonical}`);
    }
    for(const [id,person] of Object.entries(registry.personRecords||{})){
      if(person.id!==undefined&&person.id!==id)throw new Error(`Builder project backup has inconsistent person identity ${id}`);
      for(const key of ['names','affiliations','explicitIds'])if(person[key]!==undefined&&(!Array.isArray(person[key])||person[key].some(value=>typeof value!=='string')))throw new Error(`Builder project backup has an invalid person identity ${id} ${key}`);
    }
    if(registry.autoConsolidatedIds!==undefined&&(!Array.isArray(registry.autoConsolidatedIds)||registry.autoConsolidatedIds.some(value=>typeof value!=='string')))throw new Error('Builder project backup has invalid autoConsolidatedIds');
  }
  for(const key of ['dataVersion','lastPublishedVersion','lastExportedVersion'])if(project[key]!==undefined&&(!Number.isInteger(project[key])||project[key]<0))throw new Error(`Builder project backup has an invalid ${key}`);
  for(const key of ['lastPublishedAt','lastExportedAt','releaseMessage'])if(project[key]!==undefined&&typeof project[key]!=='string')throw new Error(`Builder project backup has an invalid ${key}`);
  return project;
}

/** Build a disposable package to catch structural/identity failures without rejecting incomplete drafts. */
export async function validateBuilderProjectTrial(project){
  validateBuilderProjectStructure(project);
  let result;
  try { result=await buildPackage(structuredClone(project)); }
  catch(error) { throw new Error(`Builder project backup cannot build a trial package: ${error?.message||String(error)}`); }
  const schemaErrors=result.report.errors.filter(message=>{
    if(project.conference.startDate===''&&['conference.startDate: does not match required pattern','conference.startDate must be YYYY-MM-DD'].includes(message))return false;
    if(project.conference.endDate===''&&['conference.endDate: does not match required pattern','conference.endDate must be YYYY-MM-DD'].includes(message))return false;
    return /^(manifest|conference|programme|people|locations|branding)(\.|:)/.test(message);
  });
  if(schemaErrors.length)throw new Error(`Builder project backup has invalid package structure: ${schemaErrors.join('; ')}`);
  return true;
}

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
  safe.mergedPersonPhotos={};for(const [personId,assets] of Object.entries(project.mergedPersonPhotos||{}))safe.mergedPersonPhotos[personId]=await Promise.all(assets.map((src,index)=>addAsset(src,'assets',`person-${personId}-merged-${index+1}`)));
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
  const version=wrapper.version===undefined?1:wrapper.version;
  if(!Number.isInteger(version)||version!==1)throw new Error(`Unsupported Builder project backup version: ${wrapper.version}`);
  const project=wrapper.project;
  if(!isRecord(project))throw new Error('Builder project backup does not contain a valid project');
  // Historical backups used source IDs as journal keys. Normalize only a
  // well-formed keyed journal; the ordinary structural checks remain strict.
  if(isRecord(project.sourceState))project.sourceState=Object.entries(project.sourceState).map(([sourceId,item])=>{
    if(!isRecord(item))throw new Error(`Builder project backup has an invalid source journal record ${sourceId}`);
    return {...item,sourceId:item.sourceId||sourceId};
  });
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
  project.mergedPersonPhotos=Object.fromEntries(Object.entries(project.mergedPersonPhotos||{}).map(([id,assets])=>[id,assets.map((asset,index)=>restoreAsset(asset,`merged person photo ${id} ${index+1}`))]));
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
  return validateBuilderProjectStructure(project);
}

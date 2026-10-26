import {createStoredZip,readStoredZip,textEntry} from './zip.js';
import {normalizeEmail,normalizeOrcid,normalizeExternalLink,normalizeWebUrl} from './safe-url.js';

async function blobBytes(blob){return new Uint8Array(await blob.arrayBuffer());}

export async function createPersonalBackup({conferenceId,state,profile,friends,photos}){
  const photoMeta=[];const entries=[];
  for(const photo of photos||[]){
    const ext=(photo.originalType||photo.blob?.type||'image/jpeg').includes('png')?'png':'jpg';
    const name=`photos/${String(photo.id).padStart(8,'0')}.${ext}`;
    entries.push({name,data:await blobBytes(photo.blob)});
    const {blob,thumbnailBlob,...meta}=photo;photoMeta.push({...meta,file:name,type:photo.blob?.type||photo.originalType||'image/jpeg'});
  }
  const cleanProfile={...(profile||{})};let profilePhoto=null;
  if(cleanProfile.photoBlob instanceof Blob){
    const type=cleanProfile.photoBlob.type||'image/jpeg',ext=type.includes('png')?'png':'jpg',name=`profile/profile.${ext}`;
    entries.push({name,data:await blobBytes(cleanProfile.photoBlob)});profilePhoto={file:name,type};delete cleanProfile.photoBlob;
  }
  const payload={format:'conference-companion-backup',version:3,conferenceId,exportedAt:new Date().toISOString(),state,profile:cleanProfile,profilePhoto,friends,photos:photoMeta};
  entries.unshift({name:'backup.json',data:JSON.stringify(payload,null,2)});
  return createStoredZip(entries);
}

export async function parsePersonalBackup(file){
  let payload,entries=new Map();
  if(file.name?.toLowerCase().endsWith('.json')){
    payload=JSON.parse(await file.text());
    if(payload?.profilePhoto?.file||payload?.photos?.length)throw new Error('JSON backups cannot contain the required photo files; import the complete ZIP backup');
  }else{
    entries=await readStoredZip(file);
    payload=JSON.parse(textEntry(entries,'backup.json'));
  }
  validateBackupPayload(payload);
  const photoFiles=new Map();
  for(const meta of payload.photos||[]){
    const bytes=entries.get(meta.file);
    if(!bytes)throw new Error(`Backup photo is missing: ${meta.file}`);
    assertImageBytes(bytes,meta.type||'image/jpeg',meta.file);
    photoFiles.set(meta.file,new Blob([bytes],{type:meta.type||'image/jpeg'}));
  }
  if(payload.profilePhoto?.file){
    const bytes=entries.get(payload.profilePhoto.file);
    if(!bytes)throw new Error('Backup profile photo is missing');
    assertImageBytes(bytes,payload.profilePhoto.type||'image/jpeg',payload.profilePhoto.file);
    payload.profile||={};payload.profile.photoBlob=new Blob([bytes],{type:payload.profilePhoto.type||'image/jpeg'});
  }
  return {payload,photoFiles};
}

function assertObject(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object`);}
function safeContact(contact,label){
  if(contact==null)return;
  assertObject(contact,label);
  if(contact.name!=null&&typeof contact.name!=='string')throw new Error(`${label}.name must be text`);
  for(const field of ['position','affiliation','bio'])if(contact[field]!=null&&typeof contact[field]!=='string')throw new Error(`${label}.${field} must be text`);
  if(contact.affiliations!=null&&(!Array.isArray(contact.affiliations)||contact.affiliations.some(value=>typeof value!=='string')))throw new Error(`${label}.affiliations must be an array of text`);
  const emails=[...(Array.isArray(contact.emails)?contact.emails:[]),...(contact.email?[contact.email]:[])];
  if(contact.emails!=null&&!Array.isArray(contact.emails))throw new Error(`${label}.emails must be an array`);
  if(emails.some(email=>typeof email!=='string'||!normalizeEmail(email)))throw new Error(`${label} contains an invalid email address`);
  for(const field of ['website','linkedin'])if(contact[field]&&!normalizeWebUrl(contact[field]))throw new Error(`${label}.${field} must be an HTTPS URL`);
  if(contact.orcid&&!normalizeOrcid(contact.orcid))throw new Error(`${label}.orcid is invalid`);
  if(contact.links!=null){
    if(!Array.isArray(contact.links))throw new Error(`${label}.links must be an array`);
    for(const link of contact.links){const url=typeof link==='string'?link:link?.url;if(url&&!normalizeExternalLink(url))throw new Error(`${label} contains an unsafe link`);}
  }
  if(contact.papers!=null&&!Array.isArray(contact.papers))throw new Error(`${label}.papers must be an array`);
  for(const paper of contact.papers||[]){
    const value=typeof paper==='string'?paper:paper?.doi||paper?.title;
    if(typeof value!=='string')throw new Error(`${label} contains an invalid paper reference`);
    if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^doi:/i.test(value)&&!normalizeWebUrl(value))throw new Error(`${label} contains an unsafe paper reference`);
  }
}
function assertImageBytes(bytes,type,name){
  if(!/^image\/(?:jpeg|png|webp|gif|avif|bmp)$/i.test(type)||!bytes.length)throw new Error(`Backup image is invalid: ${name}`);
  const b=bytes;
  const png=b.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x);
  const jpeg=b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255;
  const gif=b.length>=6&&String.fromCharCode(...b.slice(0,6)).startsWith('GIF8');
  const webp=b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
  const avif=b.length>=12&&String.fromCharCode(...b.slice(4,8))==='ftyp'&&/avif|avis/.test(String.fromCharCode(...b.slice(8,16)));
  const bmp=b.length>=2&&b[0]===66&&b[1]===77;
  if(!(png||jpeg||gif||webp||avif||bmp))throw new Error(`Backup image data is corrupted: ${name}`);
}

export function validateBackupPayload(payload){
  assertObject(payload,'Backup');
  if(payload.format!=='conference-companion-backup'||!Number.isInteger(payload.version)||payload.version<1||payload.version>3)throw new Error('Unsupported Conference Companion backup format or version');
  if(typeof payload.conferenceId!=='string'||!payload.conferenceId)throw new Error('Backup conference ID is missing');
  assertObject(payload.state,'Backup state');
  for(const key of ['favorites','posterFavorites'])if(payload.state[key]!=null&&(!Array.isArray(payload.state[key])||payload.state[key].some(id=>typeof id!=='string')))throw new Error(`Backup state.${key} must be an array of IDs`);
  if(payload.state.notes!=null){
    assertObject(payload.state.notes,'Backup notes');
    if(Object.values(payload.state.notes).some(note=>typeof note!=='string'))throw new Error('Backup notes must contain text values');
  }
  if(payload.state.theme!=null&&!['system','light','dark'].includes(payload.state.theme))throw new Error('Backup theme preference is invalid');
  if(payload.state.compact!=null&&typeof payload.state.compact!=='boolean')throw new Error('Backup compact preference is invalid');
  if(payload.state.timeMode!=null&&!['conference','local'].includes(payload.state.timeMode))throw new Error('Backup time preference is invalid');
  if(payload.state.view!=null&&!['program','my','gallery','posters','friends','settings'].includes(payload.state.view))throw new Error('Backup view preference is invalid');
  if(payload.profile!=null)safeContact(payload.profile,'Backup profile');
  if(payload.friends!=null){
    if(!Array.isArray(payload.friends))throw new Error('Backup friends must be an array');
    const friendIds=new Set();
    payload.friends.forEach((friend,index)=>{
      safeContact(friend,`Backup friend ${index+1}`);
      if(friend.id!=null){if(typeof friend.id!=='string'||!friend.id||friendIds.has(friend.id))throw new Error('Backup contains an invalid or duplicate contact ID');friendIds.add(friend.id);}
      for(const field of ['privateNotes','metAt','metAtEventId'])if(friend[field]!=null&&typeof friend[field]!=='string')throw new Error(`Backup friend ${index+1}.${field} must be text`);
      if(friend.tags!=null&&(!Array.isArray(friend.tags)||friend.tags.some(tag=>typeof tag!=='string')))throw new Error(`Backup friend ${index+1}.tags must be an array of text`);
    });
  }
  if(payload.photos!=null){
    if(!Array.isArray(payload.photos))throw new Error('Backup photos must be an array');
    const ids=new Set(),files=new Set();
    for(const photo of payload.photos){
      assertObject(photo,'Backup photo');
      if(!(typeof photo.id==='string'||Number.isFinite(photo.id)))throw new Error('Backup photo ID is invalid');
      const id=String(photo.id);if(ids.has(id))throw new Error(`Backup contains duplicate photo ID ${id}`);ids.add(id);
      if(typeof photo.file!=='string'||!/^photos\/[A-Za-z0-9._-]+\.(?:png|jpg|jpeg|webp|gif|avif|bmp)$/i.test(photo.file)||files.has(photo.file))throw new Error('Backup photo file reference is invalid');
      files.add(photo.file);
      if(!['event','poster','unclassified'].includes(photo.ownerType)||typeof photo.ownerId!=='string')throw new Error('Backup photo assignment is invalid');
      if(photo.customTitle!=null&&typeof photo.customTitle!=='string'||photo.customNote!=null&&typeof photo.customNote!=='string')throw new Error('Backup photo annotations are invalid');
    }
  }
  if(payload.profilePhoto!=null){
    assertObject(payload.profilePhoto,'Backup profile photo');
    if(typeof payload.profilePhoto.file!=='string'||!/^profile\/profile\.(?:png|jpg|jpeg|webp|gif|avif|bmp)$/i.test(payload.profilePhoto.file))throw new Error('Backup profile photo reference is invalid');
  }
  return true;
}

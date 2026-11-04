import {createStoredZip,readStoredZip,textEntry} from './zip.js';
import {normalizeEmail,normalizeOrcid,normalizeExternalLink,normalizeWebUrl} from './safe-url.js';
import {galleryForContact,galleryChange} from './friend-gallery.js';
import {cleanAvatarRecord} from './avatar-color.js';

async function blobBytes(blob){return new Uint8Array(await blob.arrayBuffer());}

export async function createPersonalBackup({conferenceId,state,profile,friends,photos}){
  const photoMeta=[];const entries=[];
  for(const photo of photos||[]){
    const ext=(photo.originalType||photo.blob?.type||'image/jpeg').includes('png')?'png':'jpg';
    const name=`photos/${String(photo.id).padStart(8,'0')}.${ext}`;
    entries.push({name,data:await blobBytes(photo.blob)});
    const {blob,thumbnailBlob,...meta}=photo;photoMeta.push({...meta,file:name,type:photo.blob?.type||photo.originalType||'image/jpeg'});
  }
  const cleanProfile=cleanAvatarRecord(profile||{});let profilePhoto=null;
  if(cleanProfile.photoBlob instanceof Blob){
    const type=cleanProfile.photoBlob.type||'image/jpeg',ext=type.includes('png')?'png':'jpg',name=`profile/profile.${ext}`;
    entries.push({name,data:await blobBytes(cleanProfile.photoBlob)});profilePhoto={file:name,type};delete cleanProfile.photoBlob;
  }
  const cleanFriends=[];
  for(const friend of friends||[]){
    if(Array.isArray(friend.privatePhotos)&&friend.privatePhotos.some(photo=>photo?.id&&!(photo.blob instanceof Blob)))throw new Error(`Contact ${friend.name||friend.id||''} has a photo that cannot be backed up`);
    const clean=cleanAvatarRecord(friend);
    clean.privatePhotos=[];
    for(const [index,photo] of galleryForContact(friend).entries()){
      const file=`contacts/${encodeURIComponent(String(clean.id))}-${index}.jpg`;
      entries.push({name:file,data:await blobBytes(photo.blob)});
      let thumbnail=null;
      if(photo.thumbnailBlob instanceof Blob){thumbnail=`contacts/${encodeURIComponent(String(clean.id))}-${index}-thumb.jpg`;entries.push({name:thumbnail,data:await blobBytes(photo.thumbnailBlob)});}
      clean.privatePhotos.push({id:photo.id,caption:photo.caption||'',createdAt:photo.createdAt||0,file,type:photo.blob.type||'image/jpeg',thumbnail,thumbnailType:photo.thumbnailBlob?.type||'image/jpeg'});
    }
    delete clean.privatePhotoBlob;
    cleanFriends.push(clean);
  }
  const payload={format:'conference-companion-backup',version:5,conferenceId,exportedAt:new Date().toISOString(),state,profile:cleanProfile,profilePhoto,friends:cleanFriends,photos:photoMeta};
  entries.unshift({name:'backup.json',data:JSON.stringify(payload,null,2)});
  return createStoredZip(entries);
}

export async function parsePersonalBackup(file){
  let payload,entries=new Map();
  if(file.name?.toLowerCase().endsWith('.json')){
    payload=JSON.parse(await file.text());
    if(payload?.profilePhoto?.file||payload?.photos?.length||payload?.friends?.some(friend=>friend.privatePhoto?.file||friend.privatePhotos?.length))throw new Error('JSON backups cannot contain the required photo files; import the complete ZIP backup');
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
  for(const friend of payload.friends||[])if(friend.privatePhoto?.file){
    const {file,type='image/jpeg'}=friend.privatePhoto,bytes=entries.get(file);
    if(!bytes)throw new Error(`Backup contact photo is missing: ${file}`);
    assertImageBytes(bytes,type,file);
    friend.privatePhotoBlob=new Blob([bytes],{type});delete friend.privatePhoto;
  }
  for(const friend of payload.friends||[])if(friend.privatePhotos?.length){
    const photos=[];
    for(const photo of friend.privatePhotos){
      const bytes=entries.get(photo.file);if(!bytes)throw new Error(`Backup contact photo is missing: ${photo.file}`);
      assertImageBytes(bytes,photo.type||'image/jpeg',photo.file);
      let thumbnailBlob=null;
      if(photo.thumbnail){const thumb=entries.get(photo.thumbnail);if(!thumb)throw new Error(`Backup contact thumbnail is missing: ${photo.thumbnail}`);assertImageBytes(thumb,photo.thumbnailType||'image/jpeg',photo.thumbnail);thumbnailBlob=new Blob([thumb],{type:photo.thumbnailType||'image/jpeg'});}
      photos.push({id:photo.id,caption:photo.caption||'',createdAt:photo.createdAt||0,blob:new Blob([bytes],{type:photo.type||'image/jpeg'}),thumbnailBlob});
    }
    Object.assign(friend,galleryChange(friend,photos,friend.privateCoverPhotoId));
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
  if(payload.format!=='conference-companion-backup'||!Number.isInteger(payload.version)||payload.version<1||payload.version>5)throw new Error('Unsupported Conference Companion backup format or version');
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
  if(payload.profile!=null)payload.profile=cleanAvatarRecord(payload.profile,{profile:true});
  if(payload.friends!=null){
    if(!Array.isArray(payload.friends))throw new Error('Backup friends must be an array');
    const friendIds=new Set();
    payload.friends.forEach((friend,index)=>{
      safeContact(friend,`Backup friend ${index+1}`);
      payload.friends[index]=cleanAvatarRecord(friend);
      if(friend.id!=null){if(typeof friend.id!=='string'||!friend.id||friendIds.has(friend.id))throw new Error('Backup contains an invalid or duplicate contact ID');friendIds.add(friend.id);}
      for(const field of ['privateNotes','metAt','metAtEventId'])if(friend[field]!=null&&typeof friend[field]!=='string')throw new Error(`Backup friend ${index+1}.${field} must be text`);
      if(friend.tags!=null&&(!Array.isArray(friend.tags)||friend.tags.some(tag=>typeof tag!=='string')))throw new Error(`Backup friend ${index+1}.tags must be an array of text`);
      if(friend.directoryLinkDismissed!=null&&typeof friend.directoryLinkDismissed!=='boolean')throw new Error(`Backup friend ${index+1}.directoryLinkDismissed must be a flag`);
      if(friend.privatePhoto!=null){
        assertObject(friend.privatePhoto,'Backup contact photo');
        if(typeof friend.privatePhoto.file!=='string'||!/^contacts\/[A-Za-z0-9%._-]+\.jpg$/.test(friend.privatePhoto.file))throw new Error('Backup contact photo reference is invalid');
      }
      if(friend.privatePhotos!=null){
        if(!Array.isArray(friend.privatePhotos))throw new Error('Backup contact gallery is invalid');
        const ids=new Set();
        for(const photo of friend.privatePhotos){
          assertObject(photo,'Backup contact gallery photo');
          if(typeof photo.id!=='string'||!photo.id||ids.has(photo.id)||typeof photo.caption!=='string'||typeof photo.file!=='string'||!/^contacts\/[A-Za-z0-9%._-]+\.jpg$/.test(photo.file)||photo.thumbnail&&!/^contacts\/[A-Za-z0-9%._-]+\.jpg$/.test(photo.thumbnail))throw new Error('Backup contact gallery photo is invalid');
          ids.add(photo.id);
        }
        if(friend.privateCoverPhotoId&&typeof friend.privateCoverPhotoId!=='string')throw new Error('Backup contact cover is invalid');
      }
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

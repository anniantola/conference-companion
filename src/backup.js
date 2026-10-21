import {createStoredZip,readStoredZip,textEntry} from './zip.js';

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
  if(file.name?.toLowerCase().endsWith('.json')){
    const payload=JSON.parse(await file.text());return {payload,photoFiles:new Map()};
  }
  const entries=await readStoredZip(file);const payload=JSON.parse(textEntry(entries,'backup.json'));
  if(payload.format!=='conference-companion-backup')throw new Error('Not a Conference Companion backup');
  const photoFiles=new Map();for(const meta of payload.photos||[]){const bytes=entries.get(meta.file);if(bytes)photoFiles.set(meta.file,new Blob([bytes],{type:meta.type||'image/jpeg'}));}
  if(payload.profilePhoto?.file){const bytes=entries.get(payload.profilePhoto.file);if(bytes){payload.profile||={};payload.profile.photoBlob=new Blob([bytes],{type:payload.profilePhoto.type||'image/jpeg'});}}
  return {payload,photoFiles};
}

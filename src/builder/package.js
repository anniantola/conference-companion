import {validatePackage,timeToMinutes} from '../validation.js';
import {createStoredZip} from '../zip.js';
import {calendarUidForEntity} from '../calendar.js';
import {CURRENT_SCHEMA_VERSION} from '../migrations.js';

const ENGINE_FILES = [
  'index.html','app.js','bootstrap.js','styles.css','service-worker.js','.nojekyll',
  'src/validation.js','src/json-schema.js','src/migrations.js','src/package-store.js','src/model.js','src/user-store.js',
  'src/calendar.js','src/vcard.js','src/qrcode.js','src/backup.js','src/zip.js'
];
const SCHEMA_FILES=['conference-manifest.schema.json','conference.schema.json','programme.schema.json','people.schema.json','locations.schema.json','branding.schema.json'];

function slug(value,prefix='id'){
  const s=String(value||'').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return s||prefix;
}
function parseNames(text){return String(text||'').split(/\s*(?:;|\band\b)\s*/i).map(x=>x.trim()).filter(Boolean);}
async function hashBytes(value){
  const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function ensureUnique(base,used){let id=base,n=2;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;}
function minTime(values){return values.filter(Boolean).sort((a,b)=>timeToMinutes(a)-timeToMinutes(b))[0]||'';}
function maxTime(values){return values.filter(Boolean).sort((a,b)=>timeToMinutes(b)-timeToMinutes(a))[0]||'';}
function sessionType(type){const t=String(type||'').toLowerCase();return ['break','meal','social','registration','poster-session','special'].includes(t)?t:'session';}
function presentationType(type){const t=String(type||'').toLowerCase();return ['plenary','keynote','special','talk'].includes(t)?t:'talk';}
function fileExt(file){
  const type=String(file?.type||'').toLowerCase();
  if(type.includes('svg'))return '.svg';if(type.includes('jpeg')||type.includes('jpg'))return '.jpg';if(type.includes('webp'))return '.webp';return '.png';
}
function personPhotoPath(id,asset){const safe=String(id||'person').replace(/[^a-zA-Z0-9_-]+/g,'-');return `assets/person-${safe}${asset?.extension||fileExt(asset)}`;}
function stableEntityId(row,prefix){
  if(row.entityId)return row.entityId;
  const raw=String(row.id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]+/g,'-');
  return `${prefix}-${raw}`;
}
function normalizePersonLinks(person,override={}){
  const links=[...(person.links||[])].filter(x=>x?.url && x.label!=='Website');
  const website=override.website ?? person.website ?? (person.links||[]).find(x=>x.label==='Website')?.url;
  if(website)links.push({label:'Website',url:website});
  person.links=links;delete person.website;
}

/** Assign private Builder identities once. These fields are Builder state only. */
export function ensureProjectIdentities(project){
  project.conference ||= {};
  if(!project.conference.id) project.conference.id=`conference-${crypto.randomUUID()}`;
  project.identityRegistry ||= {people:{},locations:{},tracks:{}};
  project.identityRegistry.people ||= {};project.identityRegistry.locations ||= {};project.identityRegistry.tracks ||= {};
  project.sessionOverrides ||= {};
  const registry=project.identityRegistry;
  const rows=project.rows||[];
  const sessionByKey=new Map();
  const personId=(name,affiliation='',preferred='')=>{
    if(preferred)return preferred;
    const n=String(name||'').trim().toLowerCase(),a=String(affiliation||'').trim().toLowerCase();if(!n)return '';
    const exact=`${n}|${a}`,alias=`${n}|`;
    if(registry.people[exact])return registry.people[exact];
    if(registry.people[alias]){registry.people[exact]=registry.people[alias];return registry.people[alias];}
    const id=`person-${crypto.randomUUID()}`;registry.people[exact]=id;if(!registry.people[alias])registry.people[alias]=id;return id;
  };
  const locationId=(name,preferred='')=>{if(preferred)return preferred;const k=String(name||'').trim().toLowerCase();if(!k)return 'venue-main';return registry.locations[k]||(registry.locations[k]=`loc-${crypto.randomUUID()}`);};
  const trackId=(name,preferred='')=>{if(preferred)return preferred;const k=String(name||'Common').trim().toLowerCase()||'common';if(k==='common')return registry.tracks[k]||(registry.tracks[k]='common');return registry.tracks[k]||(registry.tracks[k]=`track-${crypto.randomUUID()}`);};
  for(const row of rows){
    if(!row.id)row.id=crypto.randomUUID();
    const type=String(row.type||'talk').toLowerCase();
    if(!row.entityId)row.entityId=stableEntityId(row,type==='poster'?'poster':'presentation');
    if(!Number.isFinite(Number(row.sequence)))row.sequence=0;
    row.locationEntityId=locationId(row.location,row.locationEntityId);
    row.trackEntityId=trackId(row.track||'Common',row.trackEntityId);
    const speakerNames=parseNames(row.speaker),chairNames=parseNames(row.chair);
    row.speakerEntityIds=speakerNames.map((name,i)=>personId(name,row.affiliation,(row.speakerEntityIds||[])[i]));
    row.chairEntityIds=chairNames.map((name,i)=>personId(name,'',(row.chairEntityIds||[])[i]));

    if(type==='poster'){
      const key=`poster|${row.date||project.conference?.startDate||''}|${String(row.session||'Poster session').trim().toLowerCase()}`;
      if(row.posterSessionId)sessionByKey.set(key,row.posterSessionId);
      else if(sessionByKey.has(key))row.posterSessionId=sessionByKey.get(key);
      else {row.posterSessionId=`session-${crypto.randomUUID()}`;sessionByKey.set(key,row.posterSessionId);}
      if(!row.posterSessionCalendarUid)row.posterSessionCalendarUid=calendarUidForEntity(row.posterSessionId,project.conference);
      if(!row.calendarUid)row.calendarUid=calendarUidForEntity(row.entityId,project.conference);
      continue;
    }

    const standalone=['break','meal','social','registration','special'].includes(type);
    if(standalone){
      if(!row.sessionId)row.sessionId=`session-${crypto.randomUUID()}`;
      if(!row.calendarUid)row.calendarUid=calendarUidForEntity(row.sessionId,project.conference);
      continue;
    }

    const key=`${row.date||''}|${String(row.session||'Session').trim().toLowerCase()}|${row.trackEntityId}`;
    if(row.sessionId)sessionByKey.set(key,row.sessionId);
    else if(sessionByKey.has(key))row.sessionId=sessionByKey.get(key);
    else {row.sessionId=`session-${crypto.randomUUID()}`;sessionByKey.set(key,row.sessionId);}
    if(!row.calendarUid)row.calendarUid=calendarUidForEntity(row.entityId,project.conference);
  }
  return project;
}

export async function buildPackage(project){
  ensureProjectIdentities(project);
  const config=project.conference||{}, rows=(project.rows||[]).filter(r=>r.title||r.session);
  const sessionOverrides=project.sessionOverrides||{};
  const builderWarnings=[];
  const people=[],peopleKey=new Map(),peopleNameKey=new Map(),locations=[],locationKey=new Map(),tracks=[],trackKey=new Map();
  const usedPeople=new Set(),usedLocations=new Set(),usedTracks=new Set(),usedSessions=new Set(),usedPresentations=new Set(),usedPosters=new Set();

  const personById=new Map();
  const ensurePerson=(name,affiliation,preferredId='')=>{
    const cleanName=String(name||'').trim();if(!cleanName)return null;
    const cleanAff=String(affiliation||'').trim();const nameKey=cleanName.toLowerCase();
    const key=`${nameKey}|${cleanAff.toLowerCase()}`;
    if(preferredId&&personById.has(preferredId)){
      const existing=personById.get(preferredId);if(cleanAff&&!existing.affiliations.includes(cleanAff))existing.affiliations.push(cleanAff);peopleKey.set(key,preferredId);return preferredId;
    }
    if(peopleKey.has(key))return peopleKey.get(key);
    if(!cleanAff&&peopleNameKey.has(nameKey))return peopleNameKey.get(nameKey);
    let id=preferredId||project.identityRegistry?.people?.[key]||project.identityRegistry?.people?.[`${nameKey}|`]||`person-${crypto.randomUUID()}`;
    if(usedPeople.has(id))id=ensureUnique(id,usedPeople);else usedPeople.add(id);
    const p={id,name:cleanName,affiliations:cleanAff?[cleanAff]:[]};people.push(p);personById.set(id,p);peopleKey.set(key,id);if(!peopleNameKey.has(nameKey))peopleNameKey.set(nameKey,id);return id;
  };

  const venueId='venue-main';
  locations.push({id:venueId,type:'venue',name:config.venueName||'Main venue',...(config.venueAddress?{address:config.venueAddress}:{})});usedLocations.add(venueId);locationKey.set(String(config.venueName||'Main venue').trim().toLowerCase(),venueId);
  const ensureLocation=(name,preferredId='')=>{const raw=String(name||'').trim();if(!raw)return venueId;const key=raw.toLowerCase();if(preferredId&&locations.some(x=>x.id===preferredId))return preferredId;if(locationKey.has(key))return locationKey.get(key);let id=preferredId||project.identityRegistry?.locations?.[key]||`loc-${crypto.randomUUID()}`;if(usedLocations.has(id))id=ensureUnique(id,usedLocations);else usedLocations.add(id);locations.push({id,type:'room',name:raw,parentLocationId:venueId});locationKey.set(key,id);return id;};
  const ensureTrack=(name,preferredId='')=>{const raw=String(name||'Common').trim()||'Common',key=raw.toLowerCase();if(preferredId&&tracks.some(x=>x.id===preferredId))return preferredId;if(trackKey.has(key))return trackKey.get(key);let id=preferredId||project.identityRegistry?.tracks?.[key]||(key==='common'?'common':`track-${crypto.randomUUID()}`);if(usedTracks.has(id))id=ensureUnique(id,usedTracks);else usedTracks.add(id);tracks.push({id,name:raw,order:tracks.length});trackKey.set(key,id);return id;};
  ensureTrack('Common','common');

  const sessionGroups=new Map(),posterRows=[];
  for(const row of rows){
    const type=String(row.type||'talk').toLowerCase();if(type==='poster'){posterRows.push(row);continue;}
    const locationId=ensureLocation(row.location,row.locationEntityId),trackId=ensureTrack(row.track||'Common',row.trackEntityId);
    const isStandalone=['break','meal','social','registration','special'].includes(type);
    const sessionTitle=String(row.session||(isStandalone?row.title:'Session')).trim()||'Session';
    const key=row.sessionId||`${row.date}|${sessionTitle.toLowerCase()}|${trackId}`;
    if(!sessionGroups.has(key))sessionGroups.set(key,{id:row.sessionId||key,title:sessionTitle,date:row.date,locationId,trackId,type:sessionType(type),rows:[]});
    const group=sessionGroups.get(key);group.rows.push(row);
    // Session-level edits propagate from the first row; warn elsewhere if rows disagree.
    if(!group.date)group.date=row.date;if(!group.locationId)group.locationId=locationId;if(!group.trackId)group.trackId=trackId;
  }

  const sessions=[],presentations=[];
  for(const group of sessionGroups.values()){
    let id=String(group.id||'').trim();if(!id||usedSessions.has(id))id=ensureUnique(`session-${slug(group.title,'session')}`,usedSessions);else usedSessions.add(id);
    const standalone=group.type!=='session';
    const start=minTime(group.rows.map(r=>r.start)),end=maxTime(group.rows.map(r=>r.end));
    const chairIds=[...new Set(group.rows.flatMap(r=>parseNames(r.chair).map((n,i)=>ensurePerson(n,'',(r.chairEntityIds||[])[i])).filter(Boolean)))];
    const distinctLocations=new Set(group.rows.map(r=>r.locationEntityId||'').filter(Boolean));
    const distinctTracks=new Set(group.rows.map(r=>r.trackEntityId||'').filter(Boolean));
    const distinctDates=new Set(group.rows.map(r=>r.date||'').filter(Boolean));
    if(distinctLocations.size>1)builderWarnings.push(`session ${id}: imported rows disagree on location; review the Session-level edit`);
    if(distinctTracks.size>1)builderWarnings.push(`session ${id}: imported rows disagree on track; review the Session-level edit`);
    if(distinctDates.size>1)builderWarnings.push(`session ${id}: imported rows disagree on date; review the Session-level edit`);
    const override=sessionOverrides[id]||{};
    const sequenceBump=Number(override.sequenceBump||0);
    const session={
      id,type:group.type,
      title:override.title??group.title,
      date:override.date??group.date??config.startDate,
      start:override.start??start,
      end:override.end??end,
      locationId:override.locationId??group.locationId,
      trackId:override.trackId??group.trackId,
      chairIds,presentationIds:[]
    };
    if(standalone){const row=group.rows[0];session.calendarUid=row.calendarUid;session.sequence=Number(row.sequence||0)+sequenceBump;session.description=row.abstract||'';if(row.doi)session.links=[{label:'Link',url:row.doi}];}
    else {
      for(const row of group.rows){
        let pid=stableEntityId(row,'presentation');if(usedPresentations.has(pid))pid=ensureUnique(pid,usedPresentations);else usedPresentations.add(pid);
        const speakerIds=parseNames(row.speaker).map((n,i)=>ensurePerson(n,row.affiliation,(row.speakerEntityIds||[])[i])).filter(Boolean);
        const p={id:pid,sessionId:id,type:presentationType(row.type),start:row.start||start,end:row.end||end,title:row.title||'Untitled presentation',speakerIds,abstract:row.abstract||'',keywords:[],links:[],calendarUid:row.calendarUid,sequence:Number(row.sequence||0)+sequenceBump};
        if(row.doi)p.links.push({label:'DOI / link',url:row.doi});
        presentations.push(p);session.presentationIds.push(pid);
      }
    }
    sessions.push(session);
  }

  const posters=[];
  if(posterRows.length){
    const grouped=new Map();
    for(const row of posterRows){const k=row.posterSessionId||`poster|${row.date||config.startDate}|${row.session||'Poster session'}`;if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(row);}
    for(const [groupKey,groupRows] of grouped){
      const date=groupRows[0].date||config.startDate,start=minTime(groupRows.map(r=>r.start))||'17:00',end=maxTime(groupRows.map(r=>r.end))||'19:00';
      const loc=ensureLocation(groupRows[0].location,groupRows[0].locationEntityId),track=ensureTrack(groupRows[0].track||'Common',groupRows[0].trackEntityId);
      let psId=String(groupRows[0].posterSessionId||groupKey);if(usedSessions.has(psId))psId=ensureUnique('poster-session',usedSessions);else usedSessions.add(psId);
      const psUid=groupRows[0].posterSessionCalendarUid||calendarUidForEntity(psId,config);groupRows.forEach(r=>{r.posterSessionCalendarUid=psUid;});
      const psOverride=sessionOverrides[psId]||{},psBump=Number(psOverride.sequenceBump||0);
      sessions.push({id:psId,type:'poster-session',title:psOverride.title??groupRows[0].session??'Poster session',date:psOverride.date??date,start:psOverride.start??start,end:psOverride.end??end,locationId:psOverride.locationId??loc,trackId:psOverride.trackId??track,chairIds:[],presentationIds:[],calendarUid:psUid,sequence:Math.max(...groupRows.map(r=>Number(r.sequence||0)),0)+psBump});
      groupRows.forEach((row,i)=>{const authorIds=parseNames(row.speaker).map((n,i)=>ensurePerson(n,row.affiliation,(row.speakerEntityIds||[])[i])).filter(Boolean);let posterId=stableEntityId(row,'poster');if(usedPosters.has(posterId))posterId=ensureUnique(posterId,usedPosters);else usedPosters.add(posterId);posters.push({id:posterId,posterSessionId:psId,number:row.posterNumber||String(i+1),title:row.title||`Poster ${i+1}`,authorIds,abstract:row.abstract||'',keywords:[],links:row.doi?[{label:'DOI / link',url:row.doi}]:[],calendarUid:row.calendarUid,sequence:Number(row.sequence||0)+psBump});});
    }
  }

  tracks.sort((a,b)=>a.order-b.order);
  const peopleOverrides=project.peopleOverrides||{};
  for(const person of people){const o=peopleOverrides[person.id];if(!o)continue;Object.assign(person,o);if(o.affiliation!==undefined)person.affiliations=String(o.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean);normalizePersonLinks(person,o);delete person.affiliation;}
  for(const extra of project.extraPeople||[]){if(!extra?.name)continue;let id=extra.id||`person-${crypto.randomUUID()}`;if(usedPeople.has(id))id=ensureUnique(id,usedPeople);else usedPeople.add(id);const person={id,name:extra.name,position:extra.position||'',affiliations:String(extra.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean),publicEmail:extra.publicEmail||'',orcid:extra.orcid||'',photoUrl:extra.photoUrl||'',papers:Array.isArray(extra.papers)?extra.papers:[],links:[]};normalizePersonLinks(person,extra);people.push(person);}
  for(const person of people){const asset=project.peoplePhotos?.[person.id];if(asset)person.photoUrl=personPhotoPath(person.id,asset);}
  const locationOverrides=project.locationOverrides||{};
  for(const loc of locations){const o=locationOverrides[loc.id];if(o)Object.assign(loc,o);}
  for(const extra of project.extraLocations||[]){if(!extra?.name)continue;let id=extra.id||`loc-${crypto.randomUUID()}`;if(usedLocations.has(id))id=ensureUnique(id,usedLocations);else usedLocations.add(id);const lat=Number(extra.lat),lon=Number(extra.lon);locations.push({id,type:extra.type||'venue',name:extra.name,...(extra.parentLocationId?{parentLocationId:extra.parentLocationId}:{}),...(extra.address?{address:extra.address}:{}),...(extra.mapUrl?{mapUrl:extra.mapUrl}:{}),...(Number.isFinite(lat)?{lat}:{}),...(Number.isFinite(lon)?{lon}:{})});}

  const conference={
    id:config.id,name:config.name||'Conference',shortName:config.shortName||config.name||'Conference',fullName:config.fullName||config.name||'Conference',
    startDate:config.startDate,endDate:config.endDate,timezone:config.timezone||'Europe/Helsinki',timezoneLabel:config.timezoneLabel||'',locale:config.locale||'en-GB',language:config.language||'en',city:config.city||'',country:config.country||'',officialWebsite:config.officialWebsite||'',contactEmail:config.contactEmail||'',mainVenueId:venueId,
    features:{posters:posters.length>0,photos:project.features?.photos!==false,notes:project.features?.notes!==false,pptxExport:project.features?.pptxExport!==false,friendBook:project.features?.friendBook!==false,calendarExport:project.features?.calendarExport!==false,announcements:project.features?.announcements!==false},links:project.links||[]
  };
  const programme={tracks,sessions,presentations,posters,announcements:(project.announcements||[]).filter(a=>String(a.message||'').trim()).map(a=>({id:a.id||crypto.randomUUID(),timestamp:a.timestamp||new Date().toISOString(),message:String(a.message||'').trim(),affectedIds:a.affectedIds||[]}))};
  const peopleJson={people};const locationsJson={locations};
  const sponsorAssets=(project.sponsorFiles||[]).map((f,i)=>`assets/sponsor-${i+1}${f.extension||fileExt(f)}`);
  const branding={
    logo:project.logo?.bytes?`assets/logo${project.logo.extension||'.png'}`:null,
    headerStyle:project.branding?.headerStyle||'text',typography:project.branding?.typography||'system',
    primary:project.branding?.primary||'#5b4b9a',secondary:project.branding?.secondary||'#2f7d68',accent:project.branding?.accent||project.branding?.primary||'#5b4b9a',
    darkMode:project.branding?.darkMode!==false,trackColors:project.branding?.trackColors||{},locationColors:project.branding?.locationColors||{},sponsorAssets
  };
  const now=new Date().toISOString();
  const version=Number(project.dataVersion||1);
  const changelog=[...(project.changelog||[]).filter(x=>Number(x.version)!==version),{version,publishedAt:now,message:project.releaseMessage||'Published from Conference Builder.'}];
  const manifest={schemaVersion:CURRENT_SCHEMA_VERSION,dataVersion:version,minimumEngineVersion:'1.1.0',publishedAt:now,files:['conference.json','programme.json','people.json','locations.json','branding.json'],checksums:{},changelog};
  const pkg={manifest,conference,programme,people:peopleJson,locations:locationsJson,branding};
  const report=validatePackage(pkg,{strictCalendarUid:true,policy:project.policy||{}});
  for(const row of rows){
    const confidence=Number(row.importConfidence??row.source?.confidence);
    if(row.source?.page&&Number.isFinite(confidence)&&confidence<0.7)report.warnings.push(`PDF page ${row.source.page}, row ${row.source.line||'?'}: low-confidence extraction (${Math.round(confidence*100)}%); organizer review required`);
  }
  report.warnings.push(...builderWarnings);
  const lastPublished=Number(project.lastPublishedVersion||0);
  if(lastPublished&&version<=lastPublished)report.errors.push(`dataVersion ${version} must be greater than the last published version ${lastPublished}`);
  return {pkg,report};
}

async function readProjectAsset(asset){
  if(!asset)return null;
  if(asset.bytes instanceof Uint8Array)return asset.bytes;
  if(asset.bytes instanceof ArrayBuffer)return new Uint8Array(asset.bytes);
  if(asset.blob instanceof Blob)return new Uint8Array(await asset.blob.arrayBuffer());
  if(asset instanceof Blob)return new Uint8Array(await asset.arrayBuffer());
  return null;
}

async function imageBytesToPng(asset,size){
  const bytes=await readProjectAsset(asset);if(!bytes)return null;
  const blob=new Blob([bytes],{type:asset.type||'image/png'});
  let bitmap;
  try{bitmap=await createImageBitmap(blob);}catch{return null;}
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,size,size);ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);
  const ratio=Math.min(size/bitmap.width,size/bitmap.height)*0.82,w=bitmap.width*ratio,h=bitmap.height*ratio;
  ctx.drawImage(bitmap,(size-w)/2,(size-h)/2,w,h);bitmap.close?.();
  const out=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  return new Uint8Array(await out.arrayBuffer());
}

async function fetchBytes(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error(`Could not include engine file ${path}`);return new Uint8Array(await r.arrayBuffer());}
function manifestText(pkg){return JSON.stringify({name:pkg.conference.name,short_name:pkg.conference.shortName||pkg.conference.name,start_url:'./',scope:'./',display:'standalone',background_color:'#000000',theme_color:pkg.branding.primary||'#000000',icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},null,2)+'\n';}
function sharePreviewSvg(pkg){const title=String(pkg.conference.shortName||pkg.conference.name||'Conference').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${pkg.branding.primary||'#000'}"/><rect x="60" y="60" width="1080" height="510" rx="44" fill="#fff" opacity=".96"/><text x="110" y="285" font-family="system-ui,sans-serif" font-weight="700" font-size="78" fill="#111">${title}</text><text x="110" y="370" font-family="system-ui,sans-serif" font-size="38" fill="#444">Conference Companion</text></svg>`;}
function workflowText(){return `name: Validate and deploy Conference Companion\n\non:\n  push:\n    branches: ["main"]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n  pages: write\n  id-token: write\n\nconcurrency:\n  group: "pages"\n  cancel-in-progress: false\n\njobs:\n  deploy:\n    environment:\n      name: github-pages\n      url: \${{ steps.deployment.outputs.page_url }}\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - name: Validate conference package\n        run: npm test\n      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v4\n        with:\n          path: "."\n      - name: Deploy to GitHub Pages\n        id: deployment\n        uses: actions/deploy-pages@v4\n`;}
function generatedPackageJson(){return JSON.stringify({name:'conference-companion-deployment',version:'1.1.0',private:true,type:'module',scripts:{schema:'node tools/schema-check.mjs conference',validate:'node tools/validate-conference.mjs conference',test:'npm run schema && npm run validate'}},null,2)+'\n';}

/** A repository-ready static deployment ZIP: stable engine + generated package + branded install assets. */
export async function packageZip(project){
  const {pkg,report}=await buildPackage(project);if(report.errors.length)throw new Error(report.errors.join('\n'));
  const jsons={'conference.json':JSON.stringify(pkg.conference,null,2)+'\n','programme.json':JSON.stringify(pkg.programme,null,2)+'\n','people.json':JSON.stringify(pkg.people,null,2)+'\n','locations.json':JSON.stringify(pkg.locations,null,2)+'\n','branding.json':JSON.stringify(pkg.branding,null,2)+'\n'};
  for(const [name,text] of Object.entries(jsons))pkg.manifest.checksums[name]=await hashBytes(text);
  const entries=[{name:'conference/conference-manifest.json',data:JSON.stringify(pkg.manifest,null,2)+'\n'},...Object.entries(jsons).map(([name,data])=>({name:`conference/${name}`,data}))];

  const logo=await readProjectAsset(project.logo);if(logo&&pkg.branding.logo)entries.push({name:`conference/${pkg.branding.logo}`,data:logo});
  for(let i=0;i<(project.sponsorFiles||[]).length;i++){const bytes=await readProjectAsset(project.sponsorFiles[i]);if(bytes)entries.push({name:`conference/${pkg.branding.sponsorAssets[i]}`,data:bytes});}
  for(const person of pkg.people.people||[]){const asset=project.peoplePhotos?.[person.id];if(!asset||!person.photoUrl)continue;const bytes=await readProjectAsset(asset);if(bytes)entries.push({name:`conference/${person.photoUrl}`,data:bytes});}

  // Include the stable attendee engine exactly as deployed with the Builder.
  for(const path of ENGINE_FILES)entries.push({name:path,data:await fetchBytes(`./${path}`)});
  entries.push({name:'tools/validate-conference.mjs',data:await fetchBytes('./tools/validate-conference.mjs')},{name:'tools/schema-check.mjs',data:await fetchBytes('./tools/schema-check.mjs')});
  for(const file of SCHEMA_FILES)entries.push({name:`schemas/${file}`,data:await fetchBytes(`./schemas/${file}`)});
  entries.push({name:'package.json',data:generatedPackageJson()},{name:'.github/workflows/deploy.yml',data:workflowText()},{name:'manifest.webmanifest',data:manifestText(pkg)},{name:'share-preview.svg',data:sharePreviewSvg(pkg)});

  const iconSource=project.appIcon?.bytes?project.appIcon:(project.logo?.bytes?project.logo:null);
  for(const size of [180,192,512]){
    let png=iconSource?await imageBytesToPng(iconSource,size):null;
    if(!png)png=await fetchBytes(`./icon-${size}.png`);
    entries.push({name:`icon-${size}.png`,data:png});
  }
  entries.push({name:'DEPLOY.md',data:`# Conference Companion deployment\n\nThis ZIP is repository-ready. Upload its contents to a fresh GitHub repository root, enable GitHub Pages with GitHub Actions, and push to main.\n\nConference: ${pkg.conference.name}\nData version: ${pkg.manifest.dataVersion}\nGenerated: ${pkg.manifest.publishedAt}\n`});
  return {blob:createStoredZip(entries),pkg,report};
}

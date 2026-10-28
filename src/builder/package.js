import {validatePackage,timeToMinutes} from '../validation.js';
import {createStoredZip} from '../zip.js';
import {calendarUidForEntity} from '../calendar.js';
import {CURRENT_SCHEMA_VERSION} from '../migrations.js';
import {validatePackageSchemas} from '../json-schema.js';

const ENGINE_FILES = [
  'index.html','app.js','bootstrap.js','styles.css','service-worker.js',
  'assets/fonts/manifest.json',
  'src/validation.js','src/safe-url.js','src/json-schema.js','src/migrations.js','src/package-store.js','src/model.js','src/user-store.js',
  'src/calendar.js','src/vcard.js','src/qrcode.js','src/backup.js','src/zip.js',
  'src/vendor/qr-scanner/qr-scanner.min.js','src/vendor/qr-scanner/qr-scanner-worker.min.js','src/vendor/qr-scanner/LICENSE'
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
function legacyFont(value){return value==='serif'?'noto-serif':value==='condensed'?'ibm-plex-sans-condensed':'inter';}
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
  project.identityRegistry.personRecords ||= {};
  project.sessionOverrides ||= {};
  const registry=project.identityRegistry;
  const canonicalPersonId=id=>{const seen=new Set();while(project.personIdAliases?.[id]&&!seen.has(id)){seen.add(id);id=project.personIdAliases[id];}return id;};
  const norm=value=>String(value||'').trim().toLocaleLowerCase();
  const confirmedDifferent=(ids)=>{
    const distinct=[...new Set(ids.map(canonicalPersonId))];if(distinct.length<2)return false;
    const decisions=project.identityDecisions?.pairs||{};
    for(let i=0;i<distinct.length;i++)for(let j=i+1;j<distinct.length;j++){
      if(decisions[[distinct[i],distinct[j]].sort().join('::')]!=='different')return false;
    }
    return true;
  };
  // Migrate the legacy name|affiliation index without changing any existing ID.
  for(const [key,id] of Object.entries(registry.people)){
    const canonical=canonicalPersonId(id),separator=key.indexOf('|');
    if(separator<0)continue;
    const record=registry.personRecords[canonical] ||= {names:[],affiliations:[],explicitIds:[]};
    const name=key.slice(0,separator),affiliation=key.slice(separator+1);
    if(name&&!record.names.includes(name))record.names.push(name);
    if(affiliation&&!record.affiliations.includes(affiliation))record.affiliations.push(affiliation);
  }
  const stats={automaticallyConsolidated:0,linkedAppearances:0,requiresReview:0},autoLinkedIds=new Set((registry.autoConsolidatedIds||[]).map(canonicalPersonId));
  project.identityWarnings=[];
  const rows=project.rows||[];
  // One title can represent several separate sessions in the same day.
  // Assign by location AND temporal continuity, never by title alone.
  const groupsByKey=new Map();
  const sessionGapMinutes=30;
  const timeValue=value=>{const t=timeToMinutes(value);return Number.isFinite(t)?t:null;};
  const registerGroup=(key,id,row)=>{
    const start=timeValue(row.start),end=timeValue(row.end);
    const groups=groupsByKey.get(key)||[];
    let group=groups.find(g=>g.id===id);
    if(!group){group={id,start,end};groups.push(group);groupsByKey.set(key,groups);}
    else if(start!==null&&end!==null){
      group.start=group.start===null?start:Math.min(group.start,start);
      group.end=group.end===null?end:Math.max(group.end,end);
    }
    return group;
  };
  const assignGroup=(key,row,existingId=row.sessionId)=>{
    const start=timeValue(row.start),end=timeValue(row.end);
    const groups=groupsByKey.get(key)||[];
    const touches=g=>start!==null&&end!==null&&g.start!==null&&g.end!==null&&
      start<=g.end+sessionGapMinutes && end>=g.start-sessionGapMinutes;
    if(existingId){
      const previous=groups.find(g=>g.id===existingId);
      // Repair previously auto-merged Builder sessions without changing
      // presentation IDs or calendar UIDs. Respect canonical imported sessions.
      const official=String(row.source?.id||'').includes(':package:');
      if(previous&&!official&&start!==null&&end!==null&&previous.start!==null&&previous.end!==null&&!touches(previous)){
        const alternative=groups.filter(touches);
        const splitId=alternative.length===1?alternative[0].id:`session-${crypto.randomUUID()}`;
        registerGroup(key,splitId,row);
        return splitId;
      }
      registerGroup(key,existingId,row);return existingId;
    }
    const possible=groups.filter(touches);
    // A poster list often has no individual start/end times; in that case
    // the named poster session is the only meaningful grouping evidence.
    const timelessPoster=(key.startsWith('poster|')&&start===null&&end===null);
    const id=possible.length===1?possible[0].id:
      (timelessPoster&&(groupsByKey.get(key)||[]).length===1
        ?groupsByKey.get(key)[0].id:`session-${crypto.randomUUID()}`);
    registerGroup(key,id,row);
    return id;
  };
  const personId=(name,affiliation='',preferred='',role='speaker')=>{
    const n=norm(name),a=norm(affiliation);if(!n)return '';
    const records=registry.personRecords;
    const candidates=[...new Set(Object.entries(records).filter(([,r])=>r.names.includes(n)).map(([id])=>canonicalPersonId(id)))];
    const exact=a?candidates.filter(id=>(records[id]?.affiliations||[]).includes(a)):[];
    let id=preferred?canonicalPersonId(preferred):'';
    if(!id&&exact.length===1){id=exact[0];autoLinkedIds.add(id);stats.linkedAppearances++;}
    if(!id&&!a&&candidates.length===1&&(records[candidates[0]]?.affiliations?.length||records[candidates[0]]?.explicitIds?.length||role==='chair')){id=candidates[0];autoLinkedIds.add(id);stats.linkedAppearances++;}
    // A name alone cannot choose between two confirmed people, and a new
    // affiliation cannot prove that two same-name records are the same person.
    if(!id&&((a&&exact.length>1)||(!a&&candidates.length>1))&&!confirmedDifferent(a?exact:candidates)){
      stats.requiresReview++;
      project.identityWarnings.push(`Ambiguous person "${name}"${a?` at ${affiliation}`:''}: choose an existing profile in Review & fix.`);
    }
    if(!id)id=`person-${crypto.randomUUID()}`;
    const record=records[id] ||= {names:[],affiliations:[],explicitIds:[]};
    if(!record.names.includes(n))record.names.push(n);
    if(a&&!record.affiliations.includes(a))record.affiliations.push(a);
    const key=`${n}|${a}`;
    if(!registry.people[key]||canonicalPersonId(registry.people[key])===id)registry.people[key]=id;
    return id;
  };
  const locationId=(name,preferred='')=>{if(preferred)return preferred;const k=String(name||'').trim().toLowerCase();if(!k)return 'venue-main';return registry.locations[k]||(registry.locations[k]=`loc-${crypto.randomUUID()}`);};
  const trackId=(name,preferred='')=>{if(preferred)return preferred;const k=String(name||'Common').trim().toLowerCase()||'common';if(k==='common')return registry.tracks[k]||(registry.tracks[k]='common');return registry.tracks[k]||(registry.tracks[k]=`track-${crypto.randomUUID()}`);};
  // Sorting only during initial grouping makes imports with interleaved tracks
  // deterministic; keep the organizer's row ordering unchanged.
  const orderedRows=[...rows].sort((a,b)=>
    String(a.date||'').localeCompare(String(b.date||'')) ||
    (timeValue(a.start)??Infinity)-(timeValue(b.start)??Infinity) ||
    String(a.id||'').localeCompare(String(b.id||''))
  );
  // Register affiliated speakers before resolving name-only chair references.
  // Their row order must not decide whether a chair gets a duplicate identity.
  for(const row of orderedRows){
    if(!String(row.affiliation||'').trim())continue;
    const names=parseNames(row.speaker);
    row.speakerEntityIds=names.map((name,i)=>personId(name,row.affiliation,(row.speakerEntityIds||[])[i]));
  }
  for(const row of orderedRows){
    if(!row.id)row.id=crypto.randomUUID();
    const type=String(row.type||'talk').toLowerCase();
    if(!row.entityId)row.entityId=stableEntityId(row,type==='poster'?'poster':'presentation');
    if(!Number.isFinite(Number(row.sequence)))row.sequence=0;
    row.locationEntityId=locationId(row.location,row.locationEntityId);
    row.trackEntityId=trackId(row.track||'Common',row.trackEntityId);
    const speakerNames=parseNames(row.speaker),chairNames=parseNames(row.chair);
    row.speakerEntityIds=speakerNames.map((name,i)=>personId(name,row.affiliation,(row.speakerEntityIds||[])[i]));
    row.chairEntityIds=chairNames.map((name,i)=>personId(name,'',(row.chairEntityIds||[])[i],'chair'));
    if(!String(row.affiliation||'').trim()){
      for(const [index,name] of speakerNames.entries()){
        if(row.personIdentityResolved||row.personIdentityResolvedNames?.[name.toLowerCase()]||(row.speakerEntityIds?.[index]&&row.source?.id?.includes(':package:')))continue;
        const key=name.toLowerCase(),known=[...new Set(Object.entries(registry.people).filter(([k])=>k.startsWith(`${key}|`)).map(([,id])=>canonicalPersonId(id)))];
        if(known.length>1&&!confirmedDifferent(known)){row.personIdentityConflict=true;row.personIdentityCandidates=[...new Set([...known,...(row.speakerEntityIds||[])])];}
      }
    }

    if(type==='poster'){
      const key=`poster|${row.date||project.conference?.startDate||''}|${String(row.session||'Poster session').trim().toLowerCase()}|${row.locationEntityId}|${row.trackEntityId}`;
      // Poster sessions are events too: separate morning and afternoon sessions.
      // Reuse the explicit imported posterSessionId, if supplied.
      row.posterSessionId=assignGroup(key,row,row.posterSessionId);
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

    const key=`${row.date||''}|${String(row.session||'Session').trim().toLowerCase()}|${row.trackEntityId}|${row.locationEntityId}`;
    row.sessionId=assignGroup(key,row);
    if(!row.calendarUid)row.calendarUid=calendarUidForEntity(row.entityId,project.conference);
  }
  const noAffByName=new Map();
  for(const row of rows){
    for(const [role,field] of [['speaker','speakerEntityIds'],['chair','chairEntityIds']]){
      if(role==='speaker'&&String(row.affiliation||'').trim())continue;
      const names=parseNames(row[role]);for(const [index,name] of names.entries()){
        const key=name.toLowerCase(),ids=row[field]||[];if(!noAffByName.has(key))noAffByName.set(key,[]);
        noAffByName.get(key).push({row,name,id:ids[index]});
      }
    }
  }
  for(const [name,occurrences] of noAffByName){
    const known=Object.entries(registry.people).filter(([identity])=>identity.startsWith(`${name}|`)).map(([,id])=>id);
    const candidates=[...new Set([...occurrences.map(x=>x.id),...known].filter(Boolean).map(canonicalPersonId))];
    if(candidates.length>1&&!confirmedDifferent(known.length>1?known:candidates))for(const item of occurrences){
      if(item.row.personIdentityResolved||item.row.personIdentityResolvedNames?.[name])continue;
      item.row.personIdentityConflict=true;
      item.row.personIdentityCandidates=[...new Set([...(item.row.personIdentityCandidates||[]),...candidates])];
      item.row.personIdentityCandidatesByName={...(item.row.personIdentityCandidatesByName||{}),[name]:candidates};
    }
  }
  stats.requiresReview=rows.filter(row=>row.personIdentityConflict&&!row.personIdentityResolved).length;
  registry.autoConsolidatedIds=[...autoLinkedIds];
  stats.automaticallyConsolidated=autoLinkedIds.size;
  project.identityStats=stats;
  return project;
}

export async function buildPackage(project){
  ensureProjectIdentities(project);
  const config=project.conference||{}, rows=(project.rows||[]);
  const sessionOverrides=project.sessionOverrides||{};
  const builderWarnings=[];
  const builderErrors=[];
  const people=[],peopleKey=new Map(),peopleNameKey=new Map(),locations=[],locationKey=new Map(),tracks=[],trackKey=new Map();
  const usedPeople=new Set(),usedLocations=new Set(),usedTracks=new Set(),usedSessions=new Set(),usedPresentations=new Set(),usedPosters=new Set();

  const personById=new Map();
  const ensurePerson=(name,affiliation,preferredId='')=>{
    const cleanName=String(name||'').trim();if(!cleanName)return null;
    const cleanAff=String(affiliation||'').trim();const nameKey=cleanName.toLowerCase();
    const key=`${nameKey}|${cleanAff.toLowerCase()}`;
    if(preferredId&&personById.has(preferredId)){
      const existing=personById.get(preferredId);for(const aff of cleanAff.split(';').map(x=>x.trim()).filter(Boolean))if(!existing.affiliations.includes(aff))existing.affiliations.push(aff);peopleKey.set(key,preferredId);return preferredId;
    }
    // Explicit IDs are authoritative, including when two people share both a
    // name and an affiliation. Never collapse those records by display fields.
    if(!preferredId&&peopleKey.has(key))return peopleKey.get(key);
    if(!cleanAff&&!preferredId&&peopleNameKey.has(nameKey)){
      const sameName=people.filter(p=>p.name.toLowerCase()===nameKey);
      if(sameName.length===1)return sameName[0].id;
      if(sameName.length>1)builderWarnings.push(`Ambiguous person "${cleanName}" without an affiliation; identity kept separate for organizer review`);
    }
    let id=preferredId||project.identityRegistry?.people?.[key]||`person-${crypto.randomUUID()}`;
    if(usedPeople.has(id))id=ensureUnique(id,usedPeople);else usedPeople.add(id);
    const p={id,name:cleanName,affiliations:cleanAff.split(';').map(x=>x.trim()).filter(Boolean)};people.push(p);personById.set(id,p);peopleKey.set(key,id);if(!peopleNameKey.has(nameKey))peopleNameKey.set(nameKey,id);return id;
  };

  const venueId='venue-main';
  locations.push({id:venueId,type:'venue',name:config.venueName||'Main venue',...(config.venueAddress?{address:config.venueAddress}:{})});usedLocations.add(venueId);locationKey.set(String(config.venueName||'Main venue').trim().toLowerCase(),venueId);
  const ensureLocation=(name,preferredId='')=>{const raw=String(name||'').trim();if(!raw)return venueId;const key=raw.toLowerCase();if(preferredId&&locations.some(x=>x.id===preferredId))return preferredId;if(locationKey.has(key))return locationKey.get(key);let id=preferredId||project.identityRegistry?.locations?.[key]||`loc-${crypto.randomUUID()}`;if(usedLocations.has(id))id=ensureUnique(id,usedLocations);else usedLocations.add(id);locations.push({id,type:'room',name:raw,parentLocationId:venueId});locationKey.set(key,id);return id;};
  const ensureTrack=(name,preferredId='')=>{const raw=String(name||'Common').trim()||'Common',key=raw.toLowerCase();if(preferredId&&tracks.some(x=>x.id===preferredId))return preferredId;if(trackKey.has(key))return trackKey.get(key);let id=preferredId||project.identityRegistry?.tracks?.[key]||(key==='common'?'common':`track-${crypto.randomUUID()}`);if(usedTracks.has(id))id=ensureUnique(id,usedTracks);else usedTracks.add(id);tracks.push({id,name:raw,order:tracks.length});trackKey.set(key,id);return id;};
  if(rows.length)ensureTrack('Common','common');

  const sessionGroups=new Map(),posterRows=[];
  for(const row of rows){
    const type=String(row.type||'talk').toLowerCase();if(type==='poster'){posterRows.push(row);continue;}
    const locationId=ensureLocation(row.location,row.locationEntityId),trackId=ensureTrack(row.track||'Common',row.trackEntityId);
    const isStandalone=['break','meal','social','registration','special'].includes(type);
    const sessionTitle=String(row.session||(isStandalone?row.title:'')).trim();
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
    if(distinctLocations.size>1&&!override.locationId)builderErrors.push(`session ${id}: source rows disagree on location; choose one in Session-level edits`);
    if(distinctTracks.size>1&&!override.trackId)builderErrors.push(`session ${id}: source rows disagree on track; choose one in Session-level edits`);
    if(distinctDates.size>1&&!override.date)builderErrors.push(`session ${id}: source rows disagree on date; correct the rows or choose a Session-level date`);
    const sequenceBump=Number(override.sequenceBump||0);
    const session={
      id,type:group.type,
      title:override.title??group.title,
      date:override.date??group.date??'',
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
        const p={id:pid,sessionId:id,type:presentationType(row.type),start:row.start||start,end:row.end||end,title:row.title||'',speakerIds,abstract:row.abstract||'',keywords:[],links:[],calendarUid:row.calendarUid,sequence:Number(row.sequence||0)+sequenceBump};
        if(row.doi)p.links.push({label:'DOI / link',url:row.doi});
        presentations.push(p);session.presentationIds.push(pid);
      }
    }
    sessions.push(session);
  }

  const posters=[];
  if(posterRows.length){
    const grouped=new Map();
    for(const row of posterRows){const k=row.posterSessionId||`poster|${row.date||''}|${row.session||''}|${row.location||''}|${row.track||''}`;if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(row);}
    for(const [groupKey,groupRows] of grouped){
      const date=groupRows[0].date||'',start=minTime(groupRows.map(r=>r.start)),end=maxTime(groupRows.map(r=>r.end));
      const loc=ensureLocation(groupRows[0].location,groupRows[0].locationEntityId),track=ensureTrack(groupRows[0].track||'Common',groupRows[0].trackEntityId);
      let psId=String(groupRows[0].posterSessionId||groupKey);if(usedSessions.has(psId))psId=ensureUnique('poster-session',usedSessions);else usedSessions.add(psId);
      const psUid=groupRows[0].posterSessionCalendarUid||calendarUidForEntity(psId,config);groupRows.forEach(r=>{r.posterSessionCalendarUid=psUid;});
      const psOverride=sessionOverrides[psId]||{},psBump=Number(psOverride.sequenceBump||0);
      const rowDates=new Set(groupRows.map(r=>r.date||'').filter(Boolean)),rowLocations=new Set(groupRows.map(r=>r.locationEntityId||r.location||'').filter(Boolean)),rowTracks=new Set(groupRows.map(r=>r.trackEntityId||r.track||'').filter(Boolean)),rowSessions=new Set(groupRows.map(r=>String(r.session||'').trim()).filter(Boolean));
      if(rowDates.size>1&&!psOverride.date)builderErrors.push(`poster session ${psId}: source rows disagree on date; correct the rows or set the Session-level date`);
      if(rowLocations.size>1&&!psOverride.locationId)builderErrors.push(`poster session ${psId}: source rows disagree on location; choose one in Session-level edits`);
      if(rowTracks.size>1&&!psOverride.trackId)builderErrors.push(`poster session ${psId}: source rows disagree on track; choose one in Session-level edits`);
      if(rowSessions.size>1&&!psOverride.title)builderErrors.push(`poster session ${psId}: source rows disagree on session title; choose one in Session-level edits`);
      sessions.push({id:psId,type:'poster-session',title:psOverride.title??groupRows[0].session??'',date:psOverride.date??date,start:psOverride.start??start,end:psOverride.end??end,locationId:psOverride.locationId??loc,trackId:psOverride.trackId??track,chairIds:[],presentationIds:[],calendarUid:psUid,sequence:Math.max(...groupRows.map(r=>Number(r.sequence||0)),0)+psBump});
      groupRows.forEach((row,i)=>{const authorIds=parseNames(row.speaker).map((n,i)=>ensurePerson(n,row.affiliation,(row.speakerEntityIds||[])[i])).filter(Boolean);let posterId=stableEntityId(row,'poster');if(usedPosters.has(posterId))posterId=ensureUnique(posterId,usedPosters);else usedPosters.add(posterId);posters.push({id:posterId,posterSessionId:psId,number:row.posterNumber||String(i+1),title:row.title||'',authorIds,abstract:row.abstract||'',keywords:[],links:row.doi?[{label:'DOI / link',url:row.doi}]:[],calendarUid:row.calendarUid,sequence:Number(row.sequence||0)+psBump});});
    }
  }

  tracks.sort((a,b)=>a.order-b.order);
  const peopleOverrides=project.peopleOverrides||{};
  for(const person of people){const o=peopleOverrides[person.id];if(!o)continue;Object.assign(person,o);if(o.affiliation!==undefined)person.affiliations=String(o.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean);normalizePersonLinks(person,o);delete person.affiliation;}
  for(const extra of project.extraPeople||[]){if(!extra?.name)continue;let id=extra.id||`person-${crypto.randomUUID()}`;if(usedPeople.has(id))id=ensureUnique(id,usedPeople);else usedPeople.add(id);const person={id,name:extra.name,position:extra.position||'',affiliations:String(extra.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean),publicEmail:extra.publicEmail||'',orcid:extra.orcid||'',photoUrl:extra.photoUrl||'',papers:Array.isArray(extra.papers)?extra.papers:[],links:[]};normalizePersonLinks(person,extra);people.push(person);}
  for(const person of people){const asset=project.peoplePhotos?.[person.id];if(asset)person.photoUrl=personPhotoPath(person.id,asset);}
  const locationOverrides=project.locationOverrides||{};
  for(const loc of locations){const o=locationOverrides[loc.id];if(o)Object.assign(loc,o);}
  for(const extra of project.extraLocations||[]){if(!extra?.name)continue;let id=extra.id||`loc-${crypto.randomUUID()}`;if(usedLocations.has(id))id=ensureUnique(id,usedLocations);else usedLocations.add(id);const lat=extra.lat==null||String(extra.lat).trim()===''?NaN:Number(extra.lat),lon=extra.lon==null||String(extra.lon).trim()===''?NaN:Number(extra.lon);locations.push({id,type:extra.type||'venue',name:extra.name,...(extra.parentLocationId?{parentLocationId:extra.parentLocationId}:{}),...(extra.address?{address:extra.address}:{}),...(extra.mapUrl?{mapUrl:extra.mapUrl}:{}),...(Number.isFinite(lat)&&lat>=-90&&lat<=90?{lat}:{}),...(Number.isFinite(lon)&&lon>=-180&&lon<=180?{lon}:{})});}

  const conference={
    id:config.id,name:config.name||'',shortName:config.shortName||config.name||'',fullName:config.fullName||config.name||'',
    startDate:config.startDate,endDate:config.endDate,timezone:config.timezone||'Europe/Helsinki',timezoneLabel:config.timezoneLabel||'',locale:config.locale||'en-GB',language:config.language||'en',city:config.city||'',country:config.country||'',officialWebsite:config.officialWebsite||'',contactEmail:config.contactEmail||'',mainVenueId:venueId,
    features:{posters:posters.length>0,photos:project.features?.photos!==false,notes:project.features?.notes!==false,pptxExport:project.features?.pptxExport!==false,friendBook:project.features?.friendBook!==false,calendarExport:project.features?.calendarExport!==false,announcements:project.features?.announcements!==false},links:project.links||[]
  };
  const programme={tracks,sessions,presentations,posters,announcements:(project.announcements||[]).filter(a=>String(a.message||'').trim()).map(a=>({id:a.id||crypto.randomUUID(),timestamp:a.timestamp||new Date().toISOString(),message:String(a.message||'').trim(),affectedIds:a.affectedIds||[]}))};
  const peopleJson={people};const locationsJson={locations};
  const logoLightAsset=project.logoLight?.bytes?project.logoLight:project.logo;
  const logoDarkAsset=project.logoDark?.bytes?project.logoDark:null;
  const logoLight=logoLightAsset?.bytes?'assets/logo-light'+(logoLightAsset.extension||fileExt(logoLightAsset)):null;
  const logoDark=logoDarkAsset?.bytes?'assets/logo-dark'+(logoDarkAsset.extension||fileExt(logoDarkAsset)):null;
  const sponsorLogos=(project.sponsorFiles||[]).map((entry,i)=>{
    const legacy=entry?.bytes?{name:entry.name,light:entry,dark:null,height:48}:entry||{};
    const light=legacy.light?.bytes?`assets/sponsor-${i+1}-light${legacy.light.extension||fileExt(legacy.light)}`:null;
    const dark=legacy.dark?.bytes?`assets/sponsor-${i+1}-dark${legacy.dark.extension||fileExt(legacy.dark)}`:null;
    return{name:String(legacy.name||`Sponsor ${i+1}`),light,dark,height:Math.max(20,Math.min(120,Number(legacy.height)||48))};
  });
  const sponsorAssets=sponsorLogos.map(x=>x.light||x.dark).filter(Boolean);
  const appearance=project.branding?.defaultAppearance|| (project.branding?.darkMode===true?'dark':project.branding?.darkMode===false?'system':'light');
  const brandMode=project.branding?.brandMode||(project.branding?.headerStyle==='logo'?'logo':project.branding?.headerStyle==='text'?'combined':project.branding?.headerStyle||'combined');
  const headingFont=project.branding?.headingFont||legacyFont(project.branding?.typography);
  const bodyFont=project.branding?.bodyFont||legacyFont(project.branding?.typography);
  const branding={
    logo:logoLight,logoLight,logoDark,
    headerStyle:brandMode,brandMode,logoAlignment:project.branding?.logoAlignment||'left',logoSize:Math.max(24,Math.min(96,Number(project.branding?.logoSize)||36)),
    headerBackgroundLight:project.branding?.headerBackgroundLight||'#ffffff',headerBackgroundDark:project.branding?.headerBackgroundDark||'#191a1d',
    typography:project.branding?.typography||'system',headingFont,bodyFont,defaultAppearance:appearance,
    primary:project.branding?.primary||'#5b4b9a',secondary:project.branding?.secondary||'#2f7d68',accent:project.branding?.accent||project.branding?.primary||'#5b4b9a',
    darkMode:appearance==='dark',trackColors:project.branding?.trackColors||{},locationColors:project.branding?.locationColors||{},sponsorAssets,sponsorLogos
  };
  const now=new Date().toISOString();
  const version=Number(project.dataVersion||1);
  const changelog=[...(project.changelog||[])];
  const manifest={schemaVersion:CURRENT_SCHEMA_VERSION,dataVersion:version,minimumEngineVersion:'1.2.8',publishedAt:now,files:['conference.json','programme.json','people.json','locations.json','branding.json'],checksums:{},changelog};
  const pkg={manifest,conference,programme,people:peopleJson,locations:locationsJson,branding};
  const report=validatePackage(pkg,{strictCalendarUid:true,policy:project.policy||{}});
  report.errors.push(...builderErrors);
  report.errors.push(...await validatePackageSchemas(pkg));
  for(const [index,row] of rows.entries()){
    const label=row.source?.row?`source row ${row.source.row}`:row.source?.page?`PDF page ${row.source.page}, line ${row.source.line||'?'}`:`programme row ${index+1}`;
    const posterOverride=String(row.type||'').toLowerCase()==='poster'?(sessionOverrides[row.posterSessionId]||{}):{};
    if(!String(row.title||'').trim())report.errors.push(`${label}: presentation/poster title is required; enter it before export`);
    for(const field of ['date','start','end'])if(!String(row[field]||'').trim()&&!String(posterOverride[field]||'').trim())report.errors.push(`${label}: ${field} is required; enter the known programme information before export`);
    if(!String(row.session||'').trim()&&!['break','meal','social','registration','special'].includes(String(row.type||'').toLowerCase()))report.errors.push(`${label}: session name is required; enter it before export`);
  }
  for(const row of rows){
    for(const warning of row.importWarnings||[])report.warnings.push(`PDF page ${row.source?.page||'?'}, row ${row.source?.line||'?'}: ${warning}`);
    const confidence=Number(row.importConfidence??row.source?.confidence);
    if(row.source?.page&&Number.isFinite(confidence)&&confidence<0.7)report.warnings.push(`PDF page ${row.source.page}, row ${row.source.line||'?'}: low-confidence extraction (${Math.round(confidence*100)}%); organizer review required`);
  }
  report.warnings.push(...builderWarnings);
  report.warnings.push(...(project.identityWarnings||[]));
  for(const row of rows)if(row.personIdentityConflict&&!row.personIdentityResolved)report.warnings.push(`Ambiguous person identity in programme row ${row.source?.row||row.source?.line||row.id}: select a person ID or provide an affiliation`);
  const lastPublished=Number(project.lastPublishedVersion||0);
  const fingerprint=await packageContentFingerprint(pkg);
  const confirmed=(project.confirmedPublications||[]).find(x=>Number(x.version)===version);
  if(confirmed&&confirmed.fingerprint!==fingerprint)report.errors.push(`dataVersion ${version} was already confirmed for different content; increase the data version before exporting`);
  if(lastPublished&&version<lastPublished)report.errors.push(`dataVersion ${version} cannot be lower than the last published version ${lastPublished}`);
  if(lastPublished&&version===lastPublished&&(!confirmed||confirmed.fingerprint!==fingerprint))report.errors.push(`dataVersion ${version} must be greater than the last published version ${lastPublished}, unless its confirmed content is unchanged`);
  return {pkg,report};
}

function stableJson(value){
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function packageContentFingerprint(pkg){
  const content={conference:pkg.conference,programme:pkg.programme,people:pkg.people,locations:pkg.locations,branding:pkg.branding};
  return hashBytes(stableJson(content));
}
export async function confirmProjectPublication(project,pkg){
  const version=Number(pkg?.manifest?.dataVersion);if(!Number.isInteger(version)||version<1)throw new Error('A valid package dataVersion is required');
  if(version<Number(project.lastPublishedVersion||0))throw new Error(`Cannot confirm version ${version} after version ${project.lastPublishedVersion} was published`);
  const fingerprint=await packageContentFingerprint(pkg);
  project.confirmedPublications=Array.isArray(project.confirmedPublications)?project.confirmedPublications:[];
  const previous=project.confirmedPublications.find(x=>Number(x.version)===version);
  if(previous&&previous.fingerprint!==fingerprint)throw new Error(`Version ${version} was already confirmed for different content`);
  const publishedAt=new Date().toISOString();
  if(!previous)project.confirmedPublications.push({version,fingerprint,publishedAt});
  project.lastPublishedVersion=Math.max(Number(project.lastPublishedVersion||0),version);
  project.lastPublishedAt=publishedAt;
  project.changelog=[...(project.changelog||[]).filter(x=>Number(x.version)!==version),{version,publishedAt,message:project.releaseMessage||'Published release'}];
  return project;
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
function manifestText(pkg){return JSON.stringify({name:pkg.conference.name,short_name:pkg.conference.shortName||pkg.conference.name,id:'./',start_url:'./',scope:'./',display:'standalone',background_color:'#000000',theme_color:pkg.branding.primary||'#000000',icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]},null,2)+'\n';}
function sharePreviewSvg(pkg){const title=String(pkg.conference.shortName||pkg.conference.name||'Conference').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${pkg.branding.primary||'#000'}"/><rect x="60" y="60" width="1080" height="510" rx="44" fill="#fff" opacity=".96"/><text x="110" y="285" font-family="system-ui,sans-serif" font-weight="700" font-size="78" fill="#111">${title}</text><text x="110" y="370" font-family="system-ui,sans-serif" font-size="38" fill="#444">Conference Companion</text></svg>`;}
export function workflowText(){return `name: Validate and deploy Conference Companion\n\non:\n  push:\n    branches: ["main"]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n  pages: write\n  id-token: write\n\nconcurrency:\n  group: "pages"\n  cancel-in-progress: false\n\njobs:\n  deploy:\n    environment:\n      name: github-pages\n      url: \${{ steps.deployment.outputs.page_url }}\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - name: Validate conference package\n        run: npm test\n      - name: Stage public application files\n        run: |\n          mkdir _site\n          cp -r index.html app.js bootstrap.js styles.css service-worker.js manifest.webmanifest icon-*.png share-preview.svg assets src schemas conference tools _site/\n      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v4\n        with:\n          path: "_site"\n      - name: Deploy to GitHub Pages\n        id: deployment\n        uses: actions/deploy-pages@v4\n`;}
function generatedPackageJson(){return JSON.stringify({name:'conference-companion-deployment',version:'1.2.8',private:true,type:'module',scripts:{schema:'node tools/schema-check.mjs conference',validate:'node tools/validate-conference.mjs conference',test:'npm run schema && npm run validate'}},null,2)+'\n';}

/** A repository-ready static deployment ZIP: stable engine + generated package + branded install assets. */
export async function packageZip(project){
  const {pkg,report}=await buildPackage(project);if(report.errors.length)throw new Error(report.errors.join('\n'));
  const jsons={'conference.json':JSON.stringify(pkg.conference,null,2)+'\n','programme.json':JSON.stringify(pkg.programme,null,2)+'\n','people.json':JSON.stringify(pkg.people,null,2)+'\n','locations.json':JSON.stringify(pkg.locations,null,2)+'\n','branding.json':JSON.stringify(pkg.branding,null,2)+'\n'};
  for(const [name,text] of Object.entries(jsons))pkg.manifest.checksums[name]=await hashBytes(text);
  const entries=[{name:'conference/conference-manifest.json',data:JSON.stringify(pkg.manifest,null,2)+'\n'},...Object.entries(jsons).map(([name,data])=>({name:`conference/${name}`,data}))];

  for(const [asset,source] of [[pkg.branding.logoLight,project.logoLight?.bytes?project.logoLight:project.logo],[pkg.branding.logoDark,project.logoDark]]){
    if(asset&&source?.bytes){const bytes=await readProjectAsset(source);if(bytes)entries.push({name:`conference/${asset}`,data:bytes});}
  }
  for(let i=0;i<(project.sponsorFiles||[]).length;i++){
    const item=project.sponsorFiles[i]?.bytes?{light:project.sponsorFiles[i],dark:null}:project.sponsorFiles[i];
    for(const theme of ['light','dark']){const asset=pkg.branding.sponsorLogos[i]?.[theme],source=item?.[theme];if(!asset||!source?.bytes)continue;const bytes=await readProjectAsset(source);if(bytes)entries.push({name:`conference/${asset}`,data:bytes});}
  }
  for(const person of pkg.people.people||[]){const asset=project.peoplePhotos?.[person.id];if(!asset||!person.photoUrl)continue;const bytes=await readProjectAsset(asset);if(bytes)entries.push({name:`conference/${person.photoUrl}`,data:bytes});}

  // Include the stable attendee engine exactly as deployed with the Builder.
  for(const path of ENGINE_FILES){
    if(path==='index.html'){
      const bytes=await fetchBytes('./index.html');
      let html=new TextDecoder().decode(bytes);
      const description=`Conference companion for ${pkg.conference.name}`;
      const escapeAttr=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
      html=html.replace('</head>',`  <meta property="og:type" content="website">\n  <meta property="og:title" content="${escapeAttr(pkg.conference.name)}">\n  <meta property="og:description" content="${escapeAttr(description)}">\n  <meta property="og:image" content="share-preview.svg">\n  <meta name="twitter:card" content="summary_large_image">\n</head>`);
      entries.push({name:path,data:html});
    } else entries.push({name:path,data:await fetchBytes(`./${path}`)});
  }
  const fontManifest=JSON.parse(new TextDecoder().decode(await fetchBytes('./assets/fonts/manifest.json')));
  for(const path of fontManifest.assets||[])entries.push({name:`assets/fonts/${path}`,data:await fetchBytes(`./assets/fonts/${path}`)});
  entries.push({name:'tools/validate-conference.mjs',data:await fetchBytes('./tools/validate-conference.mjs')},{name:'tools/schema-check.mjs',data:await fetchBytes('./tools/schema-check.mjs')});
  for(const file of SCHEMA_FILES)entries.push({name:`schemas/${file}`,data:await fetchBytes(`./schemas/${file}`)});
  entries.push({name:'.nojekyll',data:''},{name:'package.json',data:generatedPackageJson()},{name:'.github/workflows/deploy.yml',data:workflowText()},{name:'manifest.webmanifest',data:manifestText(pkg)},{name:'share-preview.svg',data:sharePreviewSvg(pkg)});

  const iconSource=project.appIcon?.bytes?project.appIcon:(project.logo?.bytes?project.logo:null);
  for(const size of [180,192,512]){
    let png=iconSource?await imageBytesToPng(iconSource,size):null;
    if(!png)png=await fetchBytes(`./icon-${size}.png`);
    entries.push({name:`icon-${size}.png`,data:png});
  }
  entries.push({name:'DEPLOY.md',data:`# Conference Companion deployment\n\nThis ZIP is repository-ready. Upload its contents to a fresh GitHub repository root, enable GitHub Pages with GitHub Actions, and push to main.\n\nConference: ${pkg.conference.name}\nData version: ${pkg.manifest.dataVersion}\nGenerated: ${pkg.manifest.publishedAt}\n`});
  return {blob:createStoredZip(entries),pkg,report};
}

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
  const decisions=project.identityDecisions?.pairs||{};
  const decisionFor=(a,b)=>decisions[[canonicalPersonId(a),canonicalPersonId(b)].sort().join('::')]||'unresolved';
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
  const rows=project.rows||[],records=registry.personRecords,activeIds=new Set(),provisionalIds=new Set();
  const parseRoleNames=value=>parseNames(value);
  const roleFields={speaker:'speakerEntityIds',chair:'chairEntityIds',author:'authorEntityIds'};
  const legacyConflict=(row,role,index)=>row.personIdentityConflict===true&&(!row.personIdentityAssignments||(row.personIdentityIssues||[]).some(issue=>issue.role===role&&issue.index===index));
  // Only identities represented in the current programme or explicitly added
  // by the organizer are candidates. Old registry entries remain available for
  // stable ID reuse, but cannot create ghost profiles or fresh warnings alone.
  for(const person of project.extraPeople||[])if(person?.id&&person?.name){const id=canonicalPersonId(person.id);activeIds.add(id);const record=records[id]||={names:[],affiliations:[],explicitIds:[]};const name=norm(person.name),aff=String(person.affiliation||'').split(';').map(norm).filter(Boolean);if(name&&!record.names.includes(name))record.names.push(name);for(const value of aff)if(!record.affiliations.includes(value))record.affiliations.push(value);}
  // A historical name match alone must not reactivate a removed profile.
  // Current appearance references and still-open review candidates are evidence.
  const programmeNames=new Set(rows.flatMap(row=>Object.keys(roleFields).flatMap(role=>parseRoleNames(row[role]).map(norm))));
  for(const [key,id] of Object.entries(registry.people))if(!project.personIdAliases?.[id]&&programmeNames.has(key.split('|')[0])&&records[canonicalPersonId(id)])activeIds.add(canonicalPersonId(id));
  for(const row of rows){
    for(const issue of row.personIdentityIssues||[])for(const candidate of issue.candidateIds||[]){const id=canonicalPersonId(candidate);if(!project.personIdAliases?.[candidate]&&records[id]?.names?.includes(norm(issue.name)))activeIds.add(id);}
    const legacyNames=row.personIdentityResolvedNames||{};
    for(const [role,field] of Object.entries(roleFields)){
      const names=parseRoleNames(row[role]);
      for(let index=0;index<names.length;index++){
        const saved=row.personIdentityAssignments?.[role]?.[index],savedId=saved?.personId||saved?.id||'',rowId=row[field]?.[index]||'';
        const hasRowProfile=!!rowId&&(!!project.peopleOverrides?.[rowId]||!!project.peoplePhotos?.[rowId]||!!(project.extraPeople||[]).some(person=>person.id===rowId)||!!records[canonicalPersonId(rowId)]);
        const explicitLegacyRowId=!!rowId&&rowId!==savedId&&!/^person-[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(rowId)&&!rowId.startsWith('pending-');
        const id=saved?.status==='confirmed'&&(!rowId||savedId===rowId)?savedId:(hasRowProfile||explicitLegacyRowId)?rowId:(savedId||rowId);
        const legacyExplicit=!!legacyNames[norm(names[index])]&&Object.entries(roleFields).flatMap(([r])=>parseRoleNames(row[r]).map(n=>norm(n))).filter(n=>n===norm(names[index])).length===1;
        // Older projects kept edited profiles in overrides/photos while row
        // references held the only ID-to-name link. Migrate that evidence
        // before resolution; a row ID by itself is never treated as proof.
        if(id&&(saved?.status==='confirmed'||legacyExplicit||explicitLegacyRowId||String(row.source?.id||'').includes(':package:')||hasRowProfile)){
          const canonical=canonicalPersonId(id),record=records[canonical]||={names:[],affiliations:[],explicitIds:[]},name=norm(names[index]);
          if(name&&!record.names.includes(name))record.names.push(name);
          const override=project.peopleOverrides?.[id]||{},extra=(project.extraPeople||[]).find(person=>person.id===id)||{};
          const profileAffiliation=override.affiliation||extra.affiliation||(role==='speaker'?row.affiliation:'');
          for(const affiliation of String(profileAffiliation||'').split(';').map(norm).filter(Boolean))if(!record.affiliations.includes(affiliation))record.affiliations.push(affiliation);
          if((saved?.status!=='confirmed'||savedId!==rowId)&&(legacyExplicit||explicitLegacyRowId||String(row.source?.id||'').includes(':package:'))){row.personIdentityAssignments||={};row.personIdentityAssignments[role]||={};row.personIdentityAssignments[role][index]={personId:canonical,status:'confirmed'};}
          activeIds.add(canonical);
        }
        if(id&&(savedId||rowId||legacyExplicit))activeIds.add(canonicalPersonId(id));
      }
    }
  }
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
  const occurrencesOnRow=(row,name)=>Object.entries(roleFields).flatMap(([role])=>parseRoleNames(row[role]).map((value,index)=>({role,index,name:norm(value)}))).filter(item=>item.name===norm(name));
  const explicitAssignment=(row,role,index,name)=>{
    const saved=row.personIdentityAssignments?.[role]?.[index],savedId=saved?.personId||saved?.id;
    if(savedId&&saved.status==='confirmed')return canonicalPersonId(savedId);
    const legacyId=row[roleFields[role]]?.[index],legacyExplicit=!!row.personIdentityResolvedNames?.[norm(name)]&&occurrencesOnRow(row,name).length===1;
    if(legacyId&&legacyExplicit)return canonicalPersonId(legacyId);
    if(legacyId&&String(row.source?.id||'').includes(':package:'))return canonicalPersonId(legacyId);
    return '';
  };
  const resolvePerson=(row,role,index,name,affiliation='')=>{
    const n=norm(name),affiliations=String(affiliation||'').split(';').map(norm).filter(Boolean);if(!n)return {id:'',issue:null};
    const field=roleFields[role],prior=row[field]?.[index]||'',explicit=explicitAssignment(row,role,index,name);
    const candidates=[...new Set([...activeIds].filter(id=>records[id]?.names?.includes(n)))];
    const exact=affiliations.length?candidates.filter(id=>affiliations.some(aff=>records[id]?.affiliations?.includes(aff))):[];
    let id=explicit;
    if(!id&&exact.length===1)id=exact[0];
    else if(!id&&exact.length>1)return {id:'',issue:{role,index,name,candidateIds:exact,reason:'Several confirmed profiles match this affiliation'}};
    else if(!id&&!affiliations.length&&candidates.length===1)id=candidates[0];
    else if(!id&&!affiliations.length&&candidates.length>1)return {id:'',issue:{role,index,name,candidateIds:candidates,reason:'Two or more different profiles share this name'}};
    else if(!id&&prior&&!legacyConflict(row,role,index)&&records[canonicalPersonId(prior)]?.names?.includes(n))id=canonicalPersonId(prior);
    else if(!id&&affiliations.length){const indexed=registry.people[`${n}|${affiliations[0]}`],canonical=indexed&&canonicalPersonId(indexed);if(canonical&&records[canonical]?.names?.includes(n))id=canonical;}
    if(!id&&candidates.length&&affiliations.length){
      // A new affiliation must not silently overwrite or inherit another
      // same-name profile. Keep the appearance as its own reviewable identity.
      id=`person-${crypto.randomUUID()}`;
    }
    if(!id){id=prior&&!legacyConflict(row,role,index)?canonicalPersonId(prior):`person-${crypto.randomUUID()}`;if(!affiliations.length&&!candidates.length)provisionalIds.add(id);}
    const record=records[id]||={names:[],affiliations:[],explicitIds:[]};if(!record.names.includes(n))record.names.push(n);for(const aff of affiliations)if(!record.affiliations.includes(aff))record.affiliations.push(aff);
    activeIds.add(id);const key=`${n}|${affiliations[0]||''}`;if(!registry.people[key]||canonicalPersonId(registry.people[key])===id)registry.people[key]=id;
    const assignments=row.personIdentityAssignments||={};assignments[role]||={};assignments[role][index]={personId:id,status:explicit?'confirmed':'automatic'};
    if(!explicit&&candidates.length&&id===candidates[0]){autoLinkedIds.add(id);stats.linkedAppearances++;}
    return {id,issue:null};
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
  for(const row of orderedRows){
    if(!row.id)row.id=crypto.randomUUID();
    const oldFlags={conflict:row.personIdentityConflict===true,resolvedNames:{...(row.personIdentityResolvedNames||{})}};
    row.personIdentityIssues=[];
    const type=String(row.type||'talk').toLowerCase();
    if(!row.entityId)row.entityId=stableEntityId(row,type==='poster'?'poster':'presentation');
    if(!Number.isFinite(Number(row.sequence)))row.sequence=0;
    row.locationEntityId=locationId(row.location,row.locationEntityId);
    row.trackEntityId=trackId(row.track||'Common',row.trackEntityId);
    const roleInputs={speaker:parseNames(row.speaker),chair:parseNames(row.chair),author:parseNames(row.author)};
    for(const [role,names] of Object.entries(roleInputs)){
      const ids=[];for(const [index,name] of names.entries()){
        const resolved=resolvePerson(row,role,index,name,role==='speaker'?row.affiliation:'');ids[index]=resolved.id;
        if(resolved.issue)row.personIdentityIssues.push({...resolved.issue,rowId:row.id});
      }
      row[roleFields[role]]=ids;
    }
    // Backward-compatible migration for the old name-only resolution marker
    // is intentionally conservative when the name occurs in multiple roles.
    for(const [name,value] of Object.entries(oldFlags.resolvedNames))if(value&&occurrencesOnRow(row,name).length===1){const [{role,index}]=occurrencesOnRow(row,name),id=row[roleFields[role]]?.[index];if(id)row.personIdentityAssignments[role][index]={personId:id,status:'confirmed'};}
    row.personIdentityConflict=row.personIdentityIssues.length>0;
    row.personIdentityResolved=!row.personIdentityConflict;
    row.personIdentityCandidates=[...new Set(row.personIdentityIssues.flatMap(issue=>issue.candidateIds))];
    row.personIdentityCandidatesByName={};for(const issue of row.personIdentityIssues)row.personIdentityCandidatesByName[`${issue.role}:${issue.index}`]=issue.candidateIds;

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
  // An unaffiliated first appearance may have looked unique until later rows
  // exposed multiple same-name profiles. Drop that provisional identity, then
  // recompute automatic row assignments against the complete current project.
  for(const id of provisionalIds){const names=records[id]?.names||[],competing=[...activeIds].filter(other=>other!==id&&names.some(name=>records[other]?.names?.includes(name)));if(!competing.length)continue;activeIds.delete(id);delete records[id];for(const [key,value] of Object.entries(registry.people))if(canonicalPersonId(value)===id)delete registry.people[key];}
  for(const row of rows){
    row.personIdentityIssues=[];
    for(const [role,field] of Object.entries(roleFields)){
      const names=parseRoleNames(row[role]),ids=row[field]||[];
      for(const [index,name] of names.entries()){
        const assignment=row.personIdentityAssignments?.[role]?.[index],id=assignment?.personId||assignment?.id||ids[index]||'';
        if(assignment?.status==='confirmed')continue;
        const normalized=norm(name),candidates=[...new Set([...activeIds].filter(candidate=>records[candidate]?.names?.includes(normalized)))],affiliations=role==='speaker'?String(row.affiliation||'').split(';').map(norm).filter(Boolean):[],exact=affiliations.length?candidates.filter(candidate=>affiliations.some(aff=>records[candidate]?.affiliations?.includes(aff))):[];
        let issue=null,resolvedId=id;
        if(exact.length===1)resolvedId=exact[0];
        else if(exact.length>1)issue={role,index,name,candidateIds:exact,reason:'Several confirmed profiles match this affiliation'};
        else if(!affiliations.length&&candidates.length>1)issue={role,index,name,candidateIds:candidates,reason:'Two or more different profiles share this name'};
        else if(!affiliations.length&&candidates.length===1)resolvedId=candidates[0];
        if(issue){resolvedId='';row.personIdentityIssues.push({...issue,rowId:row.id});row.personIdentityAssignments||={};row.personIdentityAssignments[role]||={};row.personIdentityAssignments[role][index]={personId:'',status:'unresolved'};}
        ids[index]=resolvedId;
        if(resolvedId){row.personIdentityAssignments||={};row.personIdentityAssignments[role]||={};row.personIdentityAssignments[role][index]={personId:resolvedId,status:'automatic'};}
      }
      row[field]=ids;
    }
    row.personIdentityConflict=row.personIdentityIssues.length>0;row.personIdentityResolved=!row.personIdentityConflict;
    row.personIdentityCandidates=[...new Set(row.personIdentityIssues.flatMap(issue=>issue.candidateIds))];
    row.personIdentityCandidatesByName={};for(const issue of row.personIdentityIssues)row.personIdentityCandidatesByName[`${issue.role}:${issue.index}`]=issue.candidateIds;
  }
  for(const row of rows)for(const field of Object.values(roleFields))for(const id of row[field]||[])if(id)activeIds.add(canonicalPersonId(id));
  const grouped=new Map();for(const id of activeIds){const record=records[id];for(const name of record?.names||[]){if(!grouped.has(name))grouped.set(name,new Set());grouped.get(name).add(id);}}
  project.identityWarnings=[];
  for(const [name,idsSet] of grouped){const ids=[...idsSet];if(ids.length<2)continue;let unresolved=false;for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)if(decisionFor(ids[i],ids[j])!=='different')unresolved=true;if(unresolved)project.identityWarnings.push(`Possible duplicate profiles named "${records[ids[0]]?.names?.[0]||name}": confirm whether these are the same or different people in Step 4.`);}
  stats.requiresReview=rows.reduce((sum,row)=>sum+(row.personIdentityIssues||[]).length,0);
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
  const personReference=(row,role,index,name,affiliation='')=>{
    const issue=(row.personIdentityIssues||[]).find(item=>item.role===role&&item.index===index);
    // Keep unresolved assignments out of the package people directory. A
    // synthetic placeholder would look like a real attendee profile and could
    // otherwise leave a convincing but incorrectly attributed programme.
    if(issue)return '';
    const field={speaker:'speakerEntityIds',chair:'chairEntityIds',author:'authorEntityIds'}[role];
    const preferred=(row[field]||[])[index]||'';
    return ensurePerson(name,affiliation,preferred);
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
    const chairIds=[...new Set(group.rows.flatMap(r=>parseNames(r.chair).map((n,i)=>personReference(r,'chair',i,n)).filter(Boolean)))];
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
        const speakerIds=parseNames(row.speaker).map((n,i)=>personReference(row,'speaker',i,n,row.affiliation)).filter(Boolean);
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
      groupRows.forEach((row,i)=>{const authorIds=parseNames(row.speaker).map((n,i)=>personReference(row,'speaker',i,n,row.affiliation)).filter(Boolean);let posterId=stableEntityId(row,'poster');if(usedPosters.has(posterId))posterId=ensureUnique(posterId,usedPosters);else usedPosters.add(posterId);posters.push({id:posterId,posterSessionId:psId,number:row.posterNumber||String(i+1),title:row.title||'',authorIds,abstract:row.abstract||'',keywords:[],links:row.doi?[{label:'DOI / link',url:row.doi}]:[],calendarUid:row.calendarUid,sequence:Number(row.sequence||0)+psBump});});
    }
  }

  tracks.sort((a,b)=>a.order-b.order);
  // Existing registry identities that are offered as candidates for an
  // unresolved appearance must be present in the directory so the organizer
  // can compare and select them. These are registered profiles, not synthetic
  // placeholder people for the unresolved row itself.
  for(const id of new Set(rows.flatMap(row=>(row.personIdentityIssues||[]).flatMap(issue=>issue.candidateIds||[])))){
    if(personById.has(id))continue;
    const record=project.identityRegistry?.personRecords?.[id],name=record?.names?.[0];
    if(name){const display=rows.flatMap(row=>[...parseNames(row.speaker),...parseNames(row.chair),...parseNames(row.author)]).find(value=>value.toLocaleLowerCase()===name)||name;ensurePerson(display,(record.affiliations||[]).join('; '),id);}
  }
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
  const manifest={schemaVersion:CURRENT_SCHEMA_VERSION,dataVersion:version,minimumEngineVersion:'1.2.11',publishedAt:now,files:['conference.json','programme.json','people.json','locations.json','branding.json'],checksums:{},changelog};
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
  for(const row of rows)for(const issue of row.personIdentityIssues||[])report.errors.push(`Person assignment needs review [identity-assignment:${encodeURIComponent(row.id)}:${issue.role}:${issue.index}]`);
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
function generatedPackageJson(){return JSON.stringify({name:'conference-companion-deployment',version:'1.2.11',private:true,type:'module',scripts:{schema:'node tools/schema-check.mjs conference',validate:'node tools/validate-conference.mjs conference',test:'npm run schema && npm run validate'}},null,2)+'\n';}

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

import {buildPackage} from './package.js';
import {validateBuilderProjectStructure} from './project-file.js';

const edited=row=>Object.keys(row.manualFields||{}).length>0;
const rowSources=source=>[...new Set(source?.contributors?.length?source.contributors:[source?.fileId].filter(Boolean))];
function sourceRefs(source){
  if(Array.isArray(source?.sources)&&source.sources.length)return source.sources.map(item=>({...item}));
  return rowSources(source).map(fileId=>{
    const id=(source?.sourceRecords||[]).find(value=>String(value).startsWith(`${fileId}:`))||(source?.fileId===fileId?source.id:'');
    return {id:id||`${fileId}:retained`,fileId,...(source?.fileId===fileId?Object.fromEntries(['sheet','row','page','line','column','raw','matchData'].filter(key=>source[key]!==undefined).map(key=>[key,source[key]])): {})};
  });
}
function sourceRecordIds(source,fileId){return sourceRefs(source).filter(ref=>ref.fileId===fileId).map(ref=>ref.id).filter(Boolean);}
function selectPrimarySource(source,remainingIds,row){
  const refs=sourceRefs(source).filter(ref=>remainingIds.includes(ref.fileId));
  const primary=refs[0]||{fileId:remainingIds[0],id:(source?.sourceRecords||[]).find(value=>String(value).startsWith(`${remainingIds[0]}:`))||`${remainingIds[0]}:retained:${row.id}`};
  const preserved={...source};
  for(const key of ['id','fileId','sheet','row','page','line','column','raw','matchData'])delete preserved[key];
  Object.assign(preserved,primary,{contributors:remainingIds,sources:refs,sourceRecords:refs.map(ref=>ref.id).filter(Boolean)});
  return preserved;
}
function pruneDerivedMetadata(project,pkg){
  const personIds=new Set((pkg.people?.people||[]).map(person=>person.id));
  const canonical=id=>{const seen=new Set();while(project.personIdAliases?.[id]&&!seen.has(id)){seen.add(id);id=project.personIdAliases[id];}return id;};
  const referencedPersonIds=new Set([...(project.extraPeople||[]).map(person=>person.id),...(project.rows||[]).flatMap(row=>[...(row.speakerEntityIds||[]),...(row.chairEntityIds||[])])].filter(Boolean));
  const activePersonIds=new Set([...referencedPersonIds,...personIds].map(canonical));
  for(const row of project.rows||[]){
    if(Array.isArray(row.personIdentityCandidates))row.personIdentityCandidates=row.personIdentityCandidates.filter(id=>activePersonIds.has(canonical(id)));
    if(row.personIdentityCandidatesByName){for(const [name,ids] of Object.entries(row.personIdentityCandidatesByName)){const kept=ids.filter(id=>activePersonIds.has(canonical(id)));if(kept.length)row.personIdentityCandidatesByName[name]=kept;else delete row.personIdentityCandidatesByName[name];}if(!Object.keys(row.personIdentityCandidatesByName).length)delete row.personIdentityCandidatesByName;}
    if(row.personIdentityCandidates&&!row.personIdentityCandidates.length)delete row.personIdentityCandidates;
    if(row.personIdentityConflict&&(!row.personIdentityCandidates||row.personIdentityCandidates.length<2)){row.personIdentityConflict=false;row.personIdentityResolved=true;}
  }
  const registry=project.identityRegistry||{};
  for(const id of Object.keys(registry.personRecords||{}))if(!activePersonIds.has(canonical(id)))delete registry.personRecords[id];
  for(const [key,id] of Object.entries(registry.people||{}))if(!activePersonIds.has(canonical(id)))delete registry.people[key];
  if(registry.autoConsolidatedIds)registry.autoConsolidatedIds=registry.autoConsolidatedIds.filter(id=>activePersonIds.has(canonical(id)));
  for(const key of ['peopleOverrides','peoplePhotos','mergedPersonPhotos'])for(const id of Object.keys(project[key]||{}))if(!personIds.has(canonical(id)))delete project[key][id];
  if(project.identityDecisions?.pairs)for(const pair of Object.keys(project.identityDecisions.pairs)){const [first,second]=pair.split('::');if(!personIds.has(canonical(first))||!personIds.has(canonical(second)))delete project.identityDecisions.pairs[pair];}
  const sessionIds=new Set((pkg.programme?.sessions||[]).map(session=>session.id));
  for(const id of Object.keys(project.sessionOverrides||{}))if(!sessionIds.has(id))delete project.sessionOverrides[id];
  const locationIds=new Set((pkg.locations?.locations||[]).map(location=>location.id));
  for(const id of Object.keys(project.locationOverrides||{}))if(!locationIds.has(id))delete project.locationOverrides[id];
  for(const id of Object.keys(project.branding?.locationColors||{}))if(!locationIds.has(id))delete project.branding.locationColors[id];
  const trackIds=new Set((pkg.programme?.tracks||[]).map(track=>track.id));
  for(const id of Object.keys(project.branding?.trackColors||{}))if(!trackIds.has(id))delete project.branding.trackColors[id];
}

/** Prepare, but do not persist, a fully derived source-removal result. */
export async function prepareSourceRemoval(project,sourceId,strategy){
  if(!['remove-associated','preserve-edited'].includes(strategy))throw new Error('Choose whether to remove associated programme data or preserve edited entries');
  const source=(project.sourceFiles||[]).find(item=>item.id===sourceId);
  if(!source)throw new Error('The selected imported source no longer exists');
  const next=structuredClone(project),deleteRows=[],manualRows=[],sharedRows=[],affectedRows=[];
  const removedSourceRecordIds=new Set();
  for(const row of next.rows||[]){
    const sourceIds=rowSources(row.source);
    if(!sourceIds.includes(sourceId))continue;
    affectedRows.push(row);
    const remaining=sourceIds.filter(id=>id!==sourceId);
    for(const id of sourceRecordIds(row.source,sourceId))removedSourceRecordIds.add(id);
    if(remaining.length){
      row.source=selectPrimarySource(row.source,remaining,row);sharedRows.push(row);continue;
    }
    if(strategy==='preserve-edited'&&edited(row)){
      delete row.source;row.manuallyMaintained=true;manualRows.push(row);continue;
    }
    deleteRows.push(row);
  }
  const deleteIds=new Set(deleteRows.map(row=>row.id));
  next.rows=(next.rows||[]).filter(row=>!deleteIds.has(row.id));
  next.sourceFiles=(next.sourceFiles||[]).filter(item=>item.id!==sourceId);
  next.deletedSourceIds=[...new Set([...(next.deletedSourceIds||[]),...removedSourceRecordIds].filter(Boolean))];
  next.sourceState=(next.sourceState||[]).filter(item=>item?.fileId!==sourceId&&item?.sourceFileId!==sourceId&&!String(item?.sourceId||'').startsWith(`${sourceId}:`));
  const removedSourceNames=new Set([sourceId,...removedSourceRecordIds].filter(Boolean));
  next.reimportConflicts=(next.reimportConflicts||[]).filter(message=>![...removedSourceNames].some(value=>String(message).includes(value)));

  const [beforeResult,afterResult]=await Promise.all([buildPackage(structuredClone(project)),buildPackage(next)]);
  pruneDerivedMetadata(next,afterResult.pkg);
  validateBuilderProjectStructure(next);
  // Rebuild once after pruning so validation and the preview use precisely the staged project.
  const finalResult=await buildPackage(next);
  const ids=list=>new Set((list||[]).map(item=>item.id));
  const countRemoved=(before,after)=>[...ids(before)].filter(id=>!ids(after).has(id)).length;
  const peopleRemoved=countRemoved(beforeResult.pkg.people?.people,finalResult.pkg.people?.people);
  const sessionsRemoved=countRemoved(beforeResult.pkg.programme?.sessions,finalResult.pkg.programme?.sessions);
  const posterSessionsBefore=(beforeResult.pkg.programme?.sessions||[]).filter(session=>session.type==='poster-session');
  const posterSessionsAfter=(finalResult.pkg.programme?.sessions||[]).filter(session=>session.type==='poster-session');
  const postersRemoved=countRemoved(beforeResult.pkg.programme?.posters,finalResult.pkg.programme?.posters);
  const posterSessionsRemoved=countRemoved(posterSessionsBefore,posterSessionsAfter);
  const sessionMembership=(pkg,session)=>session.type==='poster-session'?(pkg.programme.posters||[]).filter(poster=>poster.posterSessionId===session.id).map(poster=>poster.id).sort():(session.presentationIds||[]).slice().sort();
  const sessionsAfterById=new Map((finalResult.pkg.programme?.sessions||[]).map(session=>[session.id,session]));
  const sessionsAffected=(beforeResult.pkg.programme?.sessions||[]).filter(session=>{const after=sessionsAfterById.get(session.id);return !after||JSON.stringify(sessionMembership(beforeResult.pkg,session))!==JSON.stringify(sessionMembership(finalResult.pkg,after));}).length;
  const posterSessionsAffected=posterSessionsBefore.filter(session=>{const after=sessionsAfterById.get(session.id);return !after||JSON.stringify(sessionMembership(beforeResult.pkg,session))!==JSON.stringify(sessionMembership(finalResult.pkg,after));}).length;
  return {project:next,sourceId,strategy,package:finalResult.pkg,validation:finalResult.report,impact:{programmeEntriesToDelete:deleteRows.length,manuallyEditedEntriesAffected:affectedRows.filter(edited).length,entriesRetainedByOtherSources:sharedRows.length,entriesRetainedAsManual:manualRows.length,peopleDisappearing:peopleRemoved,sessionsAffected,sessionsDisappearing:sessionsRemoved,posterSessionsAffected,posterSessionsDisappearing:posterSessionsRemoved,postersAffected:postersRemoved}};
}

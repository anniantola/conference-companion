const IMPORT_FIELDS=['date','start','end','type','session','title','speaker','chair','affiliation','location','track','posterNumber'];
const clean=value=>String(value??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');

function idsFromReference(value,knownIds){
  if(!value)return [];
  const text=String(value),matches=[];
  for(const id of knownIds){
    if(text===id||text.startsWith(`${id}:`)||text.startsWith(`${id}/`)||text.startsWith(`${id}#`))matches.push(id);
  }
  return matches;
}
export function sourceStateRecords(project){
  const values=Array.isArray(project.sourceState)?project.sourceState:Object.entries(project.sourceState||{}).map(([sourceId,item])=>({...item,sourceId:item?.sourceId||sourceId}));
  return values.map(item=>({...item,fileId:item?.fileId||item?.sourceFileId||'',sourceRecordId:item?.sourceId||item?.id||''}));
}
function rowSources(row,knownIds){
  const source=row?.source||{},result=new Set();
  const refs=(source.sources||[]).flatMap(x=>typeof x==='string'?[x]:[x?.fileId,x?.sourceId,x?.source]);
  const records=(source.sourceRecords||[]).flatMap(x=>typeof x==='string'?[x]:[x?.fileId,x?.sourceId,x?.source]);
  const rowRefs=(row?.sources||[]).flatMap(x=>typeof x==='string'?[x]:[x?.fileId,x?.sourceId,x?.source]);
  const rowRecords=(row?.sourceRecords||[]).flatMap(x=>typeof x==='string'?[x]:[x?.fileId,x?.sourceId,x?.source]);
  for(const value of [source.fileId,...(source.contributors||[]),...refs,...records,...rowRefs,...rowRecords]){
    if(knownIds.has(String(value)))result.add(String(value));
    idsFromReference(value,knownIds).forEach(id=>result.add(id));
  }
  for(const key of ['id','sourceId','sourceFileId','importedFrom','file']){
    for(const id of idsFromReference(source[key]??row?.[key],knownIds))result.add(id);
  }
  return result;
}
function mappedRaw(raw,mapping={}){
  const mapped={...raw};for(const field of IMPORT_FIELDS){const key=mapping[field];if(key&&raw[key]!==undefined)mapped[field]=raw[key];}return mapped;
}
function fieldMatchCount(row,raw,mapping={}){
  if(!raw||typeof raw!=='object')return 0;
  const mapped=mappedRaw(raw,mapping);
  let count=0;
  for(const field of IMPORT_FIELDS){const a=clean(row[field]),b=clean(mapped[field]);if(a&&b&&a===b)count++;}
  return count;
}
function isStrongStateMatch(row,item,project){
  const raw=mappedRaw(item.raw,item.mapping),score=fieldMatchCount(row,raw);
  const title=clean(row.title)&&clean(row.title)===clean(raw.title);
  const contextual=score>=5&&clean(row.date)===clean(raw.date)&&clean(row.start)===clean(raw.start);
  if(!(title&&score>=3)&&!contextual)return false;
  const candidates=(project.rows||[]).filter(other=>{
    const otherScore=fieldMatchCount(other,raw),sameTitle=clean(other.title)&&clean(other.title)===clean(raw.title);
    return (sameTitle&&otherScore>=3)||(otherScore>=5&&clean(other.date)===clean(raw.date)&&clean(other.start)===clean(raw.start));
  });
  return candidates.length===1&&candidates[0].id===row.id;
}

/**
 * Recover safe, row-level provenance from current fields and historical source
 * state. An association is inferred from content only when one source record
 * has a sufficiently specific match and no competing source has the same
 * evidence. This function never persists guesses.
 */
export function resolveRowProvenance(project,row){
  const files=project.sourceFiles||[],knownIds=new Set(files.map(x=>String(x.id)).filter(Boolean));
  const state=sourceStateRecords(project).map(item=>({item,fileId:item.fileId,sourceRecordId:item.sourceRecordId}));
  // Include historical IDs so a source whose registry record was lost remains
  // recognizable as imported instead of being mistaken for organizer content.
  const historicalIds=new Set(knownIds);
  const sourceAliases=new Map();
  for(const file of files){for(const alias of [file?.legacyId,file?.sourceId,file?.fileId].filter(Boolean)){historicalIds.add(String(alias));sourceAliases.set(String(alias),String(file.id));}}
  for(const {fileId} of state)if(fileId)historicalIds.add(String(fileId));
  for(const item of state){
    const recordPrefix=String(item.sourceRecordId||'').split(':')[0];
    if(recordPrefix&&item.fileId){historicalIds.add(recordPrefix);sourceAliases.set(recordPrefix,String(item.fileId));}
    idsFromReference(item.sourceRecordId,historicalIds).forEach(id=>historicalIds.add(id));
  }
  for(const id of [row?.source?.fileId,...(row?.source?.contributors||[]),...(row?.source?.sources||[]).map(x=>x?.fileId)].filter(Boolean))historicalIds.add(String(id));
  const direct=new Set([...rowSources(row,historicalIds)].map(id=>sourceAliases.get(id)||id)),recordIds=new Set([row?.source?.id,...(row?.source?.sourceRecords||[]),...(row?.source?.sources||[]).map(x=>x?.id)].filter(Boolean).map(String));
  for(const item of state){
    if(recordIds.has(String(item.sourceRecordId))&&item.fileId)direct.add(String(item.fileId));
  }
  const contentMatches=new Map();
  for(const {item,fileId,sourceRecordId} of state){
    if(!fileId||!row||!item?.raw)continue;
    if(!isStrongStateMatch(row,item,project))continue;
    const exact=fieldMatchCount(row,item.raw,item.mapping);
    const count=contentMatches.get(fileId)||{score:0,records:[]};count.score=Math.max(count.score,exact);count.records.push(sourceRecordId);contentMatches.set(fileId,count);
  }
  if(contentMatches.size){
    for(const [id,match] of contentMatches)if(match.score>=3)direct.add(id);
    const journalSourceIds=new Set(state.map(item=>item.fileId).filter(Boolean));
    for(const id of [...direct])if(!knownIds.has(id)&&!journalSourceIds.has(id)&&!contentMatches.has(id))direct.delete(id);
  }
  const hasSourceMarker=!!(row?.source||row?.sourceId||row?.sourceFileId||row?.importedFrom||row?.sourceRecords?.length||row?.sources?.length);
  const historicalEvidence=direct.size>0||contentMatches.size>0;
  const explicitlyManual=!!(row?.manuallyCreated||row?.manualCreated||row?.manuallyMaintained||(!hasSourceMarker&&row?.manualEdited&&!Object.keys(row?.manualFields||{}).length));
  const candidates=[...new Set([...direct,...contentMatches.keys()])];
  const ambiguous=!explicitlyManual&&!direct.size&&contentMatches.size>1;
  const origin=explicitlyManual?'manual':ambiguous?'uncertain':direct.size||historicalEvidence?'imported':'uncertain';
  return {sourceIds:origin==='manual'?[]:[...direct],origin,ambiguous,candidateSourceIds:candidates,orphaned:origin==='imported'&&[...direct].every(id=>!knownIds.has(id)),hasSourceMarker};
}

/** Apply recoverable provenance to a staged project without guessing ambiguous rows. */
export function reconcileSourceProvenance(project){
  for(const row of project.rows||[]){
    const resolved=resolveRowProvenance(project,row);
    if(resolved.origin==='manual'){delete row.source;delete row.sources;delete row.sourceRecords;continue;}
    if(resolved.sourceIds.length&&!row.source){
      const refs=resolved.sourceIds.map(fileId=>({fileId,id:sourceStateRecords(project).find(x=>x.fileId===fileId&&String(x.sourceRecordId).includes(fileId))?.sourceRecordId||`${fileId}:recovered:${row.id}`}));
      row.source={id:refs[0].id,fileId:refs[0].fileId,contributors:resolved.sourceIds,sources:refs,sourceRecords:refs.map(x=>x.id),recovered:true};
    }else if(row.source&&resolved.sourceIds.length){
      const refs=Array.isArray(row.source.sources)?row.source.sources.slice():[];
      for(const fileId of resolved.sourceIds)if(!refs.some(ref=>ref?.fileId===fileId))refs.push({fileId,id:`${fileId}:recovered:${row.id}`});
      row.source.sources=refs;row.source.contributors=[...new Set([...(row.source.contributors||[]),...resolved.sourceIds])];
      row.source.sourceRecords=[...new Set([...(row.source.sourceRecords||[]),...refs.map(x=>x.id).filter(Boolean)])];
    }
  }
  return project;
}

export function classifyProgrammeRows(project){
  return (project.rows||[]).map(row=>({row,...resolveRowProvenance(project,row)}));
}

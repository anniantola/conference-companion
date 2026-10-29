const key=value=>String(value||'').trim().toLocaleLowerCase();
const affiliations=person=>person?.affiliations||String(person?.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean);

export function possiblePersonDuplicates(people=[]){
  const groups=new Map();
  for(const person of people){const name=key(person.name);if(!name)continue;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(person);}
  return [...groups.values()].filter(group=>group.length>1);
}

const canonicalPair=(a,b)=>[String(a),String(b)].sort().join('::');

/** Return unresolved same-name groups with the programme/source context organizers need. */
export function identityReviewGroups(project,people=[],{includeResolved=false}={}){
  const rows=project.rows||[],decisions=project.identityDecisions?.pairs||{};
  return possiblePersonDuplicates(people).map(candidates=>{
    const ids=new Set(candidates.map(person=>person.id));
    const appearances=[];
    for(const row of rows){
      const fields=[['speaker','speakerEntityIds',row.type==='poster'?'Author':'Speaker'],['chair','chairEntityIds','Chair'],['author','authorEntityIds','Author']];
      for(const [role,idField,label] of fields){
        const names=String(row[role]||'').split(/\s*(?:;|\band\b)\s*/i);
        names.forEach((name,index)=>{
          const id=row[idField]?.[index];
          if(ids.has(id)||(!id&&candidates.some(p=>key(p.name)===key(name))))appearances.push({role:label,name,row,ids:id?[id]:[]});
        });
      }
    }
    const pairStates=[],pairDecisions=[];
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
      const first=candidates[i],second=candidates[j],decision=decisions[canonicalPair(first.id,second.id)]||'unresolved';
      pairStates.push(decision);pairDecisions.push({firstId:first.id,secondId:second.id,decision});
    }
    return {name:candidates[0]?.name||'',candidates,appearances,pairStates,pairDecisions,unresolved:pairStates.some(state=>state==='unresolved')};
  }).filter(group=>includeResolved||group.unresolved);
}

/** Store an explicit organizer decision. Decisions are keyed by stable person IDs. */
export function decidePersonIdentity(project,firstId,secondId,decision){
  if(!['same','different','unresolved'].includes(decision))throw new Error('Choose same person, different people, or leave unresolved');
  if(!firstId||!secondId||firstId===secondId)throw new Error('Choose two different person profiles');
  const pair=canonicalPair(firstId,secondId);
  project.identityDecisions||={pairs:{}};project.identityDecisions.pairs||={};
  project.identityDecisions.pairs[pair]=decision;
  return pair;
}

/** Apply a set of merge/distinct decisions to an isolated project snapshot. */
export function applyIdentityResolutions(project,people,operations){
  const next=structuredClone(project),lookup=new Map(people.map(person=>[person.id,person]));
  const touched=new Set();
  for(const operation of operations){
    const {firstId,secondId,decision}=operation;
    if(touched.has(firstId)||touched.has(secondId))throw new Error('Selected operations conflict because one profile appears in more than one operation');
    if(!lookup.has(firstId)||!lookup.has(secondId)||firstId===secondId)throw new Error('Every selected identity decision must refer to two different current profiles');
    if(!['same','different','unresolved'].includes(decision))throw new Error('Choose same person, different people, or leave unresolved for every selected group');
    touched.add(firstId);touched.add(secondId);
    if(decision==='same'){
      const keepId=operation.keepId;
      const removeId=keepId===firstId?secondId:keepId===secondId?firstId:'';
      if(!removeId)throw new Error('Choose which profile survives each merge');
      mergePersonProfiles(next,people,keepId,removeId,operation.choices||{});
      lookup.delete(removeId);
    }else decidePersonIdentity(next,firstId,secondId,decision);
  }
  return next;
}

/** Apply an organizer-confirmed merge to Builder state and every programme reference. */
export function mergePersonProfiles(project,people,keepId,removeId,choices={}){
  if(!keepId||!removeId||keepId===removeId)throw new Error('Choose two different people to merge');
  const fieldChoices={...choices};
  for(const field of ['name','position','publicEmail','orcid','website','photoUrl'])if(fieldChoices[field]==='remove')fieldChoices[field]=removeId;else if(fieldChoices[field]==='keep')fieldChoices[field]=keepId;
  const next=structuredClone(project),result=mergeProfilesInPlace(next,people,[keepId,removeId],fieldChoices);
  for(const key of Object.keys(project))if(!Object.hasOwn(next,key))delete project[key];
  Object.assign(project,next);
  return result;
}

const personFields=['name','position','publicEmail','orcid','website','photoUrl'];
const readPersonField=(person,field)=>field==='website'?(person.links||[]).find(link=>link.label==='Website')?.url||person.website||'':person[field]||'';
const uniqueValues=values=>[...new Map(values.filter(value=>value!=null&&value!=='').map(value=>[typeof value==='string'?key(value):JSON.stringify(value),value])).values()];
function setMergedPhoto(project,ids,primaryId,choices){
  const previous=project.peoplePhotos||{},merged=project.mergedPersonPhotos||{},photos=ids.flatMap(id=>[...(merged[id]||[]),previous[id]].filter(Boolean));
  const distinct=photos.filter((photo,index)=>photos.findIndex(other=>photo.name===other.name&&photo.type===other.type&&JSON.stringify([...new Uint8Array(photo.bytes||[])])===JSON.stringify([...new Uint8Array(other.bytes||[])]))===index);
  const preferredId=choices.photoOwnerId||choices.photoUrl,preferred=preferredId&&ids.includes(preferredId)?previous[preferredId]:previous[primaryId];
  const selected=preferred||distinct[0];
  project.peoplePhotos={...previous};for(const id of ids)delete project.peoplePhotos[id];if(selected)project.peoplePhotos[primaryId]=selected;
  project.mergedPersonPhotos={...merged};for(const id of ids)delete project.mergedPersonPhotos[id];
  const archived=distinct.filter(photo=>photo!==selected);if(archived.length)project.mergedPersonPhotos[primaryId]=archived;
}
function mergeProfilesInPlace(project,people,ids,choices={}){
  const selected=[...new Set(ids||[])],primaryId=selected[0],lookup=new Map(people.map(person=>[person.id,person]));
  if(selected.length<2)throw new Error('Select at least two profiles to merge');
  if(selected.length!==ids.length)throw new Error('A profile was selected more than once');
  if(selected.some(id=>!id||!lookup.has(id)))throw new Error('Every selected profile must exist in the current people directory');
  const decisions=project.identityDecisions?.pairs||{};
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++)if(decisions[canonicalPair(selected[i],selected[j])]==='different'){
    const first=lookup.get(selected[i]),second=lookup.get(selected[j]);throw new Error(`${first.name} (${affiliations(first).join('; ')||'affiliation unknown'}) and ${second.name} (${affiliations(second).join('; ')||'affiliation unknown'}) are confirmed as different people. Revisit that decision before merging.`);
  }
  const profiles=selected.map(id=>lookup.get(id)),primary=profiles[0],result={};
  for(const field of personFields){
    const values=profiles.map(person=>readPersonField(person,field));
    const requested=choices[field],chosenIndex=selected.indexOf(requested);
    result[field]=chosenIndex>=0&&values[chosenIndex]?values[chosenIndex]:values[0]||values.find(Boolean)||'';
  }
  result.affiliation=uniqueValues(profiles.flatMap(affiliations)).join('; ');
  result.papers=uniqueValues(profiles.flatMap(person=>person.papers||[]));
  result.links=uniqueValues(profiles.flatMap(person=>person.links||[]));
  const extra=(project.extraPeople||[]).find(person=>person.id===primaryId);
  if(extra)Object.assign(extra,result);
  else project.peopleOverrides={...(project.peopleOverrides||{}),[primaryId]:{...(project.peopleOverrides?.[primaryId]||{}),...result}};
  setMergedPhoto(project,selected,primaryId,choices);
  const aliases={...(project.personIdAliases||{})};
  for(const id of selected.slice(1))aliases[id]=primaryId;
  for(const [alias,target] of Object.entries(aliases))if(selected.includes(target))aliases[alias]=primaryId;
  project.personIdAliases=aliases;
  project.extraPeople=(project.extraPeople||[]).filter(person=>!selected.slice(1).includes(person.id));
  for(const id of selected.slice(1))if(project.peopleOverrides)delete project.peopleOverrides[id];

  const nextDecisions={},decisionSources=new Map();
  for(const [pair,decision] of Object.entries(decisions)){
    const [a,b]=pair.split('::');if(!a||!b)continue;
    const mappedA=selected.includes(a)?primaryId:a,mappedB=selected.includes(b)?primaryId:b;
    if(mappedA===mappedB)continue;
    const mappedPair=canonicalPair(mappedA,mappedB),previous=decisionSources.get(mappedPair);
    if(previous&&previous!==decision&&previous!=='unresolved'&&decision!=='unresolved')throw new Error('The selected profiles have conflicting confirmed identity decisions with another person; review that conflict before merging');
    if(!previous||previous==='unresolved')decisionSources.set(mappedPair,decision);
  }
  for(const [pair,decision] of decisionSources)nextDecisions[pair]=decision;
  project.identityDecisions={...(project.identityDecisions||{}),pairs:nextDecisions};

  for(const [identity,id] of Object.entries(project.identityRegistry?.people||{}))if(selected.includes(id))project.identityRegistry.people[identity]=primaryId;
  const records=project.identityRegistry?.personRecords;if(records){
    const mergedRecord={names:[],affiliations:[],explicitIds:[]};
    for(const id of selected){const record=records[id];if(!record)continue;for(const field of Object.keys(mergedRecord))mergedRecord[field].push(...(record[field]||[]));delete records[id];}
    for(const [index,person] of profiles.entries()){
      const name=key(person.name),knownAffiliations=affiliations(person).map(key);
      if(name&&!mergedRecord.names.includes(name))mergedRecord.names.push(name);
      for(const affiliation of knownAffiliations)if(affiliation&&!mergedRecord.affiliations.includes(affiliation))mergedRecord.affiliations.push(affiliation);
    }
    for(const field of Object.keys(mergedRecord))mergedRecord[field]=[...new Set(mergedRecord[field])];
    records[primaryId]=mergedRecord;
  }
  for(const row of project.rows||[]){
    for(const field of ['speakerEntityIds','chairEntityIds','authorEntityIds','personEntityIds'])if(Array.isArray(row[field]))row[field]=row[field].map(id=>selected.includes(id)?primaryId:id);
    if(Array.isArray(row.personIdentityCandidates))row.personIdentityCandidates=[...new Set(row.personIdentityCandidates.map(id=>selected.includes(id)?primaryId:id))];
    if(row.personIdentityCandidatesByName)for(const [name,candidates] of Object.entries(row.personIdentityCandidatesByName))row.personIdentityCandidatesByName[name]=[...new Set(candidates.map(id=>selected.includes(id)?primaryId:id))];
    const remainingCandidates=Object.values(row.personIdentityCandidatesByName||{}).flat();
    if(row.personIdentityConflict&&new Set([...(row.personIdentityCandidates||[]),...remainingCandidates]).size<2){row.personIdentityConflict=false;row.personIdentityResolved=true;row.personIdentityCandidates=[];row.personIdentityCandidatesByName={};}
  }
  project.identityWarnings=(project.identityWarnings||[]).filter(warning=>!profiles.some(person=>String(warning).toLocaleLowerCase().includes(key(person.name))));
  for(const id of selected.slice(1))project.personMergeHistory=[...(project.personMergeHistory||[]),{keptId:primaryId,removedId:id,at:new Date().toISOString()}];
  return result;
}

/** Merge any number of profiles into the first selected ID on an isolated snapshot. */
export function mergePersonProfilesMany(project,people,selectedIds,choices={}){
  const next=structuredClone(project);mergeProfilesInPlace(next,people,selectedIds,choices);return next;
}

/** Apply pairwise explicit different/unresolved decisions on an isolated snapshot. */
export function applyPersonIdentityDecision(project,people,selectedIds,decision='different'){
  if(!['different','unresolved'].includes(decision))throw new Error('Choose different people or leave unresolved');
  const ids=[...new Set(selectedIds||[])],lookup=new Map(people.map(person=>[person.id,person]));
  if(ids.length<2)throw new Error('Select at least two profiles');
  if(ids.some(id=>!lookup.has(id)))throw new Error('Every selected profile must exist in the current people directory');
  const next=structuredClone(project);for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)decidePersonIdentity(next,ids[i],ids[j],decision);return next;
}

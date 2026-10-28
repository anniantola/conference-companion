const key=value=>String(value||'').trim().toLocaleLowerCase();
const affiliations=person=>person?.affiliations||String(person?.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean);

export function possiblePersonDuplicates(people=[]){
  const groups=new Map();
  for(const person of people){const name=key(person.name);if(!name)continue;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(person);}
  return [...groups.values()].filter(group=>group.length>1);
}

const canonicalPair=(a,b)=>[String(a),String(b)].sort().join('::');

/** Return unresolved same-name groups with the programme/source context organizers need. */
export function identityReviewGroups(project,people=[]){
  const rows=project.rows||[],decisions=project.identityDecisions?.pairs||{};
  return possiblePersonDuplicates(people).map(candidates=>{
    const ids=new Set(candidates.map(person=>person.id));
    const appearances=[];
    for(const row of rows){
      const fields=[['speaker','speakerEntityIds'],['chair','chairEntityIds']];
      for(const [role,idField] of fields){
        const names=String(row[role]||'').split(/\s*(?:;|\band\b)\s*/i);
        names.forEach((name,index)=>{
          const id=row[idField]?.[index];
          if(ids.has(id)||(!id&&candidates.some(p=>key(p.name)===key(name))))appearances.push({role,name,row});
        });
      }
    }
    const pairStates=[];
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)pairStates.push(decisions[canonicalPair(candidates[i].id,candidates[j].id)]||'unresolved');
    return {name:candidates[0]?.name||'',candidates,appearances,pairStates,unresolved:pairStates.some(state=>state==='unresolved')};
  }).filter(group=>group.unresolved);
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
  const keep=people.find(p=>p.id===keepId),remove=people.find(p=>p.id===removeId);
  if(!keep||!remove)throw new Error('Both people must exist in the current project');
  const decisions={...(project.identityDecisions?.pairs||{})},transferred={};
  for(const [pair,decision] of Object.entries(decisions)){
    const [a,b]=pair.split('::');if(a!==removeId&&b!==removeId)continue;
    const other=a===removeId?b:a;if(other===keepId)continue;
    const key=[keepId,other].sort().join('::');if(decisions[key]&&decisions[key]!==decision)throw new Error('These profiles have conflicting confirmed identity decisions; review the conflict before merging');
    transferred[key]=decision;
  }
  const fields=['name','position','publicEmail','orcid','website','photoUrl'];
  const read=(person,field)=>field==='website'?(person.links||[]).find(x=>x.label==='Website')?.url||person.website||'':person[field]||'';
  const result={};
  for(const field of fields)result[field]=read(choices[field]==='remove'?remove:keep,field);
  result.affiliation=[...new Map([...affiliations(keep),...affiliations(remove)].map(value=>[key(value),value])).values()].join('; ');
  result.papers=[...new Map([...(keep.papers||[]),...(remove.papers||[])].map(value=>[JSON.stringify(value),value])).values()];
  const extra=(project.extraPeople||[]).find(p=>p.id===keepId);
  if(extra)Object.assign(extra,result);
  else project.peopleOverrides={...(project.peopleOverrides||{}),[keepId]:{...(project.peopleOverrides?.[keepId]||{}),...result}};
  const photoList=[...(project.mergedPersonPhotos?.[keepId]||[]),project.peoplePhotos?.[keepId],...(project.mergedPersonPhotos?.[removeId]||[]),project.peoplePhotos?.[removeId]].filter(Boolean);
  const uniquePhotos=photoList;
  const preferredPhoto=project.peoplePhotos?.[choices.photoUrl==='remove'?removeId:keepId]||project.peoplePhotos?.[choices.photoUrl==='remove'?keepId:removeId]||uniquePhotos[0];
  if(preferredPhoto)project.peoplePhotos={...(project.peoplePhotos||{}),[keepId]:preferredPhoto};
  project.mergedPersonPhotos={...(project.mergedPersonPhotos||{})};
  const archived=uniquePhotos.filter(photo=>photo!==preferredPhoto);if(archived.length)project.mergedPersonPhotos[keepId]=archived;
  else delete project.mergedPersonPhotos[keepId];
  delete project.mergedPersonPhotos[removeId];
  if(project.peoplePhotos)delete project.peoplePhotos[removeId];
  if(project.peopleOverrides)delete project.peopleOverrides[removeId];
  project.extraPeople=(project.extraPeople||[]).filter(p=>p.id!==removeId);
  project.personIdAliases={...(project.personIdAliases||{}),[removeId]:keepId};
  for(const pair of Object.keys(decisions)){const [a,b]=pair.split('::');if(a===removeId||b===removeId)delete decisions[pair];}
  project.identityDecisions={...(project.identityDecisions||{}),pairs:{...decisions,...transferred}};
  for(const [alias,target] of Object.entries(project.personIdAliases))if(target===removeId)project.personIdAliases[alias]=keepId;
  for(const row of project.rows||[]){
    for(const field of ['speakerEntityIds','chairEntityIds'])if(Array.isArray(row[field]))row[field]=row[field].map(id=>id===removeId?keepId:id);
    if(Array.isArray(row.personIdentityCandidates))row.personIdentityCandidates=[...new Set(row.personIdentityCandidates.map(id=>id===removeId?keepId:id))];
    if(row.personIdentityCandidatesByName)for(const [name,ids] of Object.entries(row.personIdentityCandidatesByName))row.personIdentityCandidatesByName[name]=[...new Set(ids.map(id=>id===removeId?keepId:id))];
    if(row.personIdentityConflict&&row.personIdentityCandidates?.length===1){row.personIdentityConflict=false;row.personIdentityResolved=true;}
  }
  for(const [identity,id] of Object.entries(project.identityRegistry?.people||{}))if(id===removeId)project.identityRegistry.people[identity]=keepId;
  const records=project.identityRegistry?.personRecords;
  if(records?.[removeId]){
    const kept=records[keepId]||{names:[],affiliations:[],explicitIds:[]},removed=records[removeId];
    for(const field of ['names','affiliations','explicitIds'])kept[field]=[...new Set([...(kept[field]||[]),...(removed[field]||[])])];
    records[keepId]=kept;delete records[removeId];
  }
  project.personMergeHistory=[...(project.personMergeHistory||[]),{keptId:keepId,removedId:removeId,at:new Date().toISOString()}];
  return result;
}

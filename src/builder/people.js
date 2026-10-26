const key=value=>String(value||'').trim().toLocaleLowerCase();
const affiliations=person=>person?.affiliations||String(person?.affiliation||'').split(';').map(x=>x.trim()).filter(Boolean);

export function possiblePersonDuplicates(people=[]){
  const groups=new Map();
  for(const person of people){const name=key(person.name);if(!name)continue;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(person);}
  return [...groups.values()].filter(group=>group.length>1);
}

/** Apply an organizer-confirmed merge to Builder state and every programme reference. */
export function mergePersonProfiles(project,people,keepId,removeId,choices={}){
  if(!keepId||!removeId||keepId===removeId)throw new Error('Choose two different people to merge');
  const keep=people.find(p=>p.id===keepId),remove=people.find(p=>p.id===removeId);
  if(!keep||!remove)throw new Error('Both people must exist in the current project');
  const fields=['name','position','publicEmail','orcid','website','photoUrl'];
  const read=(person,field)=>field==='website'?(person.links||[]).find(x=>x.label==='Website')?.url||person.website||'':person[field]||'';
  const result={};
  for(const field of fields)result[field]=read(choices[field]==='remove'?remove:keep,field);
  result.affiliation=[...new Map([...affiliations(keep),...affiliations(remove)].map(value=>[key(value),value])).values()].join('; ');
  result.papers=[...new Map([...(keep.papers||[]),...(remove.papers||[])].map(value=>[JSON.stringify(value),value])).values()];
  const extra=(project.extraPeople||[]).find(p=>p.id===keepId);
  if(extra)Object.assign(extra,result);
  else project.peopleOverrides={...(project.peopleOverrides||{}),[keepId]:{...(project.peopleOverrides?.[keepId]||{}),...result}};
  if(choices.photoUrl==='remove'){
    if(project.peoplePhotos?.[removeId])project.peoplePhotos={...(project.peoplePhotos||{}),[keepId]:project.peoplePhotos[removeId]};
    else if(project.peoplePhotos)delete project.peoplePhotos[keepId];
  }
  if(project.peoplePhotos)delete project.peoplePhotos[removeId];
  if(project.peopleOverrides)delete project.peopleOverrides[removeId];
  project.extraPeople=(project.extraPeople||[]).filter(p=>p.id!==removeId);
  project.personIdAliases={...(project.personIdAliases||{}),[removeId]:keepId};
  for(const [alias,target] of Object.entries(project.personIdAliases))if(target===removeId)project.personIdAliases[alias]=keepId;
  for(const row of project.rows||[]){
    for(const field of ['speakerEntityIds','chairEntityIds'])if(Array.isArray(row[field]))row[field]=row[field].map(id=>id===removeId?keepId:id);
    if(Array.isArray(row.personIdentityCandidates))row.personIdentityCandidates=[...new Set(row.personIdentityCandidates.map(id=>id===removeId?keepId:id))];
    if(row.personIdentityConflict&&row.personIdentityCandidates?.length===1){row.personIdentityConflict=false;row.personIdentityResolved=true;}
  }
  for(const [identity,id] of Object.entries(project.identityRegistry?.people||{}))if(id===removeId)project.identityRegistry.people[identity]=keepId;
  project.personMergeHistory=[...(project.personMergeHistory||[]),{keptId:keepId,removedId:removeId,at:new Date().toISOString()}];
  return result;
}

/** Human-readable Builder diagnostics with a direct target in the review UI. */
export function describeValidationMessage(message,pkg,project){
  const assignment=String(message).match(/^Person assignment needs review \[identity-assignment:([^:]+):(speaker|chair|author):(\d+)\]$/);
  if(assignment){
    const rowId=decodeURIComponent(assignment[1]),role=assignment[2],index=Number(assignment[3]),row=(project.rows||[]).find(item=>String(item.id)===rowId);
    if(row){
      const names=String(row[role]||'').split(/\s*(?:;|\band\b)\s*/i).filter(Boolean),name=names[index]||'Unnamed person',issue=(row.personIdentityIssues||[]).find(item=>item.role===role&&item.index===index),ids=issue?.candidateIds||[],people=new Map((pkg.people.people||[]).map(person=>[person.id,person]));
      const candidates=ids.map(id=>people.get(id)).filter(Boolean).map(person=>`${person.name} — ${(person.affiliations||[]).join('; ')||'affiliation unknown'}`);
      const sourceRow=row.source?.row||row.source?.line||((project.rows||[]).indexOf(row)+1),roleLabel=role==='speaker'?(String(row.type||'').toLowerCase()==='poster'?'Poster author':'Speaker'):role==='chair'?'Chair':'Author';
      const context=[row.date,[row.start,row.end].filter(Boolean).join('–'),row.location,row.track].filter(Boolean).join(' · ');
      const detail=candidates.length?` Candidates: ${[...new Set(candidates)].join('; ')}.`:' Add or select a profile in Step 4.';
      return {text:`Person assignment needs review — Programme row ${sourceRow}: ${row.title||row.session||'Untitled programme entry'}${context?` · ${context}`:''} · ${roleLabel}: ${name}. ${issue?.reason||'More than one profile may match this name.'} Choose which profile is associated with this programme appearance.${detail}`,target:{type:'identity-assignment',id:row.id,role,index}};
    }
  }
  const sessions=pkg.programme.sessions||[],presentations=pkg.programme.presentations||[],posters=pkg.programme.posters||[];
  const locations=new Map((pkg.locations.locations||[]).map(x=>[x.id,x.name]));
  const tracks=new Map((pkg.programme.tracks||[]).map(x=>[x.id,x.name]));
  const bySession=new Map(sessions.map(x=>[x.id,x]));
  const entities=new Map();
  const context=s=>[s?.date,[s?.start,s?.end].filter(Boolean).join('–'),locations.get(s?.locationId),tracks.get(s?.trackId)].filter(Boolean).join(' · ');
  for(const s of sessions)entities.set(s.id,{text:`${s.title||'Untitled session'} (${context(s)})`,target:{type:'session',id:s.id}});
  for(const p of presentations){const s=bySession.get(p.sessionId);entities.set(p.id,{text:`${p.title||'Untitled presentation'} (${context({...s,start:p.start||s?.start,end:p.end||s?.end})})`,target:{type:'row',id:p.id}});}
  for(const p of posters){const s=bySession.get(p.posterSessionId);entities.set(p.id,{text:`${p.title||'Untitled poster'} (${context(s)})`,target:{type:'row',id:p.id}});}
  for(const p of pkg.people.people||[])entities.set(p.id,{text:p.name||'Unnamed person',target:{type:'person',id:p.id}});
  for(const l of pkg.locations.locations||[])entities.set(l.id,{text:l.name||'Unnamed location',target:{type:'location',id:l.id}});
  for(const t of pkg.programme.tracks||[])entities.set(t.id,{text:t.name||'Unnamed track',target:{type:'location',id:t.id}});
  for(const row of project.rows||[])if(row.id){const record={text:`row ${row.source?.row||row.source?.line||'?'}: ${row.title||'Untitled entry'} (${[row.date,[row.start,row.end].filter(Boolean).join('–'),row.location,row.track].filter(Boolean).join(' · ')})`,target:{type:'row',id:row.entityId||row.id}};entities.set(row.id,record);if(row.source?.id)entities.set(row.source.id,record);}
  const ids=[...entities.keys()].filter(Boolean).sort((a,b)=>b.length-a.length);
  let target=null;
  const pattern=ids.length?new RegExp(`(?<![A-Za-z0-9_-])(?:${ids.map(id=>id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})(?![A-Za-z0-9_-])`,'g'):null;
  const result=pattern?String(message).replace(pattern,id=>{const record=entities.get(id);if(!target)target=record.target;return record.text;}):String(message);
  return {text:result,target};
}

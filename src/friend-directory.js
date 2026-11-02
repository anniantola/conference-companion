import {normalizeEmail,normalizeOrcid} from './safe-url.js';

const clean=value=>String(value||'').trim().toLocaleLowerCase();
const affiliationValues=contact=>[...(contact?.affiliations||[]),contact?.affiliation].map(clean).filter(Boolean);
const emailValues=contact=>[...(contact?.emails||[]),contact?.email].map(normalizeEmail).filter(Boolean).map(clean);

export function validConferenceIdentity(identity,conference,model){
  if(!identity||identity.conferenceId!==conference?.id||typeof identity.personId!=='string')return null;
  return model?.person(identity.personId)?{conferenceId:conference.id,personId:identity.personId}:null;
}

export function identityCandidates(contact,conference,model,{external=false}={}){
  const people=model?.people?.people||[],orcid=normalizeOrcid(contact?.orcid),emails=new Set(emailValues(contact));
  const explicit=validConferenceIdentity(contact?.conferenceIdentity||contact?.claimedConferenceIdentity,conference,model);
  const rows=people.map(person=>{
    const personOrcid=normalizeOrcid(person.orcid),personEmail=normalizeEmail(person.publicEmail);
    const orcidMatch=!!(orcid&&personOrcid&&orcid===personOrcid);
    const emailMatch=!!(personEmail&&emails.has(clean(personEmail)));
    const explicitMatch=explicit?.personId===person.id;
    const nameMatch=!!clean(contact?.name)&&clean(contact.name)===clean(person.name);
    const affiliationMatch=affiliationValues(contact).some(value=>affiliationValues(person).includes(value));
    if(!(explicitMatch||orcidMatch||emailMatch||(nameMatch&&affiliationMatch)))return null;
    const rank=explicitMatch?0:orcidMatch?1:emailMatch?2:3;
    // An external vCard assertion is a hint until independent directory data verifies it.
    const automatic=orcidMatch||emailMatch||(!external&&explicitMatch);
    return {person,rank,automatic,reason:explicitMatch?'Conference ID':orcidMatch?'ORCID':emailMatch?'Public email':'Name and affiliation'};
  }).filter(Boolean).sort((a,b)=>a.rank-b.rank||a.person.name.localeCompare(b.person.name));
  return rows;
}

export function automaticIdentity(contact,conference,model,{external=false}={}){
  const candidates=identityCandidates(contact,conference,model,{external});
  const best=candidates[0];
  if(!best?.automatic||candidates.filter(row=>row.rank===best.rank).length!==1)return null;
  // Conflicting external IDs need a person to resolve the disagreement.
  const claimed=validConferenceIdentity(contact?.claimedConferenceIdentity,conference,model);
  if(external&&claimed&&claimed.personId!==best.person.id)return null;
  return {conferenceId:conference.id,personId:best.person.id};
}

export function personActivities(personId,model){
  if(!personId||!model)return [];
  const activities=[];
  for(const item of model.items||[])if(item.entityType==='presentation'&&item.speakerIds?.includes(personId))activities.push({role:'Oral presentation',type:'event',id:item.id,title:item.title,date:item.date,start:item.start,end:item.end,locationId:item.locationId});
  for(const poster of model.posters||[])if(poster.authorIds?.includes(personId)){
    const session=poster.posterSession;
    activities.push({role:'Poster presentation',type:'poster',id:poster.id,title:poster.title,date:session?.date||'',start:session?.start||'',end:session?.end||'',locationId:session?.locationId||'',posterNumber:poster.number});
  }
  for(const session of model.programme?.sessions||[])if(session.chairIds?.includes(personId))activities.push({role:'Session chair',type:'session',id:session.id,title:session.title,date:session.date,start:session.start,end:session.end,locationId:session.locationId});
  return activities.sort((a,b)=>`${a.date}|${a.start}|${a.role}|${a.id}`.localeCompare(`${b.date}|${b.start}|${b.role}|${b.id}`));
}

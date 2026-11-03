import {normalizeEmail,normalizeOrcid} from './safe-url.js';
import {normalizeAvatarId} from './avatars.js';

const values=(contact,plural,singular)=>[...(Array.isArray(contact?.[plural])?contact[plural]:[]),contact?.[singular]].filter(Boolean);
const emails=contact=>new Set(values(contact,'emails','email').map(normalizeEmail).filter(Boolean).map(x=>x.toLowerCase()));
const intersects=(a,b)=>[...a].some(value=>b.has(value));
const union=(a,b)=>{
  const result=[],seen=new Set();
  for(const item of [...a,...b]){
    const key=JSON.stringify(item);
    if(!key||seen.has(key))continue;
    seen.add(key);result.push(item);
  }
  return result;
};

export function findMatchingFriend(friends,incoming) {
  const incomingEmails=emails(incoming),incomingOrcid=normalizeOrcid(incoming.orcid);
  const compatible=friend=>{
    const priorOrcid=normalizeOrcid(friend.orcid),priorEmails=emails(friend);
    return !(incomingOrcid&&priorOrcid&&incomingOrcid!==priorOrcid)
      && !(incomingEmails.size&&priorEmails.size&&!intersects(incomingEmails,priorEmails));
  };
  const strong=friends.filter(friend=>{
    const priorOrcid=normalizeOrcid(friend.orcid);
    if(incomingOrcid&&priorOrcid&&incomingOrcid===priorOrcid)return true;
    return compatible(friend)&&String(friend.name||'').trim().toLowerCase()===String(incoming.name||'').trim().toLowerCase()&&intersects(incomingEmails,emails(friend));
  });
  if(strong.length===1)return strong[0];
  if(strong.length>1)return null;
  // Matching names and affiliations may still belong to different attendees.
  // Keep them as separate contacts unless an ORCID or email confirms identity.
  return null;
}

export function mergeFriendContact(existing,incoming,{conferenceId='',conferenceName=''}={}) {
  if(!existing)return {
    ...incoming,id:crypto.randomUUID(),metAtConferenceId:conferenceId,metAtEventId:'',
    metAt:conferenceName,savedAt:Date.now(),privateNotes:'',tags:[]
  };
  const merged={...existing};
  for(const field of ['name','position','affiliation','email','orcid','website','linkedin','bio'])
    if(incoming[field])merged[field]=incoming[field];
  if(normalizeAvatarId(incoming.avatarId))merged.avatarId=incoming.avatarId;
  if(incoming.claimedConferenceIdentity)merged.claimedConferenceIdentity=incoming.claimedConferenceIdentity;
  for(const field of ['emails','affiliations','links','papers'])
    merged[field]=union(existing[field]||[],incoming[field]||[]);
  if(!merged.email)merged.email=merged.emails?.[0]||'';
  if(!merged.affiliation)merged.affiliation=merged.affiliations?.[0]||'';
  return merged;
}

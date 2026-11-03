import {normalizeEmail, normalizeOrcid, normalizeWebUrl} from './safe-url.js';
import {publicationReference,publicationText} from './publications.js';
import {normalizeAvatarId} from './avatars.js';

function esc(value='') { return String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function unesc(value='') { return String(value).replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\'); }
function compactUrl(value='') { return String(value).trim(); }
function unique(values) { return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))]; }
function fieldValues(profile,plural,singular) { return unique([...(Array.isArray(profile[plural])?profile[plural]:[]),profile[singular]]); }

export function sharedFieldLabels(profile,{compact=false,includeWebsite=true}={}) {
  const fields=['Name'];
  if(normalizeAvatarId(profile.avatarId))fields.push('Avatar');
  if(profile.position)fields.push('Position');
  if(fieldValues(profile,'affiliations','affiliation').length)fields.push('Affiliation');
  if(fieldValues(profile,'emails','email').length)fields.push('Email');
  if(profile.orcid)fields.push('ORCID');
  if(includeWebsite&&profile.website)fields.push('Website');
  if(!compact){
    if(profile.linkedin)fields.push('LinkedIn');
    if(profile.bio)fields.push('Research interests / bio');
    if((profile.papers||[]).length)fields.push('Selected papers');
    if((profile.links||[]).length)fields.push('Other links');
    if(fieldValues(profile,'emails','email').length>1)fields.push('Additional emails');
    if(fieldValues(profile,'affiliations','affiliation').length>1)fields.push('Additional affiliations');
  }
  return fields;
}

export function profileToVCard(profile, {compact=false,includeWebsite=true,conferenceIdentity=null}={}) {
  const name=String(profile.name||'').trim();
  if(!name) throw new Error('Name is required for a profile card');
  const website=includeWebsite&&profile.website?normalizeWebUrl(profile.website):'';
  const linkedin=profile.linkedin?normalizeWebUrl(profile.linkedin):'';
  const orcid=profile.orcid?normalizeOrcid(profile.orcid):'';
  const emails=fieldValues(profile,'emails','email');
  const org=fieldValues(profile,'affiliations','affiliation');
  if(includeWebsite&&profile.website&&!website)throw new Error('Website must be an HTTPS URL or DOI reference');
  if(!compact&&profile.linkedin&&!linkedin)throw new Error('LinkedIn must be an HTTPS URL');
  if(profile.orcid&&!orcid)throw new Error('ORCID must be a valid ORCID identifier');
  if(emails.some(email=>!normalizeEmail(email)))throw new Error('Email address is invalid');
  const lines=['BEGIN:VCARD','VERSION:4.0',`FN:${esc(name)}`];
  if(normalizeAvatarId(profile.avatarId))lines.push(`X-CONFERENCE-COMPANION-AVATAR:${profile.avatarId}`);
  if(conferenceIdentity?.conferenceId&&conferenceIdentity?.personId){
    for(const value of [conferenceIdentity.conferenceId,conferenceIdentity.personId])if(!/^[\w.-]{1,160}$/.test(value))throw new Error('Conference identity is invalid');
    lines.push(`X-CONFERENCE-COMPANION-ID:${esc(conferenceIdentity.conferenceId)}`);
    lines.push(`X-CONFERENCE-COMPANION-PERSON-ID:${esc(conferenceIdentity.personId)}`);
  }
  if(profile.position) lines.push(`TITLE:${esc(profile.position)}`);
  for(const affiliation of compact?org.slice(0,1):org)lines.push(`ORG:${esc(affiliation)}`);
  for(const email of compact?emails.slice(0,1):emails)lines.push(`EMAIL:${esc(email)}`);
  if(website) lines.push(`URL;TYPE=HOME:${compactUrl(website)}`);
  if(orcid) lines.push(`URL;TYPE=ORCID:https://orcid.org/${orcid}`);
  if(!compact && linkedin) lines.push(`URL;TYPE=LinkedIn:${compactUrl(linkedin)}`);
  if(!compact && profile.bio) lines.push(`NOTE:${esc(profile.bio)}`);
  if(!compact) for(const p of profile.papers||[]) {
    const raw=typeof p==='string'?(p.includes(' | ')?p.slice(p.lastIndexOf(' | ')+3).trim():p):String(p?.doi||p?.url||p?.link||'');
    if(/^[a-z][a-z0-9+.-]*:/i.test(raw)&&!publicationReference(raw))throw new Error('Paper link must be HTTPS or a DOI reference');
    const value=publicationText(p);if(value)lines.push(`X-PAPER:${esc(value)}`);
  }
  if(!compact)for(const entry of profile.links||[]){
    const raw=typeof entry==='string'?entry:entry?.url;
    if(!raw)continue;
    const url=normalizeWebUrl(raw);
    if(!url)throw new Error('Public link must be an HTTPS URL or DOI reference');
    const label=typeof entry==='string'?'':String(entry?.label||'').trim().replace(/[^a-zA-Z0-9 -]/g,'').slice(0,40);
    lines.push(`URL;TYPE=${label||'OTHER'}:${compactUrl(url)}`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function compactProfileVCard(profile) { return profileToVCard(profile,{compact:true}); }

export function parseVCard(text) {
  const raw=String(text||'').replace(/\r?\n[ \t]/g,'');
  if(!/BEGIN:VCARD/i.test(raw)) throw new Error('Not a vCard');
  const out={emails:[],affiliations:[],links:[],papers:[]};
  for(const line of raw.split(/\r?\n/)){
    const idx=line.indexOf(':'); if(idx<0) continue;
    const key=line.slice(0,idx), value=unesc(line.slice(idx+1));
    const base=key.split(';')[0].toUpperCase();
    if(base==='FN') out.name=value;
    else if(base==='X-CONFERENCE-COMPANION-AVATAR')out.avatarId=normalizeAvatarId(value);
    else if(base==='X-CONFERENCE-COMPANION-ID') {if(!/^[\w.-]{1,160}$/.test(value))throw new Error('vCard contains an invalid conference ID');out.claimedConferenceIdentity={...(out.claimedConferenceIdentity||{}),conferenceId:value};}
    else if(base==='X-CONFERENCE-COMPANION-PERSON-ID') {if(!/^[\w.-]{1,160}$/.test(value))throw new Error('vCard contains an invalid person ID');out.claimedConferenceIdentity={...(out.claimedConferenceIdentity||{}),personId:value};}
    else if(base==='TITLE') out.position=value;
    else if(base==='ORG') {if(value)out.affiliations.push(value);}
    else if(base==='EMAIL') {
      const email=normalizeEmail(value);
      if(!email)throw new Error('vCard contains an invalid email address');
      out.emails.push(email);
    }
    else if(base==='NOTE') out.bio=value;
    else if(base==='URL') {
      if(/TYPE=ORCID/i.test(key)||/orcid\.org/i.test(value)) {
        const orcid=normalizeOrcid(value);
        if(!orcid)throw new Error('vCard contains an invalid ORCID URL');
        out.orcid=orcid;
      } else {
        const url=normalizeWebUrl(value);
        if(!url)throw new Error('vCard contains an unsafe URL');
        const type=key.match(/(?:^|;)TYPE=([^;]+)/i)?.[1]||'';
        if(/^LinkedIn$/i.test(type)||/linkedin\.com/i.test(url))out.linkedin=url;
        else if(/^(home|website)$/i.test(type))out.website=url;
        else if(type)out.links.push(type==='OTHER'?url:{label:type,url});
        else if(!out.website)out.website=url;
        else out.links.push(url);
      }
    } else if(base==='X-PAPER') {
      if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^doi:/i.test(value)&&!/^https:/i.test(value))throw new Error('vCard contains an unsafe paper reference');
      out.papers.push(value);
    }
  }
  if(!out.name) throw new Error('vCard has no name');
  if(out.claimedConferenceIdentity&&(!out.claimedConferenceIdentity.conferenceId||!out.claimedConferenceIdentity.personId))delete out.claimedConferenceIdentity;
  out.email=out.emails[0]||'';
  out.affiliation=out.affiliations[0]||'';
  return out;
}

export function downloadVCard(profile, filename='conference-contact.vcf',options={}) {
  const blob=new Blob([profileToVCard(profile,options)],{type:'text/vcard;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

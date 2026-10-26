import {normalizeEmail, normalizeOrcid, normalizeWebUrl} from './safe-url.js';

function esc(value='') { return String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function unesc(value='') { return String(value).replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\'); }
function compactUrl(value='') { return String(value).trim(); }

export function profileToVCard(profile, {compact=false}={}) {
  const name=String(profile.name||'').trim();
  if(!name) throw new Error('Name is required for a profile card');
  const website=profile.website?normalizeWebUrl(profile.website):'';
  const linkedin=profile.linkedin?normalizeWebUrl(profile.linkedin):'';
  const orcid=profile.orcid?normalizeOrcid(profile.orcid):'';
  const email=(profile.emails||[])[0]||profile.email||'';
  if(profile.website&&!website)throw new Error('Website must be an HTTPS URL or DOI reference');
  if(profile.linkedin&&!linkedin)throw new Error('LinkedIn must be an HTTPS URL');
  if(profile.orcid&&!orcid)throw new Error('ORCID must be a valid ORCID identifier');
  if(email&&!normalizeEmail(email))throw new Error('Email address is invalid');
  const lines=['BEGIN:VCARD','VERSION:4.0',`FN:${esc(name)}`];
  if(profile.position) lines.push(`TITLE:${esc(profile.position)}`);
  const org=(profile.affiliations||profile.affiliation?[...(Array.isArray(profile.affiliations)?profile.affiliations:[]),...(profile.affiliation?[profile.affiliation]:[])]:[]).filter(Boolean);
  if(org.length) lines.push(`ORG:${esc(org[0])}`);
  const emails=Array.isArray(profile.emails)?profile.emails:(profile.email?[profile.email]:[]);
  if(email) lines.push(`EMAIL:${esc(email)}`);
  if(website) lines.push(`URL:${compactUrl(website)}`);
  if(orcid) lines.push(`URL;TYPE=ORCID:https://orcid.org/${orcid}`);
  if(!compact && linkedin) lines.push(`URL;TYPE=LinkedIn:${compactUrl(linkedin)}`);
  if(!compact && profile.bio) lines.push(`NOTE:${esc(profile.bio)}`);
  if(!compact) for(const p of profile.papers||[]) if(p) lines.push(`X-PAPER:${esc(typeof p==='string'?p:(p.doi||p.title||''))}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function compactProfileVCard(profile, maxBytes=130) {
  const variants=[
    {...profile,bio:'',papers:[],linkedin:''},
    {...profile,bio:'',papers:[],linkedin:'',website:''},
    {...profile,bio:'',papers:[],linkedin:'',website:'',position:''},
    {...profile,bio:'',papers:[],linkedin:'',website:'',position:'',orcid:''}
  ];
  for(const v of variants){
    const text=profileToVCard(v,{compact:true});
    if(new TextEncoder().encode(text).length<=maxBytes) return text;
  }
  const minimal={name:profile.name,email:(profile.emails||[])[0]||profile.email||'',affiliation:(profile.affiliations||[])[0]||profile.affiliation||''};
  return profileToVCard(minimal,{compact:true});
}

export function parseVCard(text) {
  const raw=String(text||'').replace(/\r\n[ \t]/g,'');
  if(!/BEGIN:VCARD/i.test(raw)) throw new Error('Not a vCard');
  const out={emails:[],affiliations:[],links:[],papers:[]};
  for(const line of raw.split(/\r?\n/)){
    const idx=line.indexOf(':'); if(idx<0) continue;
    const key=line.slice(0,idx), value=unesc(line.slice(idx+1));
    const base=key.split(';')[0].toUpperCase();
    if(base==='FN') out.name=value;
    else if(base==='TITLE') out.position=value;
    else if(base==='ORG') out.affiliations=value.split(';').filter(Boolean);
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
        if(/TYPE=LinkedIn/i.test(key)||/linkedin\.com/i.test(url))out.linkedin=url;
        else if(!out.website)out.website=url;
        else out.links.push(url);
      }
    } else if(base==='X-PAPER') {
      if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^doi:/i.test(value)&&!/^https:/i.test(value))throw new Error('vCard contains an unsafe paper reference');
      out.papers.push(value);
    }
  }
  if(!out.name) throw new Error('vCard has no name');
  out.email=out.emails[0]||'';
  out.affiliation=out.affiliations[0]||'';
  return out;
}

export function downloadVCard(profile, filename='conference-contact.vcf') {
  const blob=new Blob([profileToVCard(profile)],{type:'text/vcard;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

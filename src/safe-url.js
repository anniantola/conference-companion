const DOI = /^(?:doi:\s*)?(10\.\d{4,9}\/[\-._;()/:A-Z0-9]+)$/i;
const ORCID = /^(\d{4}-\d{4}-\d{4}-\d{3}[0-9X])$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function clean(value) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u001f\u007f\\]/.test(text)) return '';
  return text;
}

export function normalizeEmail(value) {
  const text = clean(value);
  return EMAIL.test(text) ? text : '';
}

export function normalizeOrcid(value) {
  let text = clean(value);
  text = text.replace(/^https:\/\/orcid\.org\//i, '').replace(/^orcid:/i, '');
  return ORCID.test(text) ? text.toUpperCase() : '';
}

export function normalizeWebUrl(value, {allowRelative = false} = {}) {
  const text = clean(value);
  if (!text) return '';

  const doi = text.match(DOI);
  if (doi) return `https://doi.org/${doi[1]}`;
  if (/^orcid:/i.test(text) || /^https:\/\/orcid\.org\//i.test(text)) {
    const id = normalizeOrcid(text);
    return id ? `https://orcid.org/${id}` : '';
  }

  if (allowRelative && !/^[a-z][a-z0-9+.-]*:/i.test(text) && !text.startsWith('//')) {
    const path = text.replace(/^\.\//, '');
    if (!path || path.startsWith('//') || /[?#]/.test(path)) return '';
    try {
      const parts=path.replace(/^\//,'').split('/');
      if(parts.some(part=>!part||/%2f|%5c/i.test(part)||['.','..'].includes(decodeURIComponent(part))))return '';
      if(parts.some(part=>{let decoded=part;for(let i=0;i<16;i++){if(decoded==='.'||decoded==='..'||decoded.includes('/')||decoded.includes('\\'))return true;const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}return decoded==='.'||decoded==='..'||decoded.includes('/')||decoded.includes('\\');}))return '';
      return path;
    }
    catch { return ''; }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https:/i.test(text)) return '';
  if (text.startsWith('//')) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function normalizeExternalLink(value) {
  const text=clean(value);
  if(/^mailto:/i.test(text)){
    const email=normalizeEmail(text.slice(7));
    return email?`mailto:${email}`:'';
  }
  return normalizeWebUrl(text);
}

export function validatePackageUrls(pkg) {
  const errors = [];
  const walk = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (typeof child === 'string' && ['url'].includes(key) && child.trim() && !normalizeExternalLink(child)) {
        errors.push(`${fieldPath} must be a safe HTTPS, email, or DOI link`);
      } else if (typeof child === 'string' && ['mapUrl', 'officialWebsite', 'linkedin', 'programmePdf'].includes(key) && child.trim() && !normalizeWebUrl(child, {allowRelative:key==='programmePdf'})) {
        errors.push(`${fieldPath} must be an HTTPS URL or DOI reference`);
      } else if (typeof child === 'string' && (['photoUrl','logo','logoLight','logoDark'].includes(key)||/\.sponsorAssets\[\d+\]$/.test(fieldPath)||(['light','dark'].includes(key)&&/branding\.sponsorLogos\[\d+\]/.test(path))) && child.trim() && !normalizeWebUrl(child, {allowRelative:true})) {
        errors.push(`${fieldPath} must be a safe HTTPS URL or relative asset path`);
      } else if (typeof child === 'string' && ['contactEmail', 'publicEmail'].includes(key) && child.trim() && !normalizeEmail(child)) {
        errors.push(`${fieldPath} must be a valid email address`);
      } else if (typeof child === 'string' && key === 'orcid' && child.trim() && !normalizeOrcid(child)) {
        errors.push(`${fieldPath} must be a valid ORCID identifier`);
      } else if (typeof child === 'string' && key === 'doi' && child.trim() && !normalizeWebUrl(child)) {
        errors.push(`${fieldPath} must be a valid HTTPS or DOI reference`);
      } else if (key === 'sponsorAssets' && Array.isArray(child)) {
        child.forEach((url,index)=>{if(typeof url!=='string'||!normalizeWebUrl(url,{allowRelative:true}))errors.push(`${fieldPath}[${index}] must be a safe HTTPS URL or relative asset path`);});
      } else if (key === 'links' && Array.isArray(child)) {
        child.forEach((link,index)=>{
          if(typeof link==='string'){
            if(link&&!normalizeExternalLink(link))errors.push(`${fieldPath}[${index}] must be a safe HTTPS, email, or DOI link`);
          }else walk(link,`${fieldPath}[${index}]`);
        });
      } else {
        walk(child, fieldPath);
      }
    }
  };
  walk(pkg);
  return errors;
}

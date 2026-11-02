import {normalizeWebUrl} from './safe-url.js';

// Paper titles are text. Only an explicit DOI or HTTPS reference can become a link.
export function publicationReference(value) {
  const text=String(value||'').trim();
  if(!/^(?:doi:\s*)?10\.\d{4,9}\//i.test(text)&&!/^https:\/\//i.test(text))return '';
  return normalizeWebUrl(text);
}

export function publicationParts(entry) {
  if(typeof entry==='string') {
    const text=entry.trim();
    const separator=text.lastIndexOf(' | ');
    if(separator>0){
      const label=text.slice(0,separator).trim(),reference=text.slice(separator+3).trim();
      const url=publicationReference(reference);
      return {label:label||reference,url};
    }
    return {label:text,url:publicationReference(text)};
  }
  const label=String(entry?.title||entry?.label||'').trim();
  const reference=String(entry?.doi||entry?.url||entry?.link||'').trim();
  return {label:label||reference,url:publicationReference(reference)};
}

export function publicationText(entry) {
  const {label,url}=publicationParts(entry);
  return url&&label!==url?`${label} | ${url}`:label;
}

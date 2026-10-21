import {loadConferencePackage,getPackageDiagnostics,rollbackConferencePackage} from './src/package-store.js';
import {createConferenceModel} from './src/model.js';
import {createUserStore} from './src/user-store.js';
import * as calendar from './src/calendar.js';
import * as vcard from './src/vcard.js';
import * as qr from './src/qrcode.js';
import * as backup from './src/backup.js';

const ENGINE_VERSION='1.0.0';
const qs=new URLSearchParams(location.search);
const base=(qs.get('conference')||'./conference').replace(/\/$/,'');
const $=s=>document.querySelector(s);

function fail(message){document.body.innerHTML=`<main style="font-family:system-ui;padding:24px;max-width:760px;margin:auto"><h1>Conference app could not start</h1><p>${String(message||'Unknown error')}</p><p><code>${base}</code></p></main>`;}
function resolvePackageUrl(value){if(!value)return value;if(/^(?:[a-z]+:|\/)/i.test(value))return value;return `${base}/${String(value).replace(/^\.\//,'')}`;}
function dateMeta(date,locale){const d=new Date(`${date}T12:00:00Z`);return{weekday:new Intl.DateTimeFormat(locale||'en-GB',{weekday:'long',timeZone:'UTC'}).format(d),dateLabel:new Intl.DateTimeFormat(locale||'en-GB',{day:'numeric',month:'long',timeZone:'UTC'}).format(d)};}

function applyDocument(pkg,model,loadInfo){
  const {conference,branding,locations,manifest}=pkg;document.title=conference.name;document.documentElement.lang=conference.language||'en';
  const desc=document.querySelector('meta[name="description"]');if(desc)desc.content=`Conference companion for ${conference.fullName||conference.name}.`;
  const apple=document.querySelector('meta[name="apple-mobile-web-app-title"]');if(apple)apple.content=conference.shortName||conference.name;
  const root=document.documentElement;if(branding.primary)root.style.setProperty('--accent',branding.primary);if(branding.secondary)root.style.setProperty('--secondary',branding.secondary);root.dataset.headerStyle=branding.headerStyle||'text';root.dataset.typography=branding.typography||'system';
  const brand=$('.brand-lockup');if(brand)brand.href=conference.officialWebsite||'#';
  const fallback=$('.conference-logo-fallback');if(fallback){fallback.hidden=false;fallback.textContent=conference.shortName||conference.name;}
  const logo=$('.conference-logo');if(logo&&branding.logo){logo.src=resolvePackageUrl(branding.logo);logo.alt=conference.name;logo.hidden=false;}else if(logo)logo.hidden=true;
  const first=model.days[0],last=model.days.at(-1);const sub=$('.brand-subtitle');if(sub)sub.textContent=`${conference.city||''}${conference.city?' · ':''}${first?.dateLabel||conference.startDate}${last&&last.date!==first?.date?`–${last.dateLabel}`:''}`;
  const posterSession=model.posterSession,posterHeading=$('#posterHeadingEyebrow');if(posterHeading&&posterSession){const dm=dateMeta(posterSession.date,conference.locale);posterHeading.textContent=`${dm.weekday.toUpperCase()} · ${posterSession.start}–${posterSession.end}`;}
  const posterVenue=$('#posterHeadingVenue');if(posterVenue&&posterSession)posterVenue.textContent=(locations.locations||[]).find(x=>x.id===posterSession.locationId)?.name||'';
  const build=$('.build-version');if(build)build.textContent=`Engine ${ENGINE_VERSION} · data ${manifest.dataVersion} · ${loadInfo.source}`;
  const installTitle=$('#installTitle');if(installTitle)installTitle.textContent=`Install ${conference.shortName||conference.name}`;
}

(async()=>{
  try{
    const loadInfo=await loadConferencePackage(base,ENGINE_VERSION);const pkg=loadInfo.pkg;
    if(pkg.conference.programmePdf)pkg.conference.programmePdf=resolvePackageUrl(pkg.conference.programmePdf);
    const model=createConferenceModel(pkg),userStore=createUserStore(pkg.conference.id),userState=await userStore.getState();
    window.CONFERENCE_PACKAGE=pkg;window.CONFERENCE_MODEL=model;window.CONFERENCE_LOAD_INFO=loadInfo;window.CONFERENCE_CONFIG={...pkg,packageBase:base,engineVersion:ENGINE_VERSION,packageSource:loadInfo.source,packageWarnings:loadInfo.warnings||[],posterSession:model.posterSession};window.CONFERENCE_USER_STATE=userState;
    window.CONFERENCE_SERVICES={userStore,calendar,vcard,qr,backup,getPackageDiagnostics:()=>getPackageDiagnostics(base),rollbackConferencePackage:()=>rollbackConferencePackage(base)};
    applyDocument(pkg,model,loadInfo);
    await import('./app.js');
  }catch(err){console.error(err);fail(err?.message||String(err));}
})();

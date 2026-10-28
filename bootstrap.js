import {loadConferencePackage,getPackageDiagnostics,rollbackConferencePackage,resumeConferencePackageUpdates} from './src/package-store.js';
import {createConferenceModel} from './src/model.js';
import {createUserStore} from './src/user-store.js';
import * as calendar from './src/calendar.js';
import * as vcard from './src/vcard.js';
import * as qr from './src/qrcode.js';
import * as backup from './src/backup.js';
import {normalizeWebUrl} from './src/safe-url.js';

const ENGINE_VERSION='1.2.4';
const qs=new URLSearchParams(location.search);
const builderPreview=qs.get('builderPreview')==='1'&&window.parent!==window;
const base=(qs.get('conference')||'./conference').replace(/\/$/,'');
const $=s=>document.querySelector(s);

// Capture Chromium's one-shot install event before conference package loading
// delays the attendee module. The UI consumes this stored event when ready.
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  window.CONFERENCE_INSTALL_PROMPT=event;
  window.dispatchEvent(new CustomEvent('conferenceinstallprompt'));
});

function fail(message){
  const main=document.createElement('main');main.style.cssText='font-family:system-ui;padding:24px;max-width:760px;margin:auto';
  const heading=document.createElement('h1');heading.textContent='Conference app could not start';
  const detail=document.createElement('p');detail.textContent=String(message||'Unknown error').split(/\r?\n/,1)[0].slice(0,500);
  const source=document.createElement('p'),label=document.createTextNode('Conference package: '),code=document.createElement('code');
  code.textContent=String(base).split(/[?#]/,1)[0].slice(0,160)||'default conference';source.append(label,code);main.append(heading,detail,source);document.body.replaceChildren(main);
}
function resolvePackageUrl(value){if(!value)return value;if(builderPreview&&String(value).startsWith('blob:'))return value;const safe=normalizeWebUrl(value,{allowRelative:true});if(!safe)return '';if(/^https:/i.test(safe))return safe;return `${base}/${safe}`;}
function dateMeta(date,locale){const d=new Date(`${date}T12:00:00Z`);return{weekday:new Intl.DateTimeFormat(locale||'en-GB',{weekday:'long',timeZone:'UTC'}).format(d),dateLabel:new Intl.DateTimeFormat(locale||'en-GB',{day:'numeric',month:'long',timeZone:'UTC'}).format(d)};}

function applyDocument(pkg,model,loadInfo){
  const {conference,branding,locations,manifest}=pkg;document.title=conference.name;document.documentElement.lang=conference.language||'en';
  const desc=document.querySelector('meta[name="description"]');if(desc)desc.content=`Conference companion for ${conference.fullName||conference.name}.`;
  const apple=document.querySelector('meta[name="apple-mobile-web-app-title"]');if(apple)apple.content=conference.shortName||conference.name;
  const root=document.documentElement;if(branding.primary)root.style.setProperty('--brand-primary',branding.primary);if(branding.secondary)root.style.setProperty('--brand-secondary',branding.secondary);if(branding.accent||branding.primary)root.style.setProperty('--accent',branding.accent||branding.primary);root.dataset.headerStyle=branding.brandMode||(branding.headerStyle==='logo'?'logo':'combined');root.dataset.logoAlignment=branding.logoAlignment||'left';root.style.setProperty('--conference-logo-size',`${Math.max(24,Math.min(96,Number(branding.logoSize)||36))}px`);root.style.setProperty('--header-bg-light',branding.headerBackgroundLight||'#ffffff');root.style.setProperty('--header-bg-dark',branding.headerBackgroundDark||'#191a1d');root.dataset.headingFont=branding.headingFont||legacyFont(branding.typography);root.dataset.bodyFont=branding.bodyFont||legacyFont(branding.typography);root.dataset.typography=branding.typography||'system';
  const brand=$('.brand-lockup');if(brand)brand.href=normalizeWebUrl(conference.officialWebsite)||'#';
  const fallback=$('.conference-logo-fallback');if(fallback){fallback.hidden=false;fallback.textContent=conference.shortName||conference.name;}
  const logo=$('.conference-logo');if(logo){const source=branding.logoLight||branding.logo||branding.logoDark;if(source){logo.src=resolvePackageUrl(source);logo.alt=conference.name;logo.hidden=false;}else logo.hidden=true;}
  const first=model.days[0],last=model.days.at(-1);const sub=$('.brand-subtitle');if(sub)sub.textContent=`${conference.city||''}${conference.city?' · ':''}${first?.dateLabel||conference.startDate}${last&&last.date!==first?.date?`–${last.dateLabel}`:''}`;
  const posterSessions=model.posterSessions||[],posterSession=posterSessions[0],posterHeading=$('#posterHeadingEyebrow');
  if(posterHeading&&posterSession){
    if(posterSessions.length===1){const dm=dateMeta(posterSession.date,conference.locale);posterHeading.textContent=`${dm.weekday.toUpperCase()} · ${posterSession.start}–${posterSession.end}`;}
    else posterHeading.textContent=`${posterSessions.length} POSTER SESSIONS`;
  }
  const posterVenue=$('#posterHeadingVenue');if(posterVenue&&posterSession)posterVenue.textContent=posterSessions.length===1?((locations.locations||[]).find(x=>x.id===posterSession.locationId)?.name||''):`${new Set(posterSessions.map(x=>x.date)).size} days · ${new Set(posterSessions.map(x=>x.locationId).filter(Boolean)).size} locations`;
  const build=$('.build-version');if(build)build.textContent=`Engine ${ENGINE_VERSION} · data ${manifest.dataVersion} · ${loadInfo.source}`;
  const installTitle=$('#installTitle');if(installTitle)installTitle.textContent=`Install ${conference.shortName||conference.name}`;
}

function legacyFont(value){return value==='serif'?'noto-serif':value==='condensed'?'ibm-plex-sans-condensed':'inter';}

(async()=>{
  try{
    const previewData=builderPreview?await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Builder preview did not receive conference data')),12000);
      const receive=event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='conference-builder-preview')return;window.removeEventListener('message',receive);clearTimeout(timer);resolve(event.data.pkg);};
      window.addEventListener('message',receive);
      window.parent.postMessage({type:'conference-builder-preview-ready'},location.origin);
    }):null;
    const loadInfo=builderPreview?{pkg:previewData,source:'Builder preview',warnings:[],updated:false}:await loadConferencePackage(base,ENGINE_VERSION);const pkg=loadInfo.pkg;
    if(pkg.conference.programmePdf)pkg.conference.programmePdf=resolvePackageUrl(pkg.conference.programmePdf);
    const model=createConferenceModel(pkg),userStore=createUserStore(pkg.conference.id);
    await userStore.ensureReady();
    const userState=await userStore.getState();
    window.CONFERENCE_PACKAGE=pkg;window.CONFERENCE_MODEL=model;window.CONFERENCE_LOAD_INFO=loadInfo;window.CONFERENCE_CONFIG={...pkg,packageBase:base,engineVersion:ENGINE_VERSION,packageSource:loadInfo.source,packageWarnings:loadInfo.warnings||[],rollbackActive:!!loadInfo.rollbackActive,posterSessions:model.posterSessions};window.CONFERENCE_USER_STATE=userState;
    window.CONFERENCE_SERVICES={userStore,calendar,vcard,qr,backup,getPackageDiagnostics:()=>getPackageDiagnostics(base),rollbackConferencePackage:()=>rollbackConferencePackage(base),resumeConferencePackageUpdates:()=>resumeConferencePackageUpdates(base)};
    applyDocument(pkg,model,loadInfo);
    await import('./app.js');
  }catch(err){console.error('Conference Companion startup failed:',err?.name||'Error');fail(err?.message||String(err));}
})();

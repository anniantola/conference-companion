(() => {
  const ENGINE_VERSION = "0.1.0";
  const qs = new URLSearchParams(location.search);
  const base = (qs.get("conference") || "./conference").replace(/\/$/, "");

  const $ = s => document.querySelector(s);
  const fail = message => {
    document.body.innerHTML = `<main style="font-family:system-ui;padding:24px;max-width:760px;margin:auto"><h1>Conference app could not start</h1><p>${message}</p><p><code>${base}</code></p></main>`;
  };
  const fetchJson = async path => {
    const r = await fetch(`${base}/${path}`, {cache:"no-store"});
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const resolvePackageUrl = value => {
    if (!value) return value;
    if (/^(?:[a-z]+:|\/)/i.test(value)) return value;
    return `${base}/${String(value).replace(/^\.\//, "")}`;
  };
  const versionParts = v => String(v||"0").split(".").map(x=>Number(x)||0);
  const versionAtLeast = (have, need) => {
    const a=versionParts(have), b=versionParts(need);
    for(let i=0;i<Math.max(a.length,b.length);i++){ if((a[i]||0)!==(b[i]||0)) return (a[i]||0)>(b[i]||0); }
    return true;
  };
  const dateMeta = (date, locale) => {
    const d = new Date(`${date}T12:00:00Z`);
    return {
      weekday:new Intl.DateTimeFormat(locale||"en-GB",{weekday:"long",timeZone:"UTC"}).format(d),
      dateLabel:new Intl.DateTimeFormat(locale||"en-GB",{day:"numeric",month:"long",timeZone:"UTC"}).format(d)
    };
  };

  function validate(pkg) {
    const errors=[];
    const {conference, programme, people, locations}=pkg;
    if(!conference?.id) errors.push("conference.id is required");
    if(!conference?.timezone) errors.push("conference.timezone is required");
    if(!Array.isArray(programme?.sessions)) errors.push("programme.sessions must be an array");
    if(!Array.isArray(programme?.presentations)) errors.push("programme.presentations must be an array");
    const locIds=new Set((locations.locations||[]).map(x=>x.id));
    const personIds=new Set((people.people||[]).map(x=>x.id));
    const sessionIds=new Set((programme.sessions||[]).map(x=>x.id));
    for(const s of programme.sessions||[]){
      if(!s.id||!s.date||!s.start||!s.end||!s.title) errors.push(`Invalid session ${s.id||"(missing id)"}`);
      if(s.locationId && !locIds.has(s.locationId)) errors.push(`Unknown location ${s.locationId} in ${s.id}`);
      for(const id of s.chairIds||[]) if(!personIds.has(id)) errors.push(`Unknown chair ${id} in ${s.id}`);
    }
    for(const p of programme.presentations||[]){
      if(!sessionIds.has(p.sessionId)) errors.push(`Unknown session ${p.sessionId} in ${p.id}`);
      for(const id of p.speakerIds||[]) if(!personIds.has(id)) errors.push(`Unknown speaker ${id} in ${p.id}`);
    }
    return errors;
  }

  function buildLegacy(pkg) {
    const {conference, programme, people, locations}=pkg;
    const personById=new Map((people.people||[]).map(x=>[x.id,x]));
    const locationById=new Map((locations.locations||[]).map(x=>[x.id,x]));
    const trackOrder=new Map((programme.tracks||[]).map((x,i)=>[x.id,Number.isFinite(x.order)?x.order:i]));
    const presentationById=new Map((programme.presentations||[]).map(x=>[x.id,x]));
    const dates=[...new Set((programme.sessions||[]).map(s=>s.date))].sort();
    const days=dates.map((date,i)=>({label:`Day ${i+1}`,date,day:i+1,...dateMeta(date,conference.locale)}));
    const dayByDate=new Map(days.map(x=>[x.date,x]));
    const schedule=[];
    for(const s of programme.sessions||[]){
      const d=dayByDate.get(s.date);
      const roomLoc=locationById.get(s.locationId);
      const roomId=roomLoc?.type==="room" ? roomLoc.id : "";
      const chair=(s.chairIds||[]).map(id=>personById.get(id)?.name).filter(Boolean).join(", ");
      const base={label:d?.label||"",date:s.date,weekday:d?.weekday||"",dateLabel:d?.dateLabel||"",day:d?.day||1,
        sourcePage:s.sourcePage||null,track:trackOrder.get(s.trackId)||0,trackId:s.trackId||"common",room:roomId,
        roomLabel:roomLoc?.type==="room"?roomLoc.name:"",locationId:s.locationId||null,session:s.title,chair};
      if((s.presentationIds||[]).length){
        for(const pid of s.presentationIds){
          const p=presentationById.get(pid); if(!p) continue;
          const speakers=(p.speakerIds||[]).map(id=>personById.get(id)).filter(Boolean);
          schedule.push({...base,id:p.id,start:p.start||s.start,end:p.end||s.end,title:p.title,
            speaker:speakers.map(x=>x.name).join(", "),affiliation:speakers.flatMap(x=>x.affiliations||[]).filter(Boolean).join("; "),
            kind:p.type||"talk",sourcePage:p.sourcePage||s.sourcePage||null});
        }
      } else {
        schedule.push({...base,id:s.id,start:s.start,end:s.end,title:s.title,speaker:"",affiliation:"",kind:s.type||"special"});
      }
    }
    schedule.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.track-b.track);

    const posterSession=(programme.sessions||[]).find(x=>x.type==="poster-session")||null;
    const posters=(programme.posters||[]).map(p=>{
      const authors=(p.authorIds||[]).map(id=>personById.get(id)).filter(Boolean);
      return {...p,author:authors.map(x=>x.name).join(", "),affiliation:authors.flatMap(x=>x.affiliations||[]).filter(Boolean).join("; ")};
    });
    return {days,schedule,posters,posterSession};
  }

  function applyDocument(pkg, legacy) {
    const {conference, branding, locations, programme, manifest}=pkg;
    document.title=conference.name;
    document.documentElement.lang=conference.language||"en";
    const metaDesc=document.querySelector('meta[name="description"]');
    if(metaDesc) metaDesc.content=`Conference companion for ${conference.fullName||conference.name}.`;
    const apple=document.querySelector('meta[name="apple-mobile-web-app-title"]'); if(apple) apple.content=conference.shortName||conference.name;
    const root=document.documentElement;
    if(branding.primary) root.style.setProperty("--accent",branding.primary);
    if(branding.secondary) root.style.setProperty("--secondary",branding.secondary);

    const brand=$('.brand-lockup'); if(brand) brand.href=conference.officialWebsite||"#";
    const fallback=$('.conference-logo-fallback'); if(fallback){fallback.hidden=false;fallback.textContent=conference.shortName||conference.name;}
    const logo=$('.conference-logo');
    if(logo && branding.logo){logo.src=`${base}/${branding.logo}`;logo.alt=conference.name;logo.hidden=false;} else if(logo){logo.hidden=true;}
    const sub=$('.brand-subtitle'); if(sub) sub.textContent=`${conference.city||""}${conference.city?" · ":""}${legacy.days[0]?.dateLabel||conference.startDate}–${legacy.days.at(-1)?.dateLabel||conference.endDate}`;

    const posterSession=legacy.posterSession;
    const posterHeading=$('#posterHeadingEyebrow');
    if(posterHeading && posterSession){ const dm=dateMeta(posterSession.date,conference.locale); posterHeading.textContent=`${dm.weekday.toUpperCase()} · ${posterSession.start}–${posterSession.end}`; }
    const posterVenue=$('#posterHeadingVenue');
    if(posterVenue && posterSession){ posterVenue.textContent=(locations.locations||[]).find(x=>x.id===posterSession.locationId)?.name||""; }

    const build=$('.build-version'); if(build) build.textContent=`Engine ${ENGINE_VERSION} · data ${manifest.dataVersion}`;
    const installTitle=$('#installTitle'); if(installTitle) installTitle.textContent=`Install ${conference.shortName||conference.name}`;
  }

  (async()=>{
    try{
      const manifest=await fetchJson('conference-manifest.json');
      if(!versionAtLeast(ENGINE_VERSION,manifest.minimumEngineVersion)) throw new Error(`This conference requires app engine ${manifest.minimumEngineVersion} or newer.`);
      const [conference,programme,people,locations,branding]=await Promise.all([
        fetchJson('conference.json'),fetchJson('programme.json'),fetchJson('people.json'),fetchJson('locations.json'),fetchJson('branding.json')
      ]);
      if (conference.programmePdf) conference.programmePdf = resolvePackageUrl(conference.programmePdf);
      const pkg={manifest,conference,programme,people,locations,branding};
      const errors=validate(pkg); if(errors.length) throw new Error(errors.join('; '));
      const legacy=buildLegacy(pkg);
      window.CONFERENCE_PACKAGE=pkg;
      window.CONFERENCE_CONFIG={...pkg,packageBase:base,engineVersion:ENGINE_VERSION,posterSession:legacy.posterSession};
      window.CONFERENCE_DATA={days:legacy.days,schedule:legacy.schedule,posters:legacy.posters};
      applyDocument(pkg,legacy);
      const script=document.createElement('script'); script.src='./app.js'; script.defer=true; document.body.appendChild(script);
    }catch(err){console.error(err);fail(err.message||String(err));}
  })();
})();

function dateMeta(date, locale) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(locale || "en-GB", {weekday:"long", timeZone:"UTC"}).format(d),
    dateLabel: new Intl.DateTimeFormat(locale || "en-GB", {day:"numeric", month:"long", timeZone:"UTC"}).format(d)
  };
}

export function createConferenceModel(pkg) {
  const {conference, programme, people, locations} = pkg;
  const personById = new Map((people.people || []).map(x => [x.id, x]));
  const locationById = new Map((locations.locations || []).map(x => [x.id, x]));
  const sessionById = new Map((programme.sessions || []).map(x => [x.id, x]));
  const presentationById = new Map((programme.presentations || []).map(x => [x.id, x]));
  const posterByIdRaw = new Map((programme.posters || []).map(x => [x.id, x]));
  const trackById = new Map((programme.tracks || []).map(x => [x.id, x]));
  const trackOrder = new Map((programme.tracks || []).map((x, i) => [x.id, Number.isFinite(x.order) ? x.order : i]));

  const dates = [...new Set((programme.sessions || []).map(s => s.date))].sort();
  const days = dates.map((date, i) => ({label:`Day ${i+1}`, date, day:i+1, ...dateMeta(date, conference.locale)}));
  const dayByDate = new Map(days.map(x => [x.date, x]));

  const items = [];
  for (const session of programme.sessions || []) {
    const day = dayByDate.get(session.date);
    const chairs = (session.chairIds || []).map(id => personById.get(id)).filter(Boolean);
    const base = {
      date:session.date,
      day:day?.day || 1,
      label:day?.label || "",
      weekday:day?.weekday || "",
      dateLabel:day?.dateLabel || "",
      sessionId:session.id,
      session:session.title,
      sessionType:session.type,
      locationId:session.locationId || null,
      trackId:session.trackId || "common",
      track:trackOrder.get(session.trackId) ?? 0,
      trackName:trackById.get(session.trackId)?.name || "",
      chair:chairs.map(x => x.name).join(", ")
    };
    if ((session.presentationIds || []).length) {
      for (const pid of session.presentationIds) {
        const p = presentationById.get(pid);
        if (!p) continue;
        const speakers = (p.speakerIds || []).map(id => personById.get(id)).filter(Boolean);
        items.push({
          ...base,
          id:p.id,
          entityType:"presentation",
          presentationId:p.id,
          start:p.start || session.start,
          end:p.end || session.end,
          title:p.title,
          kind:p.type || "talk",
          speakerIds:p.speakerIds || [],
          speakers,
          speaker:speakers.map(x => x.name).join(", "),
          affiliation:speakers.flatMap(x => x.affiliations || []).filter(Boolean).join("; "),
          abstract:p.abstract || "",
          keywords:p.keywords || [],
          links:p.links || [],
          calendarUid:p.calendarUid, sequence:p.sequence, status:p.status,
          sourcePage:p.sourcePage || session.sourcePage || null,
          raw:p,
          rawSession:session
        });
      }
    } else {
      items.push({
        ...base,
        id:session.id,
        entityType:"session",
        start:session.start,
        end:session.end,
        title:session.title,
        kind:session.type || "special",
        speakerIds:[], speakers:[], speaker:"", affiliation:"", abstract:session.description || "",
        keywords:session.keywords || [], links:session.links || [], calendarUid:session.calendarUid, sequence:session.sequence, status:session.status,
        sourcePage:session.sourcePage || null, raw:session, rawSession:session
      });
    }
  }
  items.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.track-b.track||a.title.localeCompare(b.title));
  const itemById = new Map(items.map(x => [x.id, x]));

  const posterSessions = (programme.sessions || []).filter(x => x.type === "poster-session")
    .sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.title.localeCompare(b.title));
  const posterSession = posterSessions[0] || null;
  const posters = (programme.posters || []).map(p => {
    const authors = (p.authorIds || []).map(id => personById.get(id)).filter(Boolean);
    const session = sessionById.get(p.posterSessionId) || null;
    return {
      ...p,
      raw:p,
      author:authors.map(x => x.name).join(", "),
      authors,
      affiliation:authors.flatMap(x => x.affiliations || []).filter(Boolean).join("; "),
      posterSession:session || null
    };
  }).sort((a,b)=>{
    const sa=a.posterSession,sb=b.posterSession;
    return `${sa?.date||'9999-12-31'}|${sa?.start||'23:59'}|${String(a.number||'')}`.localeCompare(`${sb?.date||'9999-12-31'}|${sb?.start||'23:59'}|${String(b.number||'')}`,undefined,{numeric:true});
  });
  const posterById = new Map(posters.map(x => [x.id, x]));

  return {
    conference, programme, people, locations,
    days, items, posters, posterSessions, posterSession,
    personById, locationById, sessionById, presentationById, posterById, posterByIdRaw, trackById, itemById,
    location(id) { return id ? locationById.get(id) || null : null; },
    person(id) { return id ? personById.get(id) || null : null; },
    session(id) { return id ? sessionById.get(id) || null : null; },
    presentation(id) { return id ? presentationById.get(id) || null : null; },
    item(id) { return id ? itemById.get(id) || null : null; },
    poster(id) { return id ? posterById.get(id) || null : null; },
    calendarItems() { return items.filter(x => x.calendarUid); }
  };
}

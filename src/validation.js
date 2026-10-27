const SESSION_TYPES = new Set(["session","break","meal","social","poster-session","registration","special"]);
import {validatePackageUrls} from './safe-url.js';

function minutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!m) return NaN;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}

function validDate(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
  const parsed=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10)===value;
}

function uniqueIds(rows, label, errors) {
  const seen = new Set();
  for (const row of rows || []) {
    if (!row?.id) errors.push(`${label}: missing id`);
    else if (seen.has(row.id)) errors.push(`${label}: duplicate id ${row.id}`);
    else seen.add(row.id);
  }
  return seen;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function validatePackage(pkg, {strictCalendarUid = true, policy = {}} = {}) {
  const errors = [], warnings = [];
  const {manifest = {}, conference = {}, programme = {}, people = {}, locations = {}, branding = {}} = pkg || {};
  errors.push(...validatePackageUrls(pkg || {}));

  if (!conference.id) errors.push("conference.id is required");
  if (!conference.name) errors.push("conference.name is required");
  if (!conference.timezone) errors.push("conference.timezone is required");
  else {
    try { new Intl.DateTimeFormat("en", {timeZone: conference.timezone}).format(); }
    catch { errors.push(`Invalid IANA timezone: ${conference.timezone}`); }
  }
  if (!validDate(conference.startDate)) errors.push("conference.startDate must be YYYY-MM-DD");
  if (!validDate(conference.endDate)) errors.push("conference.endDate must be YYYY-MM-DD");
  if (validDate(conference.startDate) && validDate(conference.endDate) && conference.endDate < conference.startDate) {
    errors.push("conference.endDate cannot be before startDate");
  }

  const sessions = Array.isArray(programme.sessions) ? programme.sessions : [];
  const presentations = Array.isArray(programme.presentations) ? programme.presentations : [];
  const posters = Array.isArray(programme.posters) ? programme.posters : [];
  const tracks = Array.isArray(programme.tracks) ? programme.tracks : [];
  const announcements = Array.isArray(programme.announcements) ? programme.announcements : [];
  const persons = Array.isArray(people.people) ? people.people : [];
  const locationRows = Array.isArray(locations.locations) ? locations.locations : [];

  if (!Array.isArray(programme.sessions)) errors.push("programme.sessions must be an array");
  if (!Array.isArray(programme.presentations)) errors.push("programme.presentations must be an array");
  if (!Array.isArray(programme.posters)) errors.push("programme.posters must be an array");
  if (!Array.isArray(programme.tracks)) errors.push("programme.tracks must be an array");
  if (!Array.isArray(programme.announcements)) errors.push("programme.announcements must be an array");

  const sessionIds = uniqueIds(sessions, "sessions", errors);
  const presentationIds = uniqueIds(presentations, "presentations", errors);
  uniqueIds(posters, "posters", errors);
  const trackIds = uniqueIds(tracks, "tracks", errors);
  uniqueIds(announcements, "announcements", errors);
  const personIds = uniqueIds(persons, "people", errors);
  const locationIds = uniqueIds(locationRows, "locations", errors);

  const globalIds=new Map();
  for(const [label,rows] of [['tracks',tracks],['sessions',sessions],['presentations',presentations],['posters',posters],['announcements',announcements],['people',persons],['locations',locationRows]])for(const row of rows||[]){
    if(!row?.id)continue;
    const previous=globalIds.get(row.id);if(previous)errors.push(`duplicate ID ${row.id} across ${previous} and ${label}`);else globalIds.set(row.id,label);
  }
  if(conference.mainVenueId&&!locationIds.has(conference.mainVenueId))errors.push(`conference.mainVenueId references unknown location ${conference.mainVenueId}`);

  const presentationById = new Map(presentations.map(p => [p.id, p]));
  const sessionById = new Map(sessions.map(s => [s.id, s]));
  const calendarUids = new Set();

  const registerUid = (uid, label) => {
    if (!uid) {
      if (strictCalendarUid) errors.push(`${label}: calendarUid is required`);
      else warnings.push(`${label}: calendarUid missing`);
      return;
    }
    if (calendarUids.has(uid)) errors.push(`${label}: duplicate calendarUid ${uid}`);
    calendarUids.add(uid);
  };

  for (const s of sessions) {
    if (!s.title) errors.push(`session ${s.id || "(missing id)"}: title required`);
    if (!validDate(s.date)) errors.push(`session ${s.id}: invalid date`);
    const sm = minutes(s.start), em = minutes(s.end);
    if (!Number.isFinite(sm) || !Number.isFinite(em) || em <= sm) errors.push(`session ${s.id}: invalid start/end`);
    if (!s.type) errors.push(`session ${s.id}: type required`);
    else if (!SESSION_TYPES.has(s.type)) warnings.push(`session ${s.id}: unknown type ${s.type}`);
    if (s.date && conference.startDate && conference.endDate && (s.date < conference.startDate || s.date > conference.endDate)) {
      errors.push(`session ${s.id}: date outside conference range`);
    }
    if (s.locationId && !locationIds.has(s.locationId)) errors.push(`session ${s.id}: unknown location ${s.locationId}`);
    if (s.trackId && !trackIds.has(s.trackId)) errors.push(`session ${s.id}: unknown track ${s.trackId}`);
    const duration=Number.isFinite(sm)&&Number.isFinite(em)?em-sm:NaN;
    if (Number.isFinite(duration) && (duration < 5 || duration > 360)) warnings.push(`session ${s.id}: suspicious duration ${duration} min`);
    if (s.type === 'social' && !s.locationId) warnings.push(`session ${s.id}: social event has no location`);
    if (policy.requireChair && s.type === 'session' && !(s.chairIds || []).length) warnings.push(`session ${s.id}: chair required by policy`);
    for (const id of s.chairIds || []) if (!personIds.has(id)) errors.push(`session ${s.id}: unknown chair ${id}`);
    for (const id of s.presentationIds || []) {
      if (!presentationIds.has(id)) errors.push(`session ${s.id}: unknown presentation ${id}`);
      const p = presentationById.get(id);
      if (p && p.sessionId !== s.id) errors.push(`presentation ${id}: sessionId does not match parent session ${s.id}`);
    }
    if(new Set(s.presentationIds||[]).size!==(s.presentationIds||[]).length)errors.push(`session ${s.id}: duplicate presentationIds`);
    if (!(s.presentationIds || []).length) registerUid(s.calendarUid, `session ${s.id}`);
  }

  for (const p of presentations) {
    if (!p.title) errors.push(`presentation ${p.id}: title required`);
    if (!p.sessionId || !sessionIds.has(p.sessionId)) errors.push(`presentation ${p.id}: valid sessionId required`);
    const session = sessionById.get(p.sessionId);
    const pm = minutes(p.start || session?.start), pe = minutes(p.end || session?.end);
    if (!Number.isFinite(pm) || !Number.isFinite(pe) || pe <= pm) errors.push(`presentation ${p.id}: invalid start/end`);
    if (session && !(session.presentationIds || []).includes(p.id)) errors.push(`presentation ${p.id}: missing from parent presentationIds`);
    if (session) {
      const sm = minutes(session.start), se = minutes(session.end);
      if (Number.isFinite(pm) && Number.isFinite(pe) && Number.isFinite(sm) && Number.isFinite(se) && (pm < sm || pe > se)) {
        errors.push(`presentation ${p.id}: outside parent-session interval`);
      }
    }
    for (const id of p.speakerIds || []) if (!personIds.has(id)) errors.push(`presentation ${p.id}: unknown speaker ${id}`);
    if (policy.requireAbstract && !String(p.abstract || '').trim()) warnings.push(`presentation ${p.id}: abstract required by policy`);
    if (policy.requireAffiliation && (p.speakerIds || []).length) {
      const missing=(p.speakerIds || []).filter(id => !(persons.find(x=>x.id===id)?.affiliations || []).filter(Boolean).length);
      if (missing.length) warnings.push(`presentation ${p.id}: speaker affiliation required by policy`);
    }
    registerUid(p.calendarUid, `presentation ${p.id}`);
  }

  for (const p of posters) {
    if (!p.title) errors.push(`poster ${p.id}: title required`);
    if (!p.posterSessionId) errors.push(`poster ${p.id}: posterSessionId required`);
    else if (!sessionIds.has(p.posterSessionId)) errors.push(`poster ${p.id}: unknown posterSessionId ${p.posterSessionId}`);
    if (p.posterSessionId && sessionById.get(p.posterSessionId) && sessionById.get(p.posterSessionId).type !== 'poster-session') errors.push(`poster ${p.id}: parent must be a poster-session`);
    for (const id of p.authorIds || []) if (!personIds.has(id)) errors.push(`poster ${p.id}: unknown author ${id}`);
    if (p.calendarUid) registerUid(p.calendarUid, `poster ${p.id}`);
  }

  const affectedEntityIds = new Set([...sessionIds, ...presentationIds, ...posters.map(x=>x.id).filter(Boolean)]);
  for (const a of announcements) {
    if (!String(a.message || "").trim()) errors.push(`announcement ${a.id || "(missing id)"}: message required`);
    if (!a.timestamp || Number.isNaN(Date.parse(a.timestamp))) errors.push(`announcement ${a.id || "(missing id)"}: valid timestamp required`);
    for (const id of a.affectedIds || []) if (!affectedEntityIds.has(id)) errors.push(`announcement ${a.id}: unknown affected entity ${id}`);
  }

  for (const loc of locationRows) {
    if (!loc.name) errors.push(`location ${loc.id}: name required`);
    if (loc.parentLocationId && !locationIds.has(loc.parentLocationId)) errors.push(`location ${loc.id}: unknown parent ${loc.parentLocationId}`);
  }

  for (const loc of locationRows) {
    const visited=new Set([loc.id]);let parent=loc.parentLocationId;
    while(parent&&locationIds.has(parent)){
      if(visited.has(parent)){errors.push(`location ${loc.id}: cyclic parent hierarchy`);break;}
      visited.add(parent);parent=locationRows.find(x=>x.id===parent)?.parentLocationId;
    }
  }

  // Structural conflict warnings.
  for (let i = 0; i < sessions.length; i++) {
    const a = sessions[i];
    const as = minutes(a.start), ae = minutes(a.end);
    if (!Number.isFinite(as) || !Number.isFinite(ae)) continue;
    for (let j = i + 1; j < sessions.length; j++) {
      const b = sessions[j];
      if (a.date !== b.date) continue;
      const bs = minutes(b.start), be = minutes(b.end);
      if (!Number.isFinite(bs) || !Number.isFinite(be) || !overlaps(as, ae, bs, be)) continue;
      // A venue groups its rooms; concurrent events in the same venue are
      // expected. Only an explicitly assigned room is an exclusive resource.
      const room=locationRows.find(loc=>loc.id===a.locationId);
      const sharedPosterWindow=a.type==='poster-session'&&b.type==='poster-session'&&a.start===b.start&&a.end===b.end;
      if (a.id!==b.id && room?.type==='room' && a.locationId === b.locationId && !sharedPosterWindow) warnings.push(`Location overlap: ${a.id} and ${b.id} at ${a.locationId}`);
      const sharedChair = (a.chairIds || []).find(id => (b.chairIds || []).includes(id));
      if (sharedChair) warnings.push(`Chair overlap: ${sharedChair} in ${a.id} and ${b.id}`);
    }
  }

  for (let i = 0; i < presentations.length; i++) {
    const a = presentations[i], sa = sessionById.get(a.sessionId);
    if (!sa) continue;
    const as = minutes(a.start || sa.start), ae = minutes(a.end || sa.end);
    for (let j = i + 1; j < presentations.length; j++) {
      const b = presentations[j], sb = sessionById.get(b.sessionId);
      if (!sb || sa.date !== sb.date) continue;
      const bs = minutes(b.start || sb.start), be = minutes(b.end || sb.end);
      if (!overlaps(as, ae, bs, be)) continue;
      const sharedSpeaker = (a.speakerIds || []).find(id => (b.speakerIds || []).includes(id));
      if (sharedSpeaker) warnings.push(`Speaker overlap: ${sharedSpeaker} in ${a.id} and ${b.id}`);
    }
  }

  if (manifest.schemaVersion == null) errors.push("conference-manifest.schemaVersion is required");
  if (manifest.dataVersion == null) errors.push("conference-manifest.dataVersion is required");
  if (!manifest.minimumEngineVersion) errors.push("conference-manifest.minimumEngineVersion is required");
  if (!manifest.publishedAt) errors.push("conference-manifest.publishedAt is required");
  if (!manifest.checksums || typeof manifest.checksums !== "object") errors.push("conference-manifest.checksums is required");

  if (branding.locationColors && typeof branding.locationColors !== "object") errors.push("branding.locationColors must be an object");
  if (branding.trackColors && typeof branding.trackColors !== "object") errors.push("branding.trackColors must be an object");

  return {errors, warnings};
}

export function timeToMinutes(value) { return minutes(value); }

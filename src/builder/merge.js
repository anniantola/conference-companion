/** Reconcile imported rows without allowing row position to define identity. */
export const PROGRAMME_FIELDS = [
  'date','start','end','type','session','title','speaker','chair','affiliation',
  'location','track','posterNumber','abstract','doi'
];
const CALENDAR_FIELDS = new Set(['date','start','end','title','location','session']);

const clean = value => String(value ?? '').trim().toLocaleLowerCase();
const originalValue = (row, field) => row?.source?.matchData?.[field] ?? row?.source?.raw?.[field] ?? row?.[field] ?? '';
function scoreMatch(old, incoming) {
  const oldFile=String(old?.source?.fileId||''),newFile=String(incoming?.source?.fileId||'');
  if(oldFile!==newFile)return 0;
  const oldSheet=String(old?.source?.sheet||''),newSheet=String(incoming?.source?.sheet||'');
  if(oldSheet!==newSheet)return 0;
  const oldRaw=old?.source?.matchData||old?.source?.raw||old, newRaw=incoming?.source?.matchData||incoming?.source?.raw||incoming;
  const a={...old,...oldRaw}, b={...incoming,...newRaw};
  // Explicit IDs are handled separately. For ordinary sheets require a title
  // and corroboration from schedule/context fields; source row is never scored.
  const title=clean(a.title), sameTitle=!!title&&title===clean(b.title);
  const sameSpeaker=clean(a.speaker)===clean(b.speaker)&&!!clean(a.speaker);
  const poster=clean(a.type)==='poster'||clean(b.type)==='poster';
  const posterNumber=clean(a.posterNumber),samePosterNumber=!!posterNumber&&posterNumber===clean(b.posterNumber);
  const fields=['date','start','end','session','location','track','speaker','type'];
  const equal=fields.filter(k=>clean(a[k])&&clean(a[k])===clean(b[k])).length;
  if(poster){
    const context=['date','session','location','track'];
    const contextEqual=context.filter(k=>clean(a[k])&&clean(a[k])===clean(b[k])).length;
    const sessionContext=clean(a.date)&&clean(a.date)===clean(b.date)&&clean(a.session)&&clean(a.session)===clean(b.session)&&
      ((clean(a.location)&&clean(a.location)===clean(b.location))||(clean(a.track)&&clean(a.track)===clean(b.track)));
    return samePosterNumber&&sessionContext?120+contextEqual:0;
  }
  if(sameTitle&&equal>=2)return 100+equal;
  // A renamed title can still match when its full time, session and speaker
  // context agree. This is deliberately stricter than row-number equality.
  const context=['date','start','end','session','location','track'];
  const contextEqual=context.filter(k=>clean(a[k])&&clean(a[k])===clean(b[k])).length;
  if(sameSpeaker&&contextEqual>=4)return 70+contextEqual;
  return 0;
}

export function mergeImportedRows(existingRows, incomingRows, deletedSourceIds = []) {
  const originalRows = [...(existingRows || [])];
  const rows = [...originalRows];
  const existingSourceIds = new Set();
  for (let i=0; i<originalRows.length; i++) {
    const id=originalRows[i]?.source?.id;
    if (id) {
      if (existingSourceIds.has(id)) throw new Error(`Existing programme has duplicate source ID: ${id}`);
      existingSourceIds.add(id);
    }
  }
  const deleted = new Set(deletedSourceIds);
  const seenIncoming = new Set();
  const conflicts = [];
  const matched = new Set();
  const matchedRows = new Set();
  const incomingList = [...(incomingRows || [])];
  const entityCounts=new Map();for(const row of incomingList)if(row?.entityId)entityCounts.set(row.entityId,(entityCounts.get(row.entityId)||0)+1);
  const incomingScopes = new Set();
  for (const incoming of incomingList) {
    const sid=incoming?.source?.id;
    if (!sid) throw new Error('Imported row is missing its source ID');
    if (seenIncoming.has(sid)) throw new Error(`Import contains duplicate source ID: ${sid}`);
    seenIncoming.add(sid);
    if (incoming.source.fileId) incomingScopes.add(JSON.stringify([incoming.source.fileId,incoming.source.sheet||'']));
    if (deleted.has(sid)) continue;  // Respect explicit deletions in the review UI.
    if(incoming.entityId&&entityCounts.get(incoming.entityId)>1){conflicts.push(`${sid}: duplicated immutable entity ID ${incoming.entityId}; retained for organizer review`);rows.push(incoming);continue;}
    let i;
    // Structured imports carry immutable entity IDs. Match those across source
    // files before considering spreadsheet content.
    if(incoming.entityId){
      const explicit=originalRows.map((r,index)=>({r,index})).filter(x=>x.r.entityId===incoming.entityId&&!matchedRows.has(x.index));
      if(explicit.length===1)i=explicit[0].index;
      else if(explicit.length>1){conflicts.push(`${sid}: ambiguous immutable entity ID ${incoming.entityId}; retained for organizer review`);rows.push(incoming);continue;}
    }
    if(i===undefined){
      const candidates=originalRows.map((r,index)=>({r,index,score:scoreMatch(r,incoming)})).filter(x=>x.score>0&&!matchedRows.has(x.index));
      candidates.sort((a,b)=>b.score-a.score);
      if(candidates.length&&(!candidates[1]||candidates[0].score>candidates[1].score))i=candidates[0].index;
      else if(candidates.length){
        conflicts.push(`${sid}: ambiguous presentation match (${candidates.length} candidates); retained for organizer review`);
        rows.push(incoming);continue;
      }
    }
    if(i===undefined){
      const sameSourceIndex=originalRows.findIndex(row=>row?.source?.id===sid);
      if(sameSourceIndex>=0&&!matchedRows.has(sameSourceIndex))conflicts.push(`${sid}: source row content is not a safe identity match; existing and incoming records retained for review`);
      rows.push(incoming); continue;
    }
    const old=rows[i];
    matched.add(sid);
    if(old?.source?.id)matched.add(old.source.id);
    matchedRows.add(i);
    const merged={
      ...incoming, id:old.id||incoming.id,
      manualFields:{...(old.manualFields||{})},
      calendarUid:old.calendarUid||incoming.calendarUid,
      sequence:Number(old.sequence||0),
      entityId:incoming.entityId||old.entityId,
      sessionId:incoming.source?.id?.includes(':package:')?(incoming.sessionId||old.sessionId):(old.sessionId||incoming.sessionId),
      posterSessionId:incoming.source?.id?.includes(':package:')?(incoming.posterSessionId||old.posterSessionId):(old.posterSessionId||incoming.posterSessionId),
      posterSessionCalendarUid:old.posterSessionCalendarUid||incoming.posterSessionCalendarUid,
      locationEntityId:old.locationEntityId||incoming.locationEntityId,
      trackEntityId:old.trackEntityId||incoming.trackEntityId,
      speakerEntityIds:[...(incoming.speakerEntityIds?.length?incoming.speakerEntityIds:(old.speakerEntityIds||[]))],
      chairEntityIds:[...(incoming.chairEntityIds?.length?incoming.chairEntityIds:(old.chairEntityIds||[]))]
    };
    let calendarChanged=false;
    for (const field of PROGRAMME_FIELDS) {
      if (old.manualFields?.[field]) {
        if (String(incoming[field]??'')!==String(old[field]??''))
          conflicts.push(`${sid}: source changed ${field}; preserved organizer edit`);
        merged[field]=old[field];
      } else if (CALENDAR_FIELDS.has(field) && String(incoming[field]??'')!==String(old[field]??'')) {
        calendarChanged=true;
      }
    }
    if (calendarChanged) merged.sequence=Number(old.sequence||0)+1;
    rows[i]=merged;
  }
  // Never silently discard older imports or manual additions. Highlight stale rows
  // from the file currently being re-imported so the organizer can remove them.
  for (const old of originalRows) {
    const id=old?.source?.id;
    if (id && !matched.has(id) && !seenIncoming.has(id) && incomingScopes.has(JSON.stringify([old.source?.fileId,old.source?.sheet||''])))
      conflicts.push(`${id}: missing from new import; retained for manual review`);
  }
  return {rows,conflicts};
}

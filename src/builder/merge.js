/** Preserve independent imports and organizer edits while reconciling matching source rows.
 * Source ids are (file id, worksheet, source row), not content-based row indices.
 * Rows that disappear from a re-import remain visible for manual review rather than
 * being silently deleted, because a changed sheet layout can shift source row numbers.
 */
export const PROGRAMME_FIELDS = [
  'date','start','end','type','session','title','speaker','chair','affiliation',
  'location','track','posterNumber','abstract','doi'
];
const CALENDAR_FIELDS = new Set(['date','start','end','title','location','session']);

export function mergeImportedRows(existingRows, incomingRows, deletedSourceIds = []) {
  const rows = [...(existingRows || [])];
  const bySource = new Map();
  for (let i=0; i<rows.length; i++) {
    const id=rows[i]?.source?.id;
    if (id) {
      if (bySource.has(id)) throw new Error(`Existing programme has duplicate source ID: ${id}`);
      bySource.set(id,i);
    }
  }
  const deleted = new Set(deletedSourceIds);
  const seenIncoming = new Set();
  const conflicts = [];
  const matched = new Set();
  const incomingScopes = new Set();
  for (const incoming of incomingRows || []) {
    const sid=incoming?.source?.id;
    if (!sid) throw new Error('Imported row is missing its source ID');
    if (seenIncoming.has(sid)) throw new Error(`Import contains duplicate source ID: ${sid}`);
    seenIncoming.add(sid);
    if (incoming.source.fileId) incomingScopes.add(JSON.stringify([incoming.source.fileId,incoming.source.sheet||'']));
    if (deleted.has(sid)) continue;  // Respect explicit deletions in the review UI.
    const i=bySource.get(sid);
    if (i===undefined) { bySource.set(sid, rows.length); rows.push(incoming); continue; }
    const old=rows[i];
    matched.add(sid);
    const merged={
      ...incoming, id:old.id||incoming.id,
      manualFields:{...(old.manualFields||{})},
      calendarUid:old.calendarUid||incoming.calendarUid,
      sequence:Number(old.sequence||0),
      entityId:old.entityId||incoming.entityId,
      sessionId:old.sessionId||incoming.sessionId,
      posterSessionId:old.posterSessionId||incoming.posterSessionId,
      posterSessionCalendarUid:old.posterSessionCalendarUid||incoming.posterSessionCalendarUid,
      locationEntityId:old.locationEntityId||incoming.locationEntityId,
      trackEntityId:old.trackEntityId||incoming.trackEntityId,
      speakerEntityIds:[...(old.speakerEntityIds||incoming.speakerEntityIds||[])],
      chairEntityIds:[...(old.chairEntityIds||incoming.chairEntityIds||[])]
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
  for (const old of existingRows || []) {
    const id=old?.source?.id;
    if (id && !matched.has(id) && !seenIncoming.has(id) && incomingScopes.has(JSON.stringify([old.source?.fileId,old.source?.sheet||''])))
      conflicts.push(`${id}: missing from new import; retained for manual review`);
  }
  return {rows,conflicts};
}

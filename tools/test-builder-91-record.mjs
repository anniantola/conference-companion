import assert from 'node:assert/strict';
import {parseCSV,guessMapping,rowsFromMapping} from '../src/builder/importers.js';
import {mergeImportedRows} from '../src/builder/merge.js';
import {createSynthetic91Records,synthetic91Headers,synthetic91Csv} from './synthetic-91-csv.js';
const records=createSynthetic91Records();
assert.equal(records.length,91);

function importCsvRows(rows){
  const raw=parseCSV(synthetic91Csv(rows)).map(row=>({...row,__sourceFileId:'synthetic-91-records'}));
  return rowsFromMapping(raw,guessMapping(synthetic91Headers));
}

const incoming=importCsvRows(records);
assert.equal(incoming.length,91,'CSV mapping should retain every source record');
const first=mergeImportedRows([],incoming);
assert.equal(first.rows.length,91,'Batch rows must never match rows appended earlier in the same import');
assert.equal(first.rows.filter(row=>row.type==='poster').length,18,'All 18 shared-slot posters must survive');
assert.equal(first.rows.filter(row=>row.title==='Coffee break').length,10,'Repeated break records remain separate');
assert.equal(first.rows.filter(row=>row.date==='2031-06-10'&&row.start==='09:00'&&row.end==='09:20').length,4,
  'Four simultaneous talks in parallel tracks remain separate');
assert.equal(first.rows.filter(row=>row.date==='2031-06-11'&&row.start==='14:00'&&row.end==='16:00'&&row.location==='Poster Hall').length,18,
  'Identical poster-session time/location does not make different titles identical');

// A revised, reordered source file updates existing entities while preserving IDs,
// calendar UIDs and manual edits. A source title correction can be linked by its
// unchanged presenter and full schedule context.
const talk=first.rows.find(row=>row.title==='Synthetic talk 01');
talk.manualFields={title:true};talk.title='Organizer-corrected title';talk.id='stable-talk-01';talk.entityId='presentation-stable-talk-01';talk.calendarUid='urn:stable-talk-01';talk.sequence=3;
const poster=first.rows.find(row=>row.title==='Synthetic poster 01');
poster.id='stable-poster-01';poster.entityId='poster-stable-01';poster.calendarUid='urn:stable-poster-01';poster.sequence=2;
const revised=records.map(row=>({...row}));
const revisedPoster=revised.find(row=>row.title==='Synthetic poster 01');revisedPoster.title='Revised synthetic poster 01';
const revisedTalk=revised.find(row=>row.title==='Synthetic talk 02');revisedTalk.start='09:05';revisedTalk.end='09:25';
const rotated=[...revised.slice(36),...revised.slice(0,36)];
const reimport=mergeImportedRows(first.rows,importCsvRows(rotated));
assert.equal(reimport.rows.length,91,'Reordered revised CSV must not duplicate existing records');
assert.equal(reimport.rows.filter(row=>row.type==='poster').length,18);
const keptTalk=reimport.rows.find(row=>row.id==='stable-talk-01');
assert.equal(keptTalk.title,'Organizer-corrected title');
assert.equal(keptTalk.entityId,'presentation-stable-talk-01');
assert.equal(keptTalk.calendarUid,'urn:stable-talk-01');
assert.equal(keptTalk.sequence,3,'Manual title remains and does not spuriously alter its calendar sequence');
const keptPoster=reimport.rows.find(row=>row.id==='stable-poster-01');
assert.equal(keptPoster.entityId,'poster-stable-01');
assert.equal(keptPoster.calendarUid,'urn:stable-poster-01');
assert.ok(reimport.conflicts.some(conflict=>conflict.includes('title')&&conflict.includes('preserved organizer edit')),
  'Changed source content conflicting with an organizer correction is reported');
const rescheduled=reimport.rows.find(row=>row.title==='Synthetic talk 02');
assert.equal(rescheduled.start,'09:05');
assert.equal(rescheduled.sequence,1,'A schedule change increments SEQUENCE');

// Poster title changes cannot be resolved from a shared session/time/venue and
// repeated author alone when the source has no poster number.
const oldUnnumbered=structuredClone(first.rows.find(row=>row.title==='Synthetic poster 02'));
oldUnnumbered.posterNumber='';oldUnnumbered.source.matchData.posterNumber='';
const newUnnumbered={...structuredClone(oldUnnumbered),id:'incoming-unnumbered-poster',title:'Revised unnumbered poster',
  source:{...oldUnnumbered.source,matchData:{...oldUnnumbered.source.matchData,title:'Revised unnumbered poster'}}};
const review=mergeImportedRows([oldUnnumbered],[newUnnumbered]);
assert.equal(review.rows.length,2,'Poster title changes without a stable number do not take another record identity');
assert.ok(review.conflicts.some(message=>message.includes('not a safe identity match')));

console.log('91-record synthetic CSV regression passed: 91 retained, 18 posters, repeated breaks, parallel slots and revised re-import');

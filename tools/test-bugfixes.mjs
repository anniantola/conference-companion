import './test-webcrypto.mjs';
/** Regressions found during the October 2026 Builder review.
 * Run with: npm run test:bugfixes
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeImportedRows} from '../src/builder/merge.js';
import {buildPackage} from '../src/builder/package.js';
import {heuristicRowsFromPdf,parseCSV} from '../src/builder/importers.js';
import {validatePackage} from '../src/validation.js';

function sourceRow(id,fileId,title,other={}){
  const {source={},...fields}=other;
  return {id:`view-${id}`,date:'2027-11-08',start:'10:00',end:'10:20',type:'talk',session:'Materials',title,
    location:'Room 1',track:'Track A',speaker:'A',sequence:0,
    source:{id,fileId,row:1,...source},...fields};
}

// 1. Importing new sources must not erase previously imported rows or manual additions.
const original=[
  sourceRow('file-a:source:2','file-a','Existing A',{id:'permanent-a',calendarUid:'urn:uuid:old',entityId:'presentation-permanent',sequence:2,manualFields:{speaker:true},speaker:'Manually corrected speaker'}),
  sourceRow('file-b:source:2','file-b','Existing B'),
  {id:'hand-entered',title:'Manual session',date:'2027-11-08',start:'13:00',end:'14:00',type:'special'}
];
const newRows=[sourceRow('file-c:source:2','file-c','New C')];
const mergedNew=mergeImportedRows(original,newRows);
assert.deepEqual(mergedNew.rows.map(r=>r.id),['permanent-a','view-file-b:source:2','hand-entered','view-file-c:source:2'],
  'Importing a third file must preserve other sources and hand-created programme rows');
assert.equal(mergedNew.rows.length,4);
assert.equal(original.length,3,'Merge must not mutate caller arrays');
const reimport=mergeImportedRows(mergedNew.rows,[sourceRow('file-a:source:2','file-a','Updated title',{speaker:'Source speaker'})]);
assert.equal(reimport.rows.length,4,'Re-import must not duplicate the same row');
assert.equal(reimport.rows[0].title,'Updated title','Non-manual source updates must apply');
assert.equal(reimport.rows[0].speaker,'Manually corrected speaker','Manual corrections must win');
assert.equal(reimport.rows[0].sequence,3,'Calendar-affecting changes must increment SEQUENCE');
assert.equal(reimport.rows[0].id,'permanent-a','Row identity must remain stable on reimport');
assert.equal(reimport.rows[0].calendarUid,'urn:uuid:old','Calendar UID must remain stable on reimport');
assert.ok(reimport.conflicts.some(x=>x.includes('speaker')),'Manual-vs-source conflicts must be reported');
assert.ok(reimport.conflicts.some(x=>x.includes('file-c:source:2'))===false,'Unrelated source should not be treated as stale');
const deleted=mergeImportedRows(original.slice(1),[sourceRow('file-a:source:2','file-a','Restored')],['file-a:source:2']);
assert.equal(deleted.rows.length,2,'Deleted source row must not be resurrected');
assert.ok(!deleted.rows.some(r=>r.source?.id==='file-a:source:2'));
assert.throws(()=>mergeImportedRows([],[sourceRow('x','f','A'),sourceRow('x','f','B')]),/duplicate source ID/);
const sheets=[sourceRow('file-x:Sheet1:2','file-x','Sheet 1',{source:{sheet:'Sheet1'}}),
  sourceRow('file-x:Sheet2:2','file-x','Sheet 2',{source:{sheet:'Sheet2'}})];
const sheetImport=mergeImportedRows(sheets,[sourceRow('file-x:Sheet1:3','file-x','New sheet 1 row',{source:{sheet:'Sheet1'}})]);
assert.equal(sheetImport.rows.length,3,'Importing one worksheet must not remove a different worksheet');
assert.ok(!sheetImport.conflicts.some(x=>x.includes('Sheet2')),'Other worksheets must not be flagged as missing');
const missing=mergeImportedRows(original,[sourceRow('file-a:source:3','file-a','Shifted row')]);
assert.ok(missing.rows.some(x=>x.id==='permanent-a'),'Missing source rows must be retained for review');
assert.ok(missing.conflicts.some(x=>x.includes('retained for manual review')),'Stale import rows should be visible as warnings');

function baseProject(rows,extras={}){
  return {
    conference:{id:'test-conference',name:'Test Conference',shortName:'Test',startDate:'2027-11-08',endDate:'2027-11-09',timezone:'Europe/Helsinki',venueName:'Main venue'},
    rows,features:{},branding:{primary:'#000000',secondary:'#000000',accent:'#000000',trackColors:{},locationColors:{}},
    identityRegistry:{people:{},locations:{},tracks:{}},sessionOverrides:{},dataVersion:1,lastPublishedVersion:0,changelog:[],...extras
  };
}
function talk(id,start,end,session='Workshop',location='Room 1',track='Track A'){
  return {id,date:'2027-11-08',start,end,type:'talk',session,title:`Talk ${id}`,speaker:`Speaker ${id}`,
    location,track};
}

// 2. The same session title can occur more than once on a day (or in a different room).
const sessionsProject=baseProject([
  talk('pm','16:00','16:30'),talk('morning1','09:00','09:30'),
  talk('morning2','09:30','10:00'),talk('other-room','09:15','09:45','Workshop','Room 2'),
  talk('other-track','09:30','10:00','Workshop','Room 1','Track B')
]);
const builtSessions=await buildPackage(sessionsProject);
assert.equal(builtSessions.report.errors.length,0,JSON.stringify(builtSessions.report.errors));
const workshopGroups=builtSessions.pkg.programme.sessions.filter(x=>x.title==='Workshop');
assert.equal(workshopGroups.length,4,'Title alone must not merge morning/afternoon/parallel sessions');
const morning=workshopGroups.find(x=>x.start==='09:00');
assert.equal(morning.presentationIds.length,2,'Adjacent talks must remain in a single session');
const afternoon=workshopGroups.find(x=>x.start==='16:00');
assert.equal(afternoon.presentationIds.length,1);
assert.notEqual(morning.id,afternoon.id);
const legacyProject=baseProject([
  {...talk('early','09:00','09:30'),sessionId:'legacy-merged'},
  {...talk('late','16:00','16:30'),sessionId:'legacy-merged'}
]);
const legacyFixed=await buildPackage(legacyProject);
assert.equal(legacyFixed.pkg.programme.sessions.filter(s=>s.title==='Workshop').length,2,
  'Previously auto-merged, disconnected sessions must also be split');
assert.equal(legacyProject.rows[0].sessionId,'legacy-merged',
  'The original session ID should be preserved for its first time block');
assert.notEqual(legacyProject.rows[1].sessionId,'legacy-merged');
const officialProject=baseProject([
  {...talk('official-am','09:00','09:30'),sessionId:'official-session',source:{id:'source:package:presentation:1'}},
  {...talk('official-pm','16:00','16:30'),sessionId:'official-session',source:{id:'source:package:presentation:2'}}
]);
const official=(await buildPackage(officialProject)).pkg;
assert.equal(official.programme.sessions.filter(s=>s.title==='Workshop').length,1,
  'Explicit imported canonical session membership must be preserved');
const idsBefore=new Map(sessionsProject.rows.map(r=>[r.id,r.sessionId]));
const again=await buildPackage(sessionsProject);
assert.equal(again.report.errors.length,0);
assert.deepEqual(new Map(sessionsProject.rows.map(r=>[r.id,r.sessionId])),idsBefore,
  'Established session IDs must be stable across package rebuilds');
const posterProject=baseProject([
  {...talk('poster1','','','Poster viewing'),type:'poster',posterNumber:'P1'},
  {...talk('poster2','','','Poster viewing'),type:'poster',posterNumber:'P2'}
]);
const posters=(await buildPackage(posterProject)).pkg;
assert.equal(posters.programme.sessions.filter(s=>s.type==='poster-session').length,1,
  'Untimed posters in the same named session should still share a session');

// 3. A date and its timed presentation may be on the SAME PDF text line.
const pdfRows=heuristicRowsFromPdf([{page:1,lines:[
  '08.11.2027 10:00–10:30 Introductory session — Speaker A',
  '11:00–11:30 Another talk — Speaker B',
  '2027-11-09 09:00–09:30 New day opening — Speaker C'
]}]);
assert.equal(pdfRows.length,3,'Inline dates may not swallow timed rows');
assert.deepEqual(pdfRows.map(x=>x.date),['2027-11-08','2027-11-08','2027-11-09']);
assert.deepEqual(pdfRows.map(x=>x.title),['Introductory session','Another talk','New day opening']);
assert.equal(pdfRows[0].speaker,'Speaker A');
assert.equal(pdfRows[2].start,'09:00');

// 4. Blank coordinate fields are absent; genuine 0° coordinates remain valid.
const coordsProject=baseProject([talk('a','09:00','09:20')],{
  extraLocations:[
    {id:'loc-empty',type:'venue',name:'Without coordinates',lat:'',lon:'  '},
    {id:'loc-zero',type:'venue',name:'Real zero',lat:0,lon:'0'},
    {id:'loc-invalid',type:'venue',name:'Out of range',lat:'92',lon:'-181'}
  ]
});
const coordsPkg=(await buildPackage(coordsProject)).pkg;
const byId=new Map(coordsPkg.locations.locations.map(x=>[x.id,x]));
assert.equal(Object.hasOwn(byId.get('loc-empty'),'lat'),false,'Blank lat must not become 0');
assert.equal(Object.hasOwn(byId.get('loc-empty'),'lon'),false,'Blank lon must not become 0');
assert.equal(byId.get('loc-zero').lat,0,'Actual zero latitude must be retained');
assert.equal(byId.get('loc-zero').lon,0,'Actual zero longitude must be retained');
assert.equal(Object.hasOwn(byId.get('loc-invalid'),'lat'),false,'Invalid latitude must not be saved');
assert.equal(Object.hasOwn(byId.get('loc-invalid'),'lon'),false,'Invalid longitude must not be saved');

// 5. CSV dialect detection must ignore separators inside quoted headers.
const semicolonCsv=parseCSV('"Title, including a comma";"Start, time";"Speaker"\n"One; talk";09:00;Alice');
assert.equal(semicolonCsv.length,1);
assert.deepEqual(Object.keys(semicolonCsv[0]).filter(x=>!x.startsWith('__')),
  ['Title, including a comma','Start, time','Speaker']);
assert.equal(semicolonCsv[0]['Title, including a comma'],'One; talk');
assert.equal(semicolonCsv[0]['Start, time'],'09:00');
const multilineHeaders=parseCSV('"Title,\nwith newline";Time\nTalk;13:00');
assert.equal(multilineHeaders[0]['Title,\nwith newline'],'Talk');

// 6. Real Gregorian dates only: reject impossible days, allow leap years.
const read=name=>JSON.parse(readFileSync(new URL(`../conference/${name}`,import.meta.url),'utf8'));
const valid={manifest:read('conference-manifest.json'),conference:read('conference.json'),programme:read('programme.json'),people:read('people.json'),locations:read('locations.json'),branding:read('branding.json')};
const impossible=structuredClone(valid);
impossible.conference.startDate='2027-02-30';
impossible.conference.endDate='2027-02-30';
assert.ok(validatePackage(impossible).errors.some(x=>x.includes('conference.startDate')));
assert.ok(validatePackage(impossible).errors.some(x=>x.includes('conference.endDate')));
const impossibleSession=structuredClone(valid);
impossibleSession.programme.sessions[0].date='2027-02-29';
assert.ok(validatePackage(impossibleSession).errors.some(x=>x.includes('invalid date')));
const leap=structuredClone(valid);
leap.conference.startDate='2028-02-29';
leap.conference.endDate='2028-02-29';
assert.ok(!validatePackage(leap).errors.some(x=>x.includes('conference.startDate')||x.includes('conference.endDate')),
  'February 29 in a leap year is valid');

console.log('All six Builder bug regression groups passed');

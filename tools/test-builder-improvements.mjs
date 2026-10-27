import './test-webcrypto.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCSV,guessMapping,rowsFromMapping} from '../src/builder/importers.js';
import {buildPackage,packageZip} from '../src/builder/package.js';
import {describeValidationMessage} from '../src/builder/validation-ui.js';
import {readStoredZip,textEntry} from '../src/zip.js';

const config={id:'builder-improvements',name:'Synthetic Conference',startDate:'2031-06-10',endDate:'2031-06-11',timezone:'Europe/Helsinki',venueName:'Main venue'};
const makeProject=rows=>({conference:{...config},rows,branding:{},features:{},peopleOverrides:{},identityRegistry:{people:{},locations:{},tracks:{}},dataVersion:1});
const csv=`date,start,end,type,session,title,speaker,speakerId,chair,chairId,affiliation,room,track
2031-06-10,09:00,09:30,talk,Methods,First,Alex Example,person-alex,Casey Chair,person-casey,North Institute,Room A,Methods
2031-06-10,10:00,10:30,talk,Methods,Second,Alex Example,person-alex,Casey Chair,person-casey,South Institute,Room A,Methods`;
const raw=parseCSV(csv).map(row=>({...row,__sourceFileId:'explicit-ids'}));
const rows=rowsFromMapping(raw,guessMapping(Object.keys(raw[0])));
assert.deepEqual(rows[0].speakerEntityIds,['person-alex']);
assert.deepEqual(rows[0].chairEntityIds,['person-casey']);
const project=makeProject(rows);
let result=await buildPackage(project);
assert.equal(result.pkg.people.people.length,2,'Explicit IDs consolidate across affiliation changes');
assert.deepEqual(result.pkg.people.people.find(p=>p.id==='person-alex').affiliations,['North Institute','South Institute']);
assert.equal(result.pkg.programme.sessions.every(s=>s.chairIds.includes('person-casey')),true);
project.peopleOverrides['person-alex']={position:'Professor'};
project.rows[0].affiliation='Corrected Institute';
result=await buildPackage(project);
assert.equal(result.pkg.people.people.find(p=>p.id==='person-alex').position,'Professor');
assert.equal(project.rows[0].speakerEntityIds[0],'person-alex','Affiliation edits cannot change a permanent ID');
assert.equal(project.identityRegistry.personRecords['person-alex'].affiliations.includes('corrected institute'),true);
project.branding={primary:'#165a70',secondary:'#22764f',accent:'#d02763',trackColors:{[project.rows[0].trackEntityId]:'#654321'},locationColors:{[project.rows[0].locationEntityId]:'#123456'}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async path=>{if(String(path).endsWith('.nojekyll'))return new Response('',{status:404});try{return new Response(await readFile(String(path).replace(/^\.\//,'')));}catch{return new Response('',{status:404});}};
try{
  const exported=await packageZip(project),entries=await readStoredZip(exported.blob);
  assert.deepEqual(JSON.parse(textEntry(entries,'conference/branding.json')),exported.pkg.branding,'ZIP branding is the same model used by live preview');
  assert.deepEqual(JSON.parse(textEntry(entries,'conference/programme.json')),exported.pkg.programme,'ZIP programme is the same model used by live preview');
}finally{globalThis.fetch=originalFetch;}

const different=makeProject(rowsFromMapping(parseCSV(csv.replaceAll('person-alex','person-one').replace('Second,Alex Example,person-one','Second,Alex Example,person-two')).map(row=>({...row,__sourceFileId:'different'})),guessMapping(Object.keys(raw[0]))));
const distinct=await buildPackage(different);
assert.equal(distinct.pkg.people.people.filter(p=>p.name==='Alex Example').length,2,'Different explicit IDs remain separate despite matching names');

const overlap=makeProject([
  {id:'a',date:'2031-06-10',start:'09:00',end:'10:00',type:'talk',session:'Track A',title:'First',location:'Room A',track:'A'},
  {id:'b',date:'2031-06-10',start:'09:30',end:'10:30',type:'talk',session:'Track B',title:'Second',location:'Room A',track:'B'},
  {id:'c',date:'2031-06-12',start:'10:30',end:'11:00',type:'poster',session:'Poster Hall',title:'Poster',location:'Room B',track:'Posters'}
]);
const conflict=await buildPackage(overlap);
const warning=conflict.report.warnings.find(x=>x.startsWith('Location overlap:'));
assert.ok(warning,'Real same-room overlap remains visible');
const described=describeValidationMessage(warning,conflict.pkg,overlap);
assert.match(described.text,/Track A/);assert.match(described.text,/Track B/);assert.match(described.text,/Room A/);assert.match(described.text,/2031-06-10/);
assert.equal(described.target.type,'session');
const dateError=conflict.report.errors.find(x=>x.includes('outside conference range'));
assert.ok(dateError);
assert.match(describeValidationMessage(dateError,conflict.pkg,overlap).text,/Poster Hall.*2031-06-12/);
const parallel=makeProject([
  {id:'p1',date:'2031-06-10',start:'09:00',end:'10:00',type:'talk',session:'Track A',title:'First',location:'Room A',track:'A'},
  {id:'p2',date:'2031-06-10',start:'09:00',end:'10:00',type:'talk',session:'Track B',title:'Second',location:'Room B',track:'B'}
]);
assert.equal((await buildPackage(parallel)).report.warnings.some(x=>x.startsWith('Location overlap:')),false,'Parallel rooms do not conflict');
const venue=makeProject([{id:'v1',date:'2031-06-10',start:'09:00',end:'10:00',type:'talk',session:'A',title:'A'},{id:'v2',date:'2031-06-10',start:'09:00',end:'10:00',type:'talk',session:'B',title:'B'}]);
assert.equal((await buildPackage(venue)).report.warnings.some(x=>x.startsWith('Location overlap:')),false,'Shared parent venue is not an exclusive room');
const posters=makeProject([
  {id:'poster-a',date:'2031-06-10',start:'14:00',end:'16:00',type:'poster',session:'Poster Theme A',title:'Poster A',location:'Poster Hall',track:'Posters',posterNumber:'P1'},
  {id:'poster-b',date:'2031-06-10',start:'14:00',end:'16:00',type:'poster',session:'Poster Theme B',title:'Poster B',location:'Poster Hall',track:'Posters',posterNumber:'P2'}
]);
assert.equal((await buildPackage(posters)).report.warnings.some(x=>x.startsWith('Location overlap:')),false,'Parallel poster themes sharing one exhibition window are not room conflicts');
posters.rows[1].start='15:00';
assert.equal((await buildPackage(posters)).report.warnings.some(x=>x.startsWith('Location overlap:')),true,'Different partially overlapping poster windows remain reviewable');
console.log('Builder improvements regressions passed: explicit IDs, registry, contextual validation, room conflicts');

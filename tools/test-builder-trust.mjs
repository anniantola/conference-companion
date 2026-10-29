import './test-webcrypto.mjs';
import assert from 'node:assert/strict';
import {mergeImportedRows} from '../src/builder/merge.js';
import {buildPackage,packageZip,confirmProjectPublication,packageContentFingerprint} from '../src/builder/package.js';
import {rowsFromMapping,rowsFromStructuredPackage,heuristicRowsFromPdf} from '../src/builder/importers.js';
import {validatePackageSchemas} from '../src/json-schema.js';

const base={date:'2028-04-10',start:'09:00',end:'09:30',type:'talk',session:'Methods',title:'Imaging Methods',speaker:'R. Researcher',chair:'',affiliation:'North Lab',location:'Hall A',track:'Track One'};
const imported=(id,row,fields={})=>({...base,...fields,id:`view-${id}`,entityId:fields.entityId||undefined,source:{id,fileId:'sheet-a',row,matchData:{...base,...fields}}});
const original=[
  {...imported('s:2',2),id:'stable-one',entityId:'presentation-one',calendarUid:'urn:stable-one',sequence:4,manualFields:{abstract:true},abstract:'Organizer correction'},
  {...imported('s:3',3,{title:'Parallel Analysis',start:'09:30',end:'10:00',speaker:'S. Analyst'}),id:'stable-two',entityId:'presentation-two',calendarUid:'urn:stable-two'}
];
// Inserted rows do not inherit the former row occupant's identities or manual edits.
const afterInsert=[imported('s:2',2,{title:'New inserted talk',start:'08:30',end:'09:00',speaker:'New Speaker'}),imported('s:3',3),imported('s:4',4,{title:'Parallel Analysis',start:'09:30',end:'10:00',speaker:'S. Analyst'})];
const inserted=mergeImportedRows(original,afterInsert);
assert.equal(inserted.rows.find(r=>r.title==='Imaging Methods').id,'stable-one','Moved source row matches by content rather than row number');
assert.equal(inserted.rows.find(r=>r.title==='Imaging Methods').abstract,'Organizer correction');
assert.equal(inserted.rows.find(r=>r.title==='Imaging Methods').calendarUid,'urn:stable-one');
assert.equal(inserted.rows.find(r=>r.title==='New inserted talk').id,'view-s:2','Inserted row does not inherit prior row identity');
assert.ok(inserted.conflicts.every(x=>!x.includes('stable-one')),'Matched moved rows are not falsely reported missing');

// Reordered rows preserve their identities, while truly deleted rows remain visible with a warning.
const reordered=mergeImportedRows(original,[imported('s:2',2,{title:'Parallel Analysis',start:'09:30',end:'10:00',speaker:'S. Analyst'}),imported('s:3',3)]);
assert.equal(reordered.rows.find(r=>r.title==='Imaging Methods').id,'stable-one');
assert.equal(reordered.rows.find(r=>r.title==='Parallel Analysis').id,'stable-two');
const deleted=mergeImportedRows(original,[imported('s:2',2)]);
assert.ok(deleted.rows.some(r=>r.id==='stable-two'));
assert.ok(deleted.conflicts.some(x=>x.includes('s:3')&&x.includes('retained for manual review')));

// Renamed talks retain identities only with a unique, corroborated schedule context.
const renamedOld=[{...imported('s:8',8),id:'stable-rename',entityId:'presentation-rename',calendarUid:'urn:rename',sequence:2}];
const renamed=mergeImportedRows(renamedOld,[imported('s:21',21,{title:'New title'})]);
assert.equal(renamed.rows[0].id,'stable-rename');
assert.equal(renamed.rows[0].entityId,'presentation-rename');
assert.equal(renamed.rows[0].calendarUid,'urn:rename');
assert.equal(renamed.rows[0].sequence,3,'A renamed calendar item increments SEQUENCE');

// Duplicate schedule candidates remain separate and explicitly require review.
const duplicates=mergeImportedRows([
  {...imported('d:2',2),id:'duplicate-a',entityId:'presentation-a'},
  {...imported('d:3',3),id:'duplicate-b',entityId:'presentation-b'}
],[imported('d:2',2)]);
assert.equal(duplicates.rows.at(-1).id,'view-d:2','An ambiguous match cannot inherit an old entity identity');
assert.ok(duplicates.conflicts.some(x=>x.includes('ambiguous presentation match')));

// Stable explicit structured IDs win even when a package is imported from another file.
const structured={conference:{id:'c',name:'C'},programme:{tracks:[],sessions:[{id:'s',title:'Session',date:'2028-04-10',start:'09:00',end:'09:30',locationId:'l',trackId:'t',presentationIds:['p']}],presentations:[{id:'p',title:'Talk',sessionId:'s',speakerIds:['person-x'],start:'09:00',end:'09:30',calendarUid:'uid-p'}],posters:[],announcements:[]},people:{people:[{id:'person-x',name:'X',affiliations:['Lab']}]},locations:{locations:[{id:'l',name:'Room'}]}};
const structuredRows=rowsFromStructuredPackage(structured,'another-file');
const explicit=mergeImportedRows([{...structuredRows[0],id:'builder-old',calendarUid:'uid-old',entityId:'p'}],structuredRows);
assert.equal(explicit.rows[0].id,'builder-old');
assert.equal(explicit.rows[0].entityId,'p');
assert.equal(explicit.rows[0].calendarUid,'uid-old');
assert.deepEqual(explicit.rows[0].speakerEntityIds,['person-x']);

const csvRow={...imported('csv:2',2),id:'csv-stable',calendarUid:'uid-cross-format',source:{...imported('csv:2',2).source,fileId:'csv-source'}};
const xlsxSame={...imported('xlsx:7',7),source:{...imported('xlsx:7',7).source,fileId:'xlsx-source'}};
const crossFormat=mergeImportedRows([csvRow],[xlsxSame]);
assert.equal(crossFormat.rows.length,1,'Equivalent records from CSV and XLSX reconcile across source identities');
assert.equal(crossFormat.rows[0].id,'csv-stable');assert.equal(crossFormat.rows[0].calendarUid,'uid-cross-format');
assert.ok(crossFormat.rows[0].source.contributors.includes('csv-source')&&crossFormat.rows[0].source.contributors.includes('xlsx-source'),'Every supporting file is recorded on the reconciled entry');
const renamedFromOtherFile={...xlsxSame,title:'A possibly revised title',source:{...xlsxSame.source,id:'xlsx:8',matchData:{...xlsxSame.source.matchData,title:'A possibly revised title'}}};
const uncertain=mergeImportedRows([csvRow],[renamedFromOtherFile]);
assert.equal(uncertain.rows.length,2,'A renamed cross-file match is never applied automatically');assert.equal(uncertain.reviewMatches[0].candidates[0].id,'csv-stable');
const resolved=mergeImportedRows([csvRow],[renamedFromOtherFile],[],{ 'xlsx:8':'csv-stable'});
assert.equal(resolved.rows.length,1);assert.equal(resolved.rows[0].id,'csv-stable','An organizer-selected possible match retains the old entity identity');
const keptSeparate=mergeImportedRows([csvRow],[renamedFromOtherFile],[],{ 'xlsx:8':'__separate__'});
assert.equal(keptSeparate.rows.length,2,'An organizer can explicitly keep an uncertain cross-source entry separate');
assert.equal(keptSeparate.reviewMatches.length,0,'An explicit separate decision resolves the match review');
const parallelDifferentTrack={...xlsxSame,title:csvRow.title,track:'Other track',source:{...xlsxSame.source,id:'xlsx:9',matchData:{...xlsxSame.source.matchData,title:csvRow.title,track:'Other track'}}};
assert.equal(mergeImportedRows([csvRow],[parallelDifferentTrack]).rows.length,2,'Same title and time in a different track remain distinct');

function project(rows,extras={}){return {conference:{id:'test-conference',name:'Test Conference',shortName:'Test',startDate:'2028-04-10',endDate:'2028-04-10',timezone:'Europe/Helsinki',venueName:'Main'},rows,features:{},branding:{primary:'#123456',secondary:'#234567',accent:'#123456',trackColors:{},locationColors:{}},identityRegistry:{people:{},locations:{},tracks:{}},sessionOverrides:{},dataVersion:1,lastPublishedVersion:0,changelog:[],...extras};}
const poster={...base,id:'poster-row',date:'2028-04-10',type:'poster',session:'Poster session',title:'Poster title',posterNumber:'P1',start:'',end:'',speaker:'Poster Author'};
const missingPoster=await buildPackage(project([{...poster}]));
assert.ok(missingPoster.report.errors.some(x=>x.includes('start is required')),'Poster with missing time blocks package generation');
assert.equal(missingPoster.pkg.programme.sessions.find(s=>s.type==='poster-session').start,'','Poster start is never invented');
assert.equal(missingPoster.pkg.programme.sessions.find(s=>s.type==='poster-session').end,'','Poster end is never invented');
await assert.rejects(packageZip(project([{...poster}])),/start is required/,'An incomplete poster schedule cannot be exported');
const correctedPosterProject=project([{...poster,date:'',start:'',end:''}]);
await buildPackage(correctedPosterProject);
correctedPosterProject.sessionOverrides[correctedPosterProject.rows[0].posterSessionId]={date:'2028-04-10',start:'17:00',end:'18:00'};
const correctedPoster=await buildPackage(correctedPosterProject);
assert.equal(correctedPoster.report.errors.length,0,correctedPoster.report.errors.join('\n'));
assert.deepEqual(((s)=>[s.date,s.start,s.end])(correctedPoster.pkg.programme.sessions.find(s=>s.type==='poster-session')),['2028-04-10','17:00','18:00']);
const pdfDefaultCheck=heuristicRowsFromPdf([{page:3,lines:['Untimed extracted schedule line']}],'2028-04-10','pdf-source');
assert.equal(pdfDefaultCheck.length,0,'Untimed text is retained in extraction review, not converted into rows or given a default date');
const incompletePdf=heuristicRowsFromPdf([{page:2,lines:['09:00–09:30 Opening programme']}]);
const incomplete=await buildPackage(project(incompletePdf));
assert.ok(incomplete.report.errors.length,'Incomplete PDF import cannot validate for export');
assert.ok(incomplete.report.errors.some(x=>x.includes('PDF page 2')),'PDF validation error identifies its source');
const untitled=await buildPackage(project([{...base,title:''}]));
assert.ok(untitled.report.errors.some(x=>x.includes('title is required')));
assert.equal(untitled.pkg.programme.presentations[0].title,'','Missing presentation titles are not replaced with invented text');

// Identical names at different known affiliations remain distinct; repeated talks with
// the same explicit person ID remain linked. Affiliation corrections retain IDs.
const sameName=project([
  {...base,id:'person-row-a',title:'Talk A',speaker:'Alex Example',affiliation:'University North'},
  {...base,id:'person-row-b',title:'Talk B',speaker:'Alex Example',affiliation:'Institute South',start:'09:30',end:'10:00'}
]);
const namesA=await buildPackage(sameName),personIdsA=namesA.pkg.people.people.filter(p=>p.name==='Alex Example').map(p=>p.id);
assert.equal(new Set(personIdsA).size,2,'Same name with different affiliations stays distinct');
const unresolved=project([{...base,id:'ambiguous-known',speaker:'Alex Example',affiliation:'',title:'Unassigned affiliation'}],{identityRegistry:{people:{'alex example|university north':'person-north','alex example|institute south':'person-south'},locations:{},tracks:{}}});
const unresolvedBuild=await buildPackage(unresolved);
assert.equal(unresolved.rows[0].personIdentityConflict,true,'Name-only matches against known people require organizer resolution');
assert.ok(unresolved.rows[0].personIdentityCandidates.includes('person-north')&&unresolved.rows[0].personIdentityCandidates.includes('person-south'));
assert.deepEqual(new Set(unresolvedBuild.pkg.people.people.map(person=>person.id)),new Set(['person-north','person-south']),'Registered candidate profiles remain available for the organizer without inventing an assignment');
const stablePerson=namesA.pkg.programme.presentations[0].speakerIds[0];
sameName.rows[0].speakerEntityIds=[stablePerson];sameName.rows[0].affiliation='Corrected University';
const corrected=await buildPackage(sameName);
assert.equal(corrected.pkg.programme.presentations.find(p=>p.title==='Talk A').speakerIds[0],stablePerson,'Affiliation correction preserves explicit identity');

const twoTalks=project([
  {...base,id:'talk-one',speaker:'Morgan Researcher',speakerEntityIds:['person-explicit'],title:'First talk'},
  {...base,id:'talk-two',speaker:'Morgan Researcher',speakerEntityIds:['person-explicit'],affiliation:'Institute South',title:'Second talk',start:'09:30',end:'10:00'}
]);
const linked=await buildPackage(twoTalks);
assert.equal(linked.pkg.programme.presentations[0].speakerIds[0],'person-explicit');
assert.equal(linked.pkg.programme.presentations[1].speakerIds[0],'person-explicit');
assert.deepEqual(linked.pkg.people.people.find(p=>p.id==='person-explicit').affiliations,['North Lab','Institute South'],'Explicit person IDs retain multiple affiliations');

// Builder uses the same schemas before export and reports both schema and semantic errors.
const valid=await buildPackage(project([{...base,id:'valid-row'}]));
assert.equal(valid.report.errors.length,0,valid.report.errors.join('\n'));
assert.deepEqual(await validatePackageSchemas(valid.pkg),[]);
const invalidSchema=structuredClone(valid.pkg);delete invalidSchema.conference.name;
assert.ok((await validatePackageSchemas(invalidSchema)).some(x=>x.includes('conference.name')));

// Download/export does not become a publication; confirmation binds a version to content.
const release=project([{...base,id:'release-row'}]);
const first=await buildPackage(release);const fingerprint=await packageContentFingerprint(first.pkg);
assert.equal(release.lastPublishedVersion,0);
assert.equal(release.confirmedPublications,undefined);
await confirmProjectPublication(release,first.pkg);
assert.equal(release.lastPublishedVersion,1);
const unchanged=await buildPackage(release);assert.equal(unchanged.report.errors.length,0,'Re-exporting identical confirmed content is allowed');
release.rows[0].title='Changed after publication';
const changed=await buildPackage(release);
assert.ok(changed.report.errors.some(x=>x.includes('confirmed for different content')));
assert.notEqual(await packageContentFingerprint(changed.pkg),fingerprint);

console.log('Builder trust regressions passed: identity matching, incomplete data, people, schemas, publication tracking');

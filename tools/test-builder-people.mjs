import './test-webcrypto.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCSV,guessMapping,rowsFromMapping} from '../src/builder/importers.js';
import {mergeImportedRows} from '../src/builder/merge.js';
import {buildPackage,packageZip} from '../src/builder/package.js';
import {possiblePersonDuplicates,mergePersonProfiles,mergePersonProfilesMany,identityReviewGroups,decidePersonIdentity,applyIdentityResolutions,applyPersonIdentityDecision} from '../src/builder/people.js';
import {createBuilderProjectFile,readBuilderProjectFile} from '../src/builder/project-file.js';
import {synthetic91Csv,synthetic91Headers} from './synthetic-91-csv.js';

function importedRows(){const raw=parseCSV(synthetic91Csv()).map(row=>({...row,__sourceFileId:'people-synthetic'}));return rowsFromMapping(raw,guessMapping(synthetic91Headers));}
function project(rows){return {conference:{id:'synthetic-people',name:'Synthetic People Conference',shortName:'Synthetic',startDate:'2031-06-10',endDate:'2031-06-11',timezone:'Europe/Helsinki',venueName:'Main venue'},rows,features:{},branding:{},identityRegistry:{people:{},locations:{},tracks:{}},peopleOverrides:{},peoplePhotos:{},extraPeople:[],dataVersion:1};}

const initial=project(mergeImportedRows([],importedRows()).rows);
const first=await buildPackage(initial);
assert.equal(initial.rows.length,91);
assert.equal(first.pkg.programme.posters.length,18);
assert.equal(new Set(first.pkg.people.people.map(p=>p.name)).size,23);
assert.equal(first.pkg.people.people.length,23,'Repeated affiliated speakers and unaffiliated chairs share the 23 reliable identities');
assert.ok(initial.identityStats.automaticallyConsolidated>0,'Identity consolidation count is visible to organizers');
assert.deepEqual(possiblePersonDuplicates(first.pkg.people.people),[]);
const speaker=first.pkg.people.people.find(p=>p.name==='Researcher 08');
assert.ok(first.pkg.programme.presentations.some(p=>p.speakerIds.includes(speaker.id)));
assert.ok(first.pkg.programme.sessions.some(s=>s.chairIds.includes(speaker.id)));
assert.equal(first.report.errors.length,0,first.report.errors.join('\n'));
const originalFetch=globalThis.fetch;
globalThis.fetch=async path=>{if(String(path).endsWith('.nojekyll'))return new Response('',{status:404});try{return new Response(await readFile(String(path).replace(/^\.\//,'')));}catch{return new Response('',{status:404});}};
try{await packageZip(initial);}finally{globalThis.fetch=originalFetch;}

// A saved project can already contain a separate, manually edited chair profile.
// Show it for review and merge it only after an explicit organizer decision.
const legacy=structuredClone(initial),chairRow=legacy.rows.find(r=>r.chair==='Researcher 08');
chairRow.chairEntityIds=['person-legacy-chair'];
legacy.rows.find(r=>r.speaker==='Researcher 08').speakerEntityIds=['person-legacy-chair'];
legacy.peopleOverrides['person-legacy-chair']={position:'Session chair',publicEmail:'chair@example.org',orcid:'0000-0000-0000-0001'};
legacy.peoplePhotos['person-legacy-chair']={name:'chair.jpg',type:'image/jpeg',extension:'.jpg',bytes:new Uint8Array([1,2,3])};
const before=await buildPackage(legacy);
assert.equal(before.pkg.people.people.length,24,'Existing duplicate profiles remain visible before review');
assert.equal(possiblePersonDuplicates(before.pkg.people.people).length,1);
const legacyZip=await readBuilderProjectFile(await createBuilderProjectFile(legacy));
assert.equal((await buildPackage(legacyZip)).pkg.people.people.length,24,'Legacy duplicate profiles are not silently merged while loading a project ZIP');
assert.deepEqual([...legacyZip.peoplePhotos['person-legacy-chair'].bytes],[1,2,3],'Legacy profile photographs survive project ZIP loading');
const stable=before.pkg.people.people.find(p=>p.name==='Researcher 08'&&p.id!=='person-legacy-chair').id;
mergePersonProfiles(legacy,before.pkg.people.people,stable,'person-legacy-chair',{position:'remove',publicEmail:'remove',orcid:'remove',photoUrl:'remove'});
const after=await buildPackage(legacy);
assert.equal(after.pkg.people.people.length,23);
assert.equal(after.pkg.people.people.find(p=>p.id===stable).position,'Session chair');
assert.equal(after.pkg.people.people.find(p=>p.id===stable).publicEmail,'chair@example.org');
assert.ok(after.pkg.people.people.find(p=>p.id===stable).photoUrl.includes(stable));
assert.ok(after.pkg.programme.sessions.every(s=>!s.chairIds.includes('person-legacy-chair')));
assert.ok(after.pkg.programme.presentations.every(p=>!p.speakerIds.includes('person-legacy-chair')));
assert.ok(after.pkg.programme.posters.every(p=>!p.authorIds.includes('person-legacy-chair')));
assert.equal(legacy.personIdAliases['person-legacy-chair'],stable);
assert.equal(legacy.personMergeHistory.length,1);
assert.equal(after.report.errors.length,0,after.report.errors.join('\n'));

// Re-imported rows retain the confirmed ID, profile edit, photograph and references.
legacy.rows=mergeImportedRows(legacy.rows,importedRows()).rows;
const reimported=await buildPackage(legacy);
assert.equal(reimported.pkg.people.people.length,23);
assert.equal(reimported.pkg.people.people.find(p=>p.id===stable).position,'Session chair');
assert.ok(reimported.pkg.programme.sessions.some(s=>s.chairIds.includes(stable)));
assert.ok(legacy.peoplePhotos[stable]);

const authorRow=legacy.rows.find(r=>r.type==='poster');
authorRow.speakerEntityIds=['person-legacy-author'];
const authorBefore=await buildPackage(legacy);
assert.equal(authorBefore.pkg.people.people.length,24);
const authorId=authorBefore.pkg.people.people.find(p=>p.name==='Researcher 23'&&p.id!=='person-legacy-author').id;
mergePersonProfiles(legacy,authorBefore.pkg.people.people,authorId,'person-legacy-author');
const authorAfter=await buildPackage(legacy);
assert.equal(authorAfter.pkg.people.people.length,23);
assert.ok(authorAfter.pkg.programme.posters.every(p=>!p.authorIds.includes('person-legacy-author')),'Poster author references use the confirmed surviving ID');

// Explicit IDs and different known affiliations are stronger evidence than names.
const distinct=project([
  {id:'a',date:'2031-06-10',start:'09:00',end:'09:30',type:'talk',session:'A',title:'A',speaker:'Alex Same',affiliation:'North Institute',speakerEntityIds:['person-north'],location:'Room A',track:'A'},
  {id:'b',date:'2031-06-10',start:'10:00',end:'10:30',type:'talk',session:'B',title:'B',speaker:'Alex Same',affiliation:'South Institute',speakerEntityIds:['person-south'],location:'Room B',track:'B'}
]);
const separate=await buildPackage(distinct);
assert.deepEqual(new Set(separate.pkg.people.people.map(p=>p.id)),new Set(['person-north','person-south']));
assert.equal(possiblePersonDuplicates(separate.pkg.people.people).length,1,'Same-name profiles are review candidates, not automatic merges');
assert.equal(identityReviewGroups(distinct,separate.pkg.people.people).length,1,'Same-name people with distinct affiliations enter a review group with context');
const posterReview=identityReviewGroups({rows:[{id:'poster-author',type:'poster',title:'Poster context',author:'Alex Same',authorEntityIds:['person-north'],session:'Poster Session A',date:'2031-06-10',start:'15:00',source:{fileId:'poster-source',row:14}}]},separate.pkg.people.people);
assert.equal(posterReview[0].appearances[0].role,'Author','Poster author links appear in identity review context');
assert.equal(posterReview[0].appearances[0].row.title,'Poster context');
const pair=separate.pkg.people.people.map(person=>person.id);
decidePersonIdentity(distinct,pair[0],pair[1],'different');
assert.equal(identityReviewGroups(distinct,separate.pkg.people.people).length,0,'Confirmed different profiles are no longer unresolved');
const confirmed=await buildPackage(distinct);
assert.equal(confirmed.report.warnings.some(warning=>warning.includes('Ambiguous person')),false,'Confirmed distinct people do not repeat identity warnings');
const decisionBackup=await readBuilderProjectFile(await createBuilderProjectFile(distinct));
assert.equal(decisionBackup.identityDecisions.pairs[[...pair].sort().join('::')],'different','Explicit separation persists in project backups');
distinct.rows=mergeImportedRows(distinct.rows,distinct.rows.map(row=>({...row,source:{...row.source,fileId:'revised-source',id:`revised:${row.id}`} }))).rows;
const afterReimport=await buildPackage(distinct);
assert.equal(identityReviewGroups(distinct,afterReimport.pkg.people.people).length,0,'Re-import retains explicit different-person decisions');
const missing=project([...distinct.rows,{id:'c',date:'2031-06-10',start:'11:00',end:'11:30',type:'talk',session:'C',title:'C',speaker:'Alex Same',affiliation:'',location:'Room C',track:'C'}]);
await buildPackage(missing);
assert.equal(missing.rows[2].personIdentityConflict,true,'Missing affiliation remains unresolved when multiple people share the name');
const ambiguousChair=project([...distinct.rows,{id:'chair-row',date:'2031-06-10',start:'12:00',end:'12:30',type:'talk',session:'D',title:'D',speaker:'Other Speaker',affiliation:'Other Institute',chair:'Alex Same',location:'Room D',track:'D'}]);
await buildPackage(ambiguousChair);
assert.equal(ambiguousChair.rows[2].personIdentityConflict,true,'An unaffiliated chair is not assigned to either same-name researcher automatically');

const bulkProject=project([]);bulkProject.extraPeople=[{id:'a',name:'Pat One',affiliations:['Institute A']},{id:'b',name:'Pat One',affiliations:['Institute B']},{id:'c',name:'Rae Two',affiliations:['Institute C']},{id:'d',name:'Rae Two',affiliations:['Institute D']}];bulkProject.peoplePhotos={a:{name:'a.jpg',type:'image/jpeg',bytes:new Uint8Array([1,2])},b:{name:'b.jpg',type:'image/jpeg',bytes:new Uint8Array([3,4])}};bulkProject.rows=[{id:'r1',speaker:'Pat One',speakerEntityIds:['b'],chair:'Rae Two',chairEntityIds:['d']}];
assert.throws(()=>applyIdentityResolutions(bulkProject,bulkProject.extraPeople,[{firstId:'a',secondId:'b',decision:'same',keepId:'a'},{firstId:'a',secondId:'b',decision:'different'}]),/conflict/,'Conflicting simultaneous resolutions are rejected before mutation');
assert.equal(bulkProject.rows[0].speakerEntityIds[0],'b','Rejected bulk resolution leaves source project references untouched');
const mergedBulk=applyIdentityResolutions(bulkProject,bulkProject.extraPeople,[{firstId:'a',secondId:'b',decision:'same',keepId:'a'}]);
assert.equal(mergedBulk.rows[0].speakerEntityIds[0],'a','Confirmed merge updates programme references atomically');
assert.equal(mergedBulk.peoplePhotos.a.name,'a.jpg');assert.equal(mergedBulk.mergedPersonPhotos.a[0].name,'b.jpg','Non-selected profile photos remain recoverable in Builder data');
const transitive=project([]);transitive.extraPeople=[{id:'same-a',name:'Same person'},{id:'same-c',name:'Same person'},{id:'different-b',name:'Other person'}];transitive.identityDecisions={pairs:{'different-b::same-a':'different'}};
const transitiveResult=applyIdentityResolutions(transitive,transitive.extraPeople,[{firstId:'same-a',secondId:'same-c',decision:'same',keepId:'same-c'}]);
assert.equal(transitiveResult.identityDecisions.pairs['different-b::same-c'],'different','Merging aliases carries confirmed distinct-person decisions to the surviving identity');
transitive.identityDecisions.pairs['different-b::same-c']='same';
assert.throws(()=>applyIdentityResolutions(transitive,transitive.extraPeople,[{firstId:'same-a',secondId:'same-c',decision:'same',keepId:'same-c'}]),/conflicting confirmed identity decisions/);
assert.equal(transitive.extraPeople.length,3,'A contradictory merge fails without changing source profiles');

// Multi-profile merging is a single snapshot operation: the first interacted-with ID survives.
const multi=project([]);multi.extraPeople=[
  {id:'profile-c',name:'Jordan Example',affiliations:['Institute C'],position:'Professor',orcid:'0000-0000-0000-0003',papers:['Poster C']},
  {id:'profile-a',name:'Jordan Example',affiliations:['Institute A'],publicEmail:'jordan@example.org',papers:['Talk A']},
  {id:'profile-d',name:'Jordan Example',affiliations:['Institute D'],website:'https://example.org/jordan',papers:['Talk D']},
  {id:'profile-b',name:'Jordan Example',affiliations:['Institute B'],papers:['Poster B']}
];
multi.peopleOverrides={'profile-c':{position:'Professor'},'profile-a':{orcid:'0000-0000-0000-0001'}};
multi.peoplePhotos={
  'profile-c':{name:'jordan-c.jpg',type:'image/jpeg',bytes:new Uint8Array([1,2,3])},
  'profile-a':{name:'jordan-a.jpg',type:'image/jpeg',bytes:new Uint8Array([4,5,6])},
  'profile-d':{name:'jordan-d.jpg',type:'image/jpeg',bytes:new Uint8Array([7,8,9])}
};
multi.rows=[
  {id:'talk-a',type:'talk',title:'Talk A',speaker:'Jordan Example',speakerEntityIds:['profile-a']},
  {id:'poster-b',type:'poster',title:'Poster B',speaker:'Jordan Example',speakerEntityIds:['profile-b']},
  {id:'chair-d',type:'talk',title:'Talk D',chair:'Jordan Example',chairEntityIds:['profile-d']},
  {id:'poster-c',type:'poster',title:'Poster C',speaker:'Jordan Example',speakerEntityIds:['profile-c']}
];
const multiPeople=multi.extraPeople.map(person=>({...person,affiliations:person.affiliations,links:[]}));
const mergedC=mergePersonProfilesMany(multi,multiPeople,['profile-c','profile-a','profile-d']);
assert.equal(multi.rows[0].speakerEntityIds[0],'profile-a','The original project is unchanged before the atomic result is accepted');
assert.deepEqual(mergedC.rows.map(row=>row.speakerEntityIds?.[0]||row.chairEntityIds?.[0]),['profile-c','profile-b','profile-c','profile-c']);
assert.deepEqual(mergedC.extraPeople.map(person=>person.id),['profile-c','profile-b']);
assert.deepEqual(mergedC.extraPeople.find(person=>person.id==='profile-c').affiliation,'Institute C; Institute A; Institute D');
assert.deepEqual(mergedC.extraPeople.find(person=>person.id==='profile-c').papers,['Poster C','Talk A','Talk D']);
assert.equal(mergedC.extraPeople.find(person=>person.id==='profile-c').position,'Professor');
assert.equal(mergedC.extraPeople.find(person=>person.id==='profile-c').publicEmail,'jordan@example.org');
assert.deepEqual([...mergedC.peoplePhotos['profile-c'].bytes],[1,2,3],'Primary photo stays selected');
assert.deepEqual(mergedC.mergedPersonPhotos['profile-c'].map(photo=>photo.name),['jordan-a.jpg','jordan-d.jpg'],'Alternate profile photos remain recoverable');
assert.deepEqual(mergedC.personIdAliases,{'profile-a':'profile-c','profile-d':'profile-c'});
const mergedA=mergePersonProfilesMany(multi,multiPeople,['profile-a','profile-d']);
assert.deepEqual(mergedA.extraPeople.map(person=>person.id).sort(),['profile-b','profile-c','profile-a'].sort(),'Unchecked profiles remain unchanged');
assert.equal(mergedA.rows.find(row=>row.id==='chair-d').chairEntityIds[0],'profile-a');
const distinctMulti=structuredClone(multi);decidePersonIdentity(distinctMulti,'profile-c','profile-a','different');
assert.throws(()=>mergePersonProfilesMany(distinctMulti,multiPeople,['profile-c','profile-a','profile-d']),/confirmed as different people/);
assert.deepEqual(distinctMulti.rows,multi.rows,'A blocked merge leaves the original rows unchanged');
const resolvedDistinct=applyPersonIdentityDecision(multi,multiPeople,['profile-c','profile-a','profile-d'],'different');
assert.equal(Object.values(resolvedDistinct.identityDecisions.pairs).filter(value=>value==='different').length,3,'Mark different records every selected pair only');
assert.equal(Object.keys(multi.identityDecisions?.pairs||{}).length,0,'Identity decisions are applied on an isolated project snapshot');
const multiBackup=await readBuilderProjectFile(await createBuilderProjectFile(mergedC));
assert.deepEqual([...multiBackup.peoplePhotos['profile-c'].bytes],[1,2,3]);
assert.deepEqual(multiBackup.mergedPersonPhotos['profile-c'].map(photo=>[photo.name,...photo.bytes]),[['jordan-a.jpg',4,5,6],['jordan-d.jpg',7,8,9]],'Builder backup preserves every alternate photograph byte-for-byte');
const multiReview=identityReviewGroups(multi, multiPeople,{includeResolved:true});
assert.deepEqual(multiReview[0].pairDecisions.map(pair=>pair.decision),['unresolved','unresolved','unresolved','unresolved','unresolved','unresolved']);
assert.throws(()=>mergePersonProfilesMany(multi,multiPeople,['profile-c','profile-a','profile-a']),/more than once/);
assert.deepEqual(multi.extraPeople.map(person=>person.id),['profile-c','profile-a','profile-d','profile-b'],'Invalid multi-merge selection leaves the input untouched');

// Old project ZIPs contain none of the new wizard or merge fields.
const oldProject=structuredClone(initial);delete oldProject.activeStep;delete oldProject.personIdAliases;delete oldProject.personMergeHistory;delete oldProject.identityRegistry.personRecords;delete oldProject.identityRegistry.autoConsolidatedIds;
const restored=await readBuilderProjectFile(await createBuilderProjectFile(oldProject));
assert.equal(restored.rows.length,91);
assert.equal((await buildPackage(restored)).pkg.people.people.length,23);
assert.ok(Object.keys(restored.identityRegistry.personRecords).length>=23,'Legacy name index migrates to ID-centered registry');

console.log('Builder people regressions passed: 91 entries, 18 posters, 23 people, explicit review/merge, re-import and legacy ZIP');

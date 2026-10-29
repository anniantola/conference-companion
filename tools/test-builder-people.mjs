import './test-webcrypto.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCSV,guessMapping,rowsFromMapping} from '../src/builder/importers.js';
import {mergeImportedRows} from '../src/builder/merge.js';
import {buildPackage,packageZip} from '../src/builder/package.js';
import {possiblePersonDuplicates,mergePersonProfiles,mergePersonProfilesMany,identityReviewGroups,decidePersonIdentity,applyIdentityResolutions,applyPersonIdentityDecision} from '../src/builder/people.js';
import {createBuilderProjectFile,readBuilderProjectFile} from '../src/builder/project-file.js';
import {synthetic91Csv,synthetic91Headers} from './synthetic-91-csv.js';
import {describeValidationMessage} from '../src/builder/validation-ui.js';

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

const explicitIdRows=rowsFromMapping([{presenter:'Ada Example',presenter_key:'person-ada',__sourceFileId:'explicit-id.csv',__sourceRow:7}],{speaker:'presenter',speakerId:'presenter_key'});
assert.deepEqual(explicitIdRows[0].speakerEntityIds,['person-ada']);
assert.deepEqual(explicitIdRows[0].personIdentityAssignments.speaker[0],{personId:'person-ada',status:'confirmed'},'Structured spreadsheet IDs become explicit assignments');

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

const posterIdentity=project([
  {id:'poster-north',date:'2031-06-10',start:'09:00',end:'09:30',type:'talk',session:'North',title:'North talk',speaker:'Poster Author',affiliation:'North Institute',location:'Hall A',track:'A'},
  {id:'poster-south',date:'2031-06-10',start:'10:00',end:'10:30',type:'talk',session:'South',title:'South talk',speaker:'Poster Author',affiliation:'South Institute',location:'Hall B',track:'B'},
  {id:'poster-unassigned',date:'2031-06-10',start:'15:00',end:'16:00',type:'poster',session:'Poster Session',title:'Unassigned poster',speaker:'Poster Author',affiliation:'',posterNumber:'P1',location:'Poster Hall',track:'Posters'}
]);
const posterIdentityBuild=await buildPackage(posterIdentity),posterIssue=posterIdentity.rows.find(row=>row.id==='poster-unassigned').personIdentityIssues[0];
assert.deepEqual([posterIssue.role,posterIssue.index],['speaker',0]);
assert.deepEqual(posterIdentityBuild.pkg.programme.posters[0].authorIds,[],'An unresolved poster author is not replaced with a placeholder profile');
const posterMessage=posterIdentityBuild.report.errors.find(message=>message.includes('identity-assignment:poster-unassigned'));
assert.match(describeValidationMessage(posterMessage,posterIdentityBuild.pkg,posterIdentity).text,/Poster author: Poster Author/);

// Profile-level decisions and programme appearance assignments are independent.
const identityState=project([
  {id:'identity-north',date:'2031-06-10',start:'09:00',end:'09:30',type:'talk',session:'North',title:'North appearance',speaker:'Alex Smith',affiliation:'North University',location:'Hall A',track:'A'},
  {id:'identity-south',date:'2031-06-10',start:'10:00',end:'10:30',type:'talk',session:'South',title:'South appearance',speaker:'Alex Smith',affiliation:'South University',location:'Hall B',track:'B'},
  {id:'identity-ambiguous',source:{row:42,fileId:'identity.csv',id:'identity.csv:42'},date:'2031-06-10',start:'11:00',end:'11:30',type:'talk',session:'Methods',title:'Unassigned appearance',speaker:'Alex Smith',affiliation:'',location:'Hall C',track:'C'},
  {id:'identity-chair',date:'2031-06-10',start:'12:00',end:'12:30',type:'talk',session:'Chairs',title:'Chair appearance',speaker:'Other Person',affiliation:'Other University',chair:'Alex Smith',location:'Hall D',track:'D'}
]);
const identityBuilt=await buildPackage(identityState),alexProfiles=identityBuilt.pkg.people.people.filter(person=>person.name==='Alex Smith');
assert.equal(alexProfiles.length,2,'An ambiguous appearance does not create a third ghost profile');
const alexIds=alexProfiles.map(person=>person.id);
identityState.identityDecisions={pairs:{[[...alexIds].sort().join('::')]:'different'}};
for(let iteration=0;iteration<3;iteration++){
  const rebuilt=await buildPackage(identityState);
  assert.equal(rebuilt.pkg.people.people.filter(person=>person.name==='Alex Smith').length,2,'Repeated package builds do not create extra profiles');
  assert.equal(rebuilt.report.warnings.filter(warning=>warning.startsWith('Possible duplicate profiles named "Alex Smith"')).length,0,'Confirmed different profiles do not retain profile-level duplicate warnings');
  assert.deepEqual(identityState.rows.find(row=>row.id==='identity-ambiguous').personIdentityIssues.map(issue=>[issue.role,issue.index]),[['speaker',0]],'The unaffiliated speaker appearance remains independently unresolved');
  assert.deepEqual(identityState.rows.find(row=>row.id==='identity-chair').personIdentityIssues.map(issue=>[issue.role,issue.index]),[['chair',0]],'Resolving one role does not resolve the same name in another role');
  const token=rebuilt.report.errors.find(warning=>warning.startsWith('Person assignment needs review'));
  assert.ok(token?.includes('identity-assignment:identity-ambiguous:speaker:0'),'Blocking validation targets stable row IDs and role slots');
  const described=describeValidationMessage(token,rebuilt.pkg,identityState);
  assert.match(described.text,/Programme row 42: Unassigned appearance/);
  assert.match(described.text,/North University/);
  assert.deepEqual(described.target,{type:'identity-assignment',id:'identity-ambiguous',role:'speaker',index:0});
}
const sourceRows=[];for(let sourceRow=1;sourceRow<=100;sourceRow++){
  const ambiguous=[42,43,44,81,82,83].includes(sourceRow);
  sourceRows.push({id:`large-row-${sourceRow}`,source:{id:`large.csv:${sourceRow}`,fileId:'large.csv',row:sourceRow},date:'2031-06-10',start:`${String(Math.floor((sourceRow-1)/4)+8).padStart(2,'0')}:${['00','15','30','45'][(sourceRow-1)%4]}`,end:`${String(Math.floor((sourceRow-1)/4)+8).padStart(2,'0')}:${['15','30','45','00'][(sourceRow-1)%4]}`,type:'talk',session:`Session ${sourceRow}`,title:`Entry ${sourceRow}`,speaker:ambiguous?'Alex Smith':`Researcher ${sourceRow}`,affiliation:ambiguous?'':`Institute ${sourceRow}`,location:`Hall ${sourceRow%5}`,track:`Track ${sourceRow%4}`});
}
const largeIdentities=project(sourceRows);largeIdentities.extraPeople=[{id:'alex-north',name:'Alex Smith',affiliation:'North University'},{id:'alex-south',name:'Alex Smith',affiliation:'South University'}];
const largeBuilt=await buildPackage(largeIdentities),expectedIssues=[42,43,44,81,82,83].map(sourceRow=>`identity-assignment:large-row-${sourceRow}:speaker:0`);
const identityErrorTokens=largeBuilt.report.errors.filter(message=>message.startsWith('Person assignment needs review')).map(message=>message.match(/\[([^\]]+)\]/)?.[1]);
assert.deepEqual(identityErrorTokens,expectedIssues,'All six source rows are independently identified by stable Builder row IDs');
for(const sourceRow of [42,43,44,81,82,83]){
  const row=largeIdentities.rows.find(item=>item.source.row===sourceRow),message=`Person assignment needs review [identity-assignment:${encodeURIComponent(row.id)}:speaker:0]`,described=describeValidationMessage(message,largeBuilt.pkg,largeIdentities);
  assert.equal(described.target.id,row.id);assert.match(described.text,new RegExp(`Programme row ${sourceRow}: Entry ${sourceRow}`));
}
largeIdentities.rows.find(row=>row.source.row===43).speakerEntityIds=['alex-north'];largeIdentities.rows.find(row=>row.source.row===43).personIdentityAssignments={speaker:{0:{personId:'alex-north',status:'confirmed'}}};
assert.equal((await buildPackage(largeIdentities)).report.errors.filter(message=>message.startsWith('Person assignment needs review')).length,5,'Resolving one of many ambiguous rows leaves only the other five');
identityState.rows.find(row=>row.id==='identity-ambiguous').speakerEntityIds=[alexIds[1]];
identityState.rows.find(row=>row.id==='identity-ambiguous').personIdentityAssignments={speaker:{0:{personId:alexIds[1],status:'confirmed'}}};
const explicitlyResolved=await buildPackage(identityState);
assert.equal(identityState.rows.find(row=>row.id==='identity-ambiguous').personIdentityIssues.length,0);
assert.equal(explicitlyResolved.report.errors.filter(warning=>warning.startsWith('Person assignment needs review')).length,1,'Only the separate chair assignment remains unresolved');
identityState.rows.find(row=>row.id==='identity-chair').chairEntityIds=[alexIds[0]];
identityState.rows.find(row=>row.id==='identity-chair').personIdentityAssignments.chair={0:{personId:alexIds[0],status:'confirmed'}};
for(let iteration=0;iteration<3;iteration++){
  const rebuilt=await buildPackage(identityState);
  assert.equal(rebuilt.report.errors.filter(warning=>warning.startsWith('Person assignment needs review')).length,0,'Confirmed row assignments stay resolved on every rebuild');
  assert.equal(identityState.rows.find(row=>row.id==='identity-ambiguous').speakerEntityIds[0],alexIds[1]);
}
const identityBackup=await readBuilderProjectFile(await createBuilderProjectFile(identityState));
const restoredIdentity=await buildPackage(identityBackup);
assert.equal(identityReviewGroups(identityBackup,restoredIdentity.pkg.people.people).length,0,'Confirmed profile distinctions survive Builder backup restoration');
assert.equal(identityBackup.rows.find(row=>row.id==='identity-ambiguous').personIdentityAssignments.speaker[0].personId,alexIds[1],'Confirmed programme assignments survive Builder backup restoration');
const malformedAssignment=structuredClone(identityState);malformedAssignment.rows.find(row=>row.id==='identity-ambiguous').personIdentityAssignments.speaker[0].status='guessed';
await assert.rejects(async()=>readBuilderProjectFile(await createBuilderProjectFile(malformedAssignment)),/invalid row .* speaker assignment/,'Malformed persisted assignment state is rejected instead of silently restored');

// A confirmed appearance assignment remains attached to the same matching row after re-import.
const assignmentRow={id:'stable-assignment',title:'Stable assignment',date:'2031-06-10',start:'13:00',end:'13:30',type:'talk',session:'Stable',speaker:'Alex Smith',speakerEntityIds:[alexIds[1]],personIdentityAssignments:{speaker:{0:{personId:alexIds[1],status:'confirmed'}}},source:{id:'first.csv:2',fileId:'first.csv',row:2,raw:{title:'Stable assignment',date:'2031-06-10',start:'13:00',end:'13:30',type:'talk',session:'Stable',speaker:'Alex Smith',location:'Hall E',track:'E'}}};
const revisedAssignment={...structuredClone(assignmentRow),source:{id:'second.xlsx:3',fileId:'second.xlsx',row:3,raw:{title:'Stable assignment',date:'2031-06-10',start:'13:00',end:'13:30',type:'talk',session:'Stable',speaker:'Alex Smith',location:'Hall E',track:'E'}},speakerEntityIds:[],personIdentityAssignments:{}};
const reconciledAssignment=mergeImportedRows([assignmentRow],[revisedAssignment]).rows[0];
assert.equal(reconciledAssignment.personIdentityAssignments.speaker[0].personId,alexIds[1]);
assert.equal((await buildPackage(project([reconciledAssignment]))).pkg.programme.presentations[0].speakerIds[0],alexIds[1]);

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

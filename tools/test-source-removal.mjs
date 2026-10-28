import './test-webcrypto.mjs';
import assert from 'node:assert/strict';
import {prepareClearImportedProgramme,prepareSourceRemoval} from '../src/builder/source-removal.js';
import {classifyProgrammeRows,resolveRowProvenance} from '../src/builder/source-provenance.js';

const sourceA={id:'source-a',name:'schedule.csv'},sourceB={id:'source-b',name:'revision.xlsx'};
const row=(id,title,fields={})=>({id,entityId:`presentation-${id}`,calendarUid:`urn:uuid:${id}`,date:'2032-08-10',start:'09:00',end:'09:30',type:'talk',session:'Methods',title,speaker:'Alex Researcher',chair:'',affiliation:'North Lab',location:'Room A',track:'North',posterNumber:'',abstract:'',doi:'',...fields});
const source=(id,fileId,extra={})=>({id,fileId,contributors:[fileId],sources:[{id,fileId,...extra}],sourceRecords:[id],...extra});
function fixture({last=false}={}){
  const first=row('one','Manual correction',{source:source('source-a:CSV:2','source-a',{row:2,matchData:{title:'Imported title'}}),manualFields:{title:true},speakerEntityIds:['person-alex']});
  const poster={...row('poster','Poster Alpha',{date:'2032-08-10',start:'12:00',end:'13:00',type:'poster',session:'Afternoon posters',title:'Poster Alpha',speaker:'Bea Poster',affiliation:'Poster Lab',location:'Poster Hall',posterNumber:'P1',speakerEntityIds:['person-bea'],source:source('source-a:CSV:4','source-a',{row:4})}),posterSessionId:'poster-session-a',posterSessionCalendarUid:'urn:uuid:poster-session-a'};
  const posterTwo={...row('poster-two','Poster Beta',{date:'2032-08-11',start:'14:00',end:'15:00',type:'poster',session:'Evening posters',title:'Poster Beta',speaker:'Dee Poster',affiliation:'Second Poster Lab',location:'Gallery Hall',posterNumber:'Q2',speakerEntityIds:['person-dee'],source:source('source-a:CSV:5','source-a',{row:5})}),posterSessionId:'poster-session-b',posterSessionCalendarUid:'urn:uuid:poster-session-b'};
  const shared=row('shared','Shared talk',{speaker:'Casey Shared',affiliation:'Shared Lab',speakerEntityIds:['person-casey'],source:{id:'source-a:CSV:3',fileId:'source-a',row:3,raw:{title:'Source A raw row'},matchData:{title:'Source A original'},contributors:['source-a','source-b'],sources:[{id:'source-a:CSV:3',fileId:'source-a',row:3},{id:'source-b:Schedule:8',fileId:'source-b',sheet:'Schedule',row:8}],sourceRecords:['source-a:CSV:3','source-b:Schedule:8']}});
  const manual=row('manual','Organizer-created social',{type:'social',session:'Social',title:'Organizer-created social',speaker:'',affiliation:'',location:'Offsite',track:'Common',source:undefined,manualEdited:true,manuallyCreated:true});
  const rows=last?[first,poster,posterTwo,manual]:[first,poster,posterTwo,shared,manual];
  const sourceFiles=last?[sourceA]:[sourceA,sourceB];
  return {conference:{id:'synthetic',name:'Synthetic',shortName:'SYN',startDate:'2032-08-10',endDate:'2032-08-11',timezone:'Europe/Helsinki',venueName:'Main venue'},rows,sourceFiles,sourceState:[{fileId:'source-a',sourceId:'source-a:CSV:2',raw:{title:'Imported title'}},{fileId:'source-a',sourceId:'source-a:CSV:5',raw:{title:'Poster Beta'}},{fileId:'source-b',sourceId:'source-b:Schedule:8',raw:{title:'Shared talk'}}],reimportConflicts:['source-a:CSV:2: source changed title'],deletedSourceIds:[],extraPeople:[{id:'person-manual',name:'Manually added person',affiliation:'Independent'}],extraLocations:[{id:'location-manual',name:'Manual room',type:'room'}],peopleOverrides:{'person-alex':{position:'Organizer-edited'}},peoplePhotos:{'person-alex':{name:'alex.png',type:'image/png',bytes:new Uint8Array([1,2,3])}},identityRegistry:{people:{'alex researcher|north lab':'person-alex','bea poster|poster lab':'person-bea','dee poster|second poster lab':'person-dee','casey shared|shared lab':'person-casey'},personRecords:{'person-alex':{id:'person-alex',names:['alex researcher'],affiliations:['north lab'],explicitIds:[]},'person-bea':{id:'person-bea',names:['bea poster'],affiliations:['poster lab'],explicitIds:[]},'person-dee':{id:'person-dee',names:['dee poster'],affiliations:['second poster lab'],explicitIds:[]},'person-casey':{id:'person-casey',names:['casey shared'],affiliations:['shared lab'],explicitIds:[]}},locations:{},tracks:{}},identityDecisions:{pairs:{}},sessionOverrides:{'poster-session-a':{title:'Organizer poster override'},'poster-session-b':{title:'Second poster override'}},locationOverrides:{'loc-old':{name:'Old room'}},branding:{primary:'#123456',secondary:'#234567',accent:'#123456',trackColors:{old:' #123456'},locationColors:{'loc-old':'#123456'}},features:{},dataVersion:1};
}

const dataRemoval=await prepareSourceRemoval(fixture(),'source-a','remove-associated');
assert.deepEqual(dataRemoval.project.rows.map(item=>item.id).sort(),['manual','shared']);
assert.equal(dataRemoval.project.sourceFiles.length,1);
assert.equal(dataRemoval.project.rows.find(item=>item.id==='shared').source.fileId,'source-b');
assert.ok(dataRemoval.project.rows.find(item=>item.id==='shared').source.id.startsWith('source-b:'),'Primary source identity follows the remaining contributor');
assert.deepEqual(dataRemoval.project.rows.find(item=>item.id==='shared').source.contributors,['source-b']);
assert.ok(!dataRemoval.project.rows.find(item=>item.id==='shared').source.sources.some(item=>item.fileId==='source-a'));
assert.equal(dataRemoval.project.rows.find(item=>item.id==='shared').source.raw,undefined,'Primary-source raw data from the removed source is cleared');
assert.equal(dataRemoval.project.rows.find(item=>item.id==='shared').source.matchData,undefined,'Primary-source matching data from the removed source is cleared');
assert.ok(dataRemoval.impact.programmeEntriesToDelete===3&&dataRemoval.impact.manuallyEditedEntriesAffected===1);
assert.equal(dataRemoval.impact.entriesRetainedByOtherSources,1);
assert.equal(dataRemoval.impact.postersAffected,2);
assert.equal(dataRemoval.impact.posterSessionsDisappearing,2);
assert.ok(!dataRemoval.project.sourceState.some(item=>item.fileId==='source-a'));
assert.ok(dataRemoval.project.reimportConflicts.every(message=>!message.includes('source-a')));
assert.ok(!dataRemoval.project.identityRegistry.personRecords['person-bea'],'Poster-only person identity is pruned');
assert.ok(!dataRemoval.project.identityRegistry.personRecords['person-dee'],'Identity for a second poster session is pruned');
assert.ok(dataRemoval.project.identityRegistry.personRecords['person-casey'],'Person referenced by another source remains');
assert.equal(dataRemoval.project.peoplePhotos['person-alex'],undefined,'Deleted programme contributor photo metadata is not left dangling');
assert.ok(dataRemoval.project.extraPeople.some(person=>person.id==='person-manual'));
assert.ok(dataRemoval.project.extraLocations.some(location=>location.id==='location-manual'));

const preserve=await prepareSourceRemoval(fixture(),'source-a','preserve-edited');
const preserved=preserve.project.rows.find(item=>item.id==='one');
assert.ok(preserved,'Corrected exclusive entry remains when the organizer chooses preservation');
assert.equal(preserved.manuallyMaintained,true);
assert.equal(preserved.source,undefined,'No dangling source provenance remains');
assert.equal(preserved.id,'one');assert.equal(preserved.calendarUid,'urn:uuid:one');assert.equal(preserved.title,'Manual correction');
assert.equal(preserve.impact.programmeEntriesToDelete,2);
assert.equal(preserve.impact.entriesRetainedAsManual,1);
assert.equal(preserve.impact.manuallyEditedEntriesAffected,1);
assert.ok(preserve.project.peoplePhotos['person-alex'],'Preserved profile photograph remains with the retained person\'s reference');

const lastSource=await prepareSourceRemoval(fixture({last:true}),'source-a','remove-associated');
assert.deepEqual(lastSource.project.rows.map(item=>item.id),['manual']);
assert.equal(lastSource.package.programme.presentations.length,0);
assert.equal(lastSource.package.programme.posters.length,0);
assert.equal(lastSource.package.programme.sessions.length,1,'Only the manually created social event remains');
assert.ok(!lastSource.package.people.people.some(person=>person.id==='person-alex'||person.id==='person-bea'));
assert.ok(lastSource.package.people.people.some(person=>person.id==='person-manual'));
assert.equal(lastSource.package.locations.locations.some(location=>location.name==='Poster Hall'),false);
assert.equal(lastSource.package.programme.tracks.some(track=>track.name==='North'),false);
assert.equal(lastSource.project.conference.name,'Synthetic');

// Historical projects lost or partially migrated row.source metadata. Recover
// association from sourceState using mapped content, including a corrected title.
const legacy=fixture({last:true});legacy.rows[0].source=undefined;legacy.sourceState=[{fileId:'source-a',sourceId:'legacy-upload:CSV:2',mapping:{title:'Title',date:'Date',start:'From',end:'To',session:'Session',speaker:'Presenter',affiliation:'Institute',location:'Room',track:'Track',type:'Kind'},raw:{Title:'Imported title',Date:'2032-08-10',From:'09:00',To:'09:30',Session:'Methods',Presenter:'Alex Researcher',Institute:'North Lab',Room:'Room A',Track:'North',Kind:'talk'}}];
assert.deepEqual(resolveRowProvenance(legacy,legacy.rows[0]).sourceIds,['source-a'],'legacy file identifier alias resolves through sourceState');
const recovered=await prepareSourceRemoval(legacy,'source-a','remove-associated');
assert.ok(!recovered.project.rows.some(item=>item.id==='one'),'manual correction does not hide its recovered imported origin');
assert.deepEqual(recovered.project.rows.map(item=>item.id),['manual']);
assert.equal(recovered.project.sourceFiles.length,0);
assert.equal(recovered.project.sourceState.length,0);
assert.ok(!recovered.package.people.people.some(item=>item.name==='Alex Researcher'));

// Some early project exports stored import journals as keyed objects and
// attached source references directly to a row rather than row.source.
const objectJournal=fixture({last:true});objectJournal.rows[0].source=undefined;objectJournal.sourceState={'source-a:CSV:2':{fileId:'source-a',sourceId:'source-a:CSV:2',raw:{date:'2032-08-10',start:'09:00',end:'09:30',type:'talk',session:'Methods',title:'Manual correction',speaker:'Alex Researcher',affiliation:'North Lab',location:'Room A',track:'North'}}};
const objectJournalResult=await prepareSourceRemoval(objectJournal,'source-a','remove-associated');
assert.deepEqual(objectJournalResult.project.rows.map(item=>item.id),['manual'],'object-form journals recover corrected rows and remove them');
const rootRefs=fixture({last:true});rootRefs.rows[0].source=undefined;rootRefs.rows[0].sources=['source-a'];
assert.deepEqual(resolveRowProvenance(rootRefs,rootRefs.rows[0]).sourceIds,['source-a'],'root-level historical source lists are recognized');

// source.id plus historical sourceState are recognized even when contributors
// and fileId are absent, while an explicit manual record remains untouched.
const legacyRefs=fixture({last:true});legacyRefs.rows[0].source={id:'old-export:CSV:2',row:2};
legacyRefs.sourceState=[{fileId:'source-a',sourceId:'old-export:CSV:2',raw:{date:'2032-08-10',start:'09:00',end:'09:30',type:'talk',session:'Methods',title:'Manual correction',speaker:'Alex Researcher',affiliation:'North Lab',location:'Room A',track:'North'}}];
const migrated=await prepareSourceRemoval(legacyRefs,'source-a','remove-associated');
assert.ok(!migrated.project.rows.some(item=>item.id==='one'),'historical source IDs migrate idempotently for deletion');
const migratedAgain=await prepareSourceRemoval(migrated.project,'source-a','remove-associated').catch(error=>error);
assert.ok(migratedAgain instanceof Error,'repeating removal after successful removal cannot resurrect or re-remove rows');

// Clear-all previews uncertainty, forces an explicit keep/delete choice, and
// keeps confirmed manual content and organizer configuration.
const uncertain=fixture({last:true});uncertain.rows.push(row('orphan','Legacy orphan',{source:undefined}),row('ambiguous','Uncertain old row',{source:undefined}));
uncertain.rows.find(item=>item.id==='ambiguous').manuallyCreated=true;uncertain.rows.find(item=>item.id==='ambiguous').speaker='';uncertain.rows.find(item=>item.id==='ambiguous').speakerEntityIds=[];
const clearPreview=await prepareClearImportedProgramme(uncertain,null);
assert.equal(clearPreview.impact.importedEntriesToDelete,3);
assert.equal(clearPreview.impact.orphanedEntriesUncertain,1);
assert.equal(clearPreview.impact.manualEntriesRetained,2);
await assert.rejects(()=>prepareClearImportedProgramme(uncertain,{}),/Choose whether to delete or keep/);
const clear=await prepareClearImportedProgramme(uncertain,{orphan:'delete'});
assert.deepEqual(clear.project.rows.map(item=>item.id),['manual','ambiguous']);
assert.equal(clear.project.rows.find(item=>item.id==='ambiguous').manuallyCreated,true);
assert.equal(clear.project.sourceFiles.length,0);assert.equal(clear.project.sourceState.length,0);
assert.equal(clear.project.conference.name,'Synthetic');
assert.ok(!clear.package.people.people.some(item=>['Alex Researcher','Bea Poster','Dee Poster'].includes(item.name)));
assert.ok(clear.package.people.people.some(item=>item.id==='person-manual'));
assert.equal(classifyProgrammeRows(clear.project).find(item=>item.row.id==='ambiguous').origin,'manual');
console.log('Source-removal transactions passed: both policies, shared provenance, IDs/UIDs, stale identities, posters and last-source cleanup.');

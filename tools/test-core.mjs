import assert from 'node:assert/strict';
import {installWebCrypto} from './test-webcrypto.mjs';
import fs from 'node:fs';
import {createConferenceModel} from '../src/model.js';
import {validatePackage} from '../src/validation.js';
import {buildICS,calendarUidForEntity} from '../src/calendar.js';
import {profileToVCard,parseVCard,compactProfileVCard} from '../src/vcard.js';
import {qrMatrix} from '../src/qrcode.js';
import {createStoredZip,readStoredZip,textEntry} from '../src/zip.js';
import {createPersonalBackup,parsePersonalBackup} from '../src/backup.js';
import {buildPackage} from '../src/builder/package.js';
import {validateJsonSchema} from '../src/json-schema.js';
import {migratePackage,CURRENT_SCHEMA_VERSION} from '../src/migrations.js';
import {normalizeExternalLink,normalizeOrcid,normalizeWebUrl} from '../src/safe-url.js';
import {encodeStoredValue,decodeStoredValue} from '../src/user-store.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../conference/${name}`,import.meta.url),'utf8'));
const pkg={manifest:read('conference-manifest.json'),conference:read('conference.json'),programme:read('programme.json'),people:read('people.json'),locations:read('locations.json'),branding:read('branding.json')};
const report=validatePackage(pkg,{strictCalendarUid:true});
if(report.errors.length)throw new Error(report.errors.join('; '));

// Exercise both runtime branches even when running under Node 22.
const missingCrypto={};
installWebCrypto(missingCrypto);
assert.equal(typeof missingCrypto.crypto.randomUUID,'function');
assert.equal(typeof missingCrypto.crypto.subtle.digest,'function');
const nativeCrypto={crypto:globalThis.crypto};
installWebCrypto(nativeCrypto);
assert.equal(nativeCrypto.crypto,globalThis.crypto,'Keep the native Web Crypto implementation');
const generatedUids=Array.from({length:100},()=>calendarUidForEntity('same-entity'));
assert.equal(new Set(generatedUids).size,generatedUids.length,'Each new calendar UID must be unique');
for(const value of generatedUids) assert.match(value,/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const uid=calendarUidForEntity('talk-233',{id:'neuronics-2027',officialWebsite:'https://app.neuronics2027.org'});
if(!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid))throw new Error('Calendar UID must be a UUIDv4 URN');
const conferenceSchema=JSON.parse(fs.readFileSync(new URL('../schemas/conference.schema.json',import.meta.url),'utf8'));
if(validateJsonSchema(pkg.conference,conferenceSchema,'conference').length)throw new Error('Runtime JSON Schema validator rejected valid conference data');
const migrated=migratePackage(pkg);if(migrated.manifest.schemaVersion!==CURRENT_SCHEMA_VERSION)throw new Error('Schema migration contract failed');

const model=createConferenceModel(pkg);
if(!model.items.length||!model.days.length)throw new Error('Model did not create programme items/days');
if(model.items.some(x=>!x.sessionId||!x.rawSession))throw new Error('Model projection lost canonical session references');
const ics=buildICS({conference:pkg.conference,manifest:pkg.manifest,items:model.calendarItems(),locationLabel:id=>model.location(id)?.name||id});
if(!ics.includes('BEGIN:VTIMEZONE')||!ics.includes('BEGIN:VEVENT')||!ics.includes('UID:'))throw new Error('ICS contract incomplete');
const helsinkiIcs=buildICS({conference:{...pkg.conference,name:'DST Test',timezone:'Europe/Helsinki',startDate:'2027-03-27',endDate:'2027-03-29'},manifest:pkg.manifest,items:[{id:'dst',calendarUid:'dst@example.org',date:'2027-03-28',start:'10:00',end:'11:00',title:'DST event'}],locationLabel:()=>''});
if(!helsinkiIcs.includes('TZID:Europe/Helsinki')||!helsinkiIcs.includes('BEGIN:DAYLIGHT'))throw new Error('Timezone/DST calendar regression failed');

const readFixture=name=>JSON.parse(fs.readFileSync(new URL(`../fixtures/multi-track-no-posters/${name}`,import.meta.url),'utf8'));
const fixture={manifest:readFixture('conference-manifest.json'),conference:readFixture('conference.json'),programme:readFixture('programme.json'),people:readFixture('people.json'),locations:readFixture('locations.json'),branding:readFixture('branding.json')};
const fixtureModel=createConferenceModel(fixture);
if(fixtureModel.posters.length!==0||fixtureModel.trackById.size<3||fixtureModel.days.length<2)throw new Error('Generic unrelated fixture did not render through the canonical model');
if(fixture.conference.timezone===pkg.conference.timezone)throw new Error('Fixtures must use distinct IANA timezones');
if(fixture.conference.city===pkg.conference.city)throw new Error('Fixtures must use distinct cities');
if(JSON.stringify(fixture.locations)===JSON.stringify(pkg.locations)||JSON.stringify(fixture.people)===JSON.stringify(pkg.people)||JSON.stringify(fixture.branding)===JSON.stringify(pkg.branding))throw new Error('Fixtures must differ in venues, people and branding');
if(new Set(fixture.locations.locations.filter(x=>x.type==='venue').map(x=>x.id)).size<2)throw new Error('Unrelated fixture must include multiple venues');
if(fixtureModel.items.some(x=>!x.locationId||!fixtureModel.location(x.locationId)))throw new Error('Unrelated fixture lost location references');

const profile={name:'Ada Example',position:'Researcher',affiliation:'Example University',email:'ada@example.org',orcid:'0000-0000-0000-0001',website:'https://example.org'};
const card=profileToVCard(profile),parsed=parseVCard(card);if(parsed.name!==profile.name||parsed.email!==profile.email)throw new Error('vCard round trip failed');
assert.equal(normalizeWebUrl('javascript:alert(1)'),'');
assert.equal(normalizeWebUrl('https://example.org/research'),'https://example.org/research');
assert.equal(normalizeExternalLink('mailto:ada@example.org'),'mailto:ada@example.org');
assert.equal(normalizeWebUrl('10.1234/example.doi'),'https://doi.org/10.1234/example.doi');
assert.equal(normalizeOrcid('https://orcid.org/0000-0000-0000-0001'),'0000-0000-0000-0001');
assert.throws(()=>parseVCard('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Unsafe\r\nURL:javascript:alert(1)\r\nEND:VCARD'));
const compact=compactProfileVCard(profile);const matrix=qrMatrix(compact);if(matrix.length<21||matrix.some(row=>row.some(v=>typeof v!=='boolean')))throw new Error('QR matrix invalid');
const zip=createStoredZip([{name:'a.txt',data:'hello'},{name:'b.txt',data:'world'}]);const entries=await readStoredZip(zip);if(textEntry(entries,'a.txt')!=='hello'||textEntry(entries,'b.txt')!=='world')throw new Error('ZIP round trip failed');
const storedBinary=await encodeStoredValue({profile:{photoBlob:new Blob(['pilot-image'],{type:'image/png'})},photos:[new File(['thumb'],'thumb.png',{type:'image/png'})]});
if(storedBinary.profile.photoBlob instanceof Blob||!(storedBinary.profile.photoBlob.bytes instanceof Uint8Array))throw new Error('IndexedDB storage must encode Blob content as bytes');
const restoredBinary=decodeStoredValue(storedBinary);if(!(restoredBinary.profile.photoBlob instanceof Blob)||await restoredBinary.profile.photoBlob.text()!=='pilot-image'||!(restoredBinary.photos[0] instanceof Blob)||restoredBinary.photos[0].type!=='image/png')throw new Error('IndexedDB binary compatibility round trip failed');

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const backupBlob=await createPersonalBackup({conferenceId:'demo',state:{favorites:['x'],notes:{}},profile:{name:'Ada',photoBlob:new Blob([png],{type:'image/png'})},friends:[],photos:[]});
const parsedBackup=await parsePersonalBackup(backupBlob);if(parsedBackup.payload.profile.name!=='Ada'||!(parsedBackup.payload.profile.photoBlob instanceof Blob))throw new Error('Personal backup profile-photo round trip failed');
const brokenZip=createStoredZip([{name:'backup.json',data:JSON.stringify({format:'conference-companion-backup',version:3,conferenceId:'demo',state:{},profile:{},friends:[],photos:[{id:1,file:'photos/00000001.png',type:'image/png',ownerType:'event',ownerId:'x'}]})}]);
await assert.rejects(()=>parsePersonalBackup(brokenZip),/missing/);
const corruptedPhotoZip=createStoredZip([
  {name:'backup.json',data:JSON.stringify({format:'conference-companion-backup',version:3,conferenceId:'demo',state:{},profile:{},friends:[],photos:[{id:1,file:'photos/00000001.png',type:'image/png',ownerType:'event',ownerId:'x'}]})},
  {name:'photos/00000001.png',data:new Uint8Array([1,2,3,4])}
]);
await assert.rejects(()=>parsePersonalBackup(corruptedPhotoZip),/corrupted/);
const unsafeBackup={format:'conference-companion-backup',version:3,conferenceId:'demo',state:{},profile:{name:'Bad URL',website:'javascript:alert(1)'},friends:[],photos:[]};
await assert.rejects(()=>parsePersonalBackup(new File([JSON.stringify(unsafeBackup)],'unsafe.json',{type:'application/json'})),/HTTPS URL/);

const builderProject={conference:{name:'Identity Test',shortName:'Identity Test',startDate:'2027-05-01',endDate:'2027-05-01',timezone:'Europe/Helsinki',venueName:'Venue'},rows:[{id:'row-1',date:'2027-05-01',start:'10:00',end:'10:30',type:'talk',session:'Session A',title:'Original title',speaker:'Person A',affiliation:'Lab',location:'Room A',track:'Track A'}],features:{},branding:{primary:'#000000',secondary:'#222222',accent:'#000000',trackColors:{},locationColors:{}},identityRegistry:{people:{},locations:{},tracks:{}},dataVersion:1,lastPublishedVersion:0,changelog:[]};
const built1=await buildPackage(builderProject);if(built1.report.errors.length)throw new Error(built1.report.errors.join('; '));
const ids1={conference:built1.pkg.conference.id,presentation:built1.pkg.programme.presentations[0].id,calendar:built1.pkg.programme.presentations[0].calendarUid,location:built1.pkg.programme.sessions[0].locationId,person:built1.pkg.programme.presentations[0].speakerIds[0]};
builderProject.rows[0].title='Corrected title';builderProject.rows[0].location='Renamed Room';builderProject.rows[0].speaker='Corrected Person';
const built2=await buildPackage(builderProject);const ids2={conference:built2.pkg.conference.id,presentation:built2.pkg.programme.presentations[0].id,calendar:built2.pkg.programme.presentations[0].calendarUid,location:built2.pkg.programme.sessions[0].locationId,person:built2.pkg.programme.presentations[0].speakerIds[0]};
if(JSON.stringify(ids1)!==JSON.stringify(ids2))throw new Error('Builder immutable entity identities changed after content edits');
builderProject.lastPublishedVersion=1;builderProject.dataVersion=1;const badVersion=await buildPackage(builderProject);if(!badVersion.report.errors.some(x=>x.includes('last published version')))throw new Error('Builder did not block non-monotonic dataVersion');


const cascadeProject={
  conference:{id:'cascade-demo',name:'Cascade Demo',shortName:'Cascade',startDate:'2027-05-01',endDate:'2027-05-01',timezone:'Europe/Helsinki',officialWebsite:'https://cascade.example.org',venueName:'Venue'},
  rows:[
    {id:'row-a',date:'2027-05-01',start:'10:00',end:'10:20',type:'talk',session:'Session A',title:'Talk A',speaker:'Person A',affiliation:'Lab',location:'Room A',track:'Track A'},
    {id:'row-b',date:'2027-05-01',start:'10:20',end:'10:40',type:'talk',session:'Session A',title:'Talk B',speaker:'Person B',affiliation:'Lab',location:'Room A',track:'Track A'}
  ],
  features:{},branding:{primary:'#000000',secondary:'#222222',accent:'#000000',trackColors:{},locationColors:{}},identityRegistry:{people:{},locations:{},tracks:{}},sessionOverrides:{},extraLocations:[{id:'room-b',type:'room',name:'Room B',parentLocationId:'venue-main'}],dataVersion:1,lastPublishedVersion:0,changelog:[]
};
const cascade1=await buildPackage(cascadeProject);if(cascade1.report.errors.length)throw new Error(cascade1.report.errors.join('; '));
const sessionA=cascade1.pkg.programme.sessions.find(x=>x.presentationIds?.length===2);if(!sessionA)throw new Error('Cascade test session not built');
cascadeProject.sessionOverrides[sessionA.id]={locationId:'room-b',sequenceBump:1};
const cascade2=await buildPackage(cascadeProject);if(cascade2.report.errors.length)throw new Error(cascade2.report.errors.join('; '));
const changed=cascade2.pkg.programme.sessions.find(x=>x.id===sessionA.id);if(changed.locationId!=='room-b')throw new Error('Session-level room override did not apply');
const childIds=new Set(changed.presentationIds);const children=cascade2.pkg.programme.presentations.filter(x=>childIds.has(x.id));if(children.length!==2||children.some(x=>x.sequence<1))throw new Error('Session room change did not cascade calendar SEQUENCE to child presentations');
const cascadeModel=createConferenceModel(cascade2.pkg);if(cascadeModel.items.filter(x=>childIds.has(x.id)).some(x=>x.locationId!=='room-b'))throw new Error('Session room change did not cascade to rendered child items');
if(children.some(x=>!/^urn:uuid:[0-9a-f-]{36}$/i.test(String(x.calendarUid))))throw new Error('Builder calendar UIDs must be UUID URNs');

console.log('Core tests OK');

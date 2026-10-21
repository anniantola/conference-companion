import fs from 'node:fs';
import {createConferenceModel} from '../src/model.js';
import {validatePackage} from '../src/validation.js';
import {buildICS} from '../src/calendar.js';
import {profileToVCard,parseVCard,compactProfileVCard} from '../src/vcard.js';
import {qrMatrix} from '../src/qrcode.js';
import {createStoredZip,readStoredZip,textEntry} from '../src/zip.js';
import {createPersonalBackup,parsePersonalBackup} from '../src/backup.js';
import {buildPackage} from '../src/builder/package.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../conference/${name}`,import.meta.url),'utf8'));
const pkg={manifest:read('conference-manifest.json'),conference:read('conference.json'),programme:read('programme.json'),people:read('people.json'),locations:read('locations.json'),branding:read('branding.json')};
const report=validatePackage(pkg,{strictCalendarUid:true});
if(report.errors.length)throw new Error(report.errors.join('; '));
const model=createConferenceModel(pkg);
if(!model.items.length||!model.days.length)throw new Error('Model did not create programme items/days');
if(model.items.some(x=>!x.sessionId||!x.rawSession))throw new Error('Model projection lost canonical session references');
const ics=buildICS({conference:pkg.conference,manifest:pkg.manifest,items:model.calendarItems(),locationLabel:id=>model.location(id)?.name||id});
if(!ics.includes('BEGIN:VTIMEZONE')||!ics.includes('BEGIN:VEVENT')||!ics.includes('UID:urn:uuid:'))throw new Error('ICS contract incomplete');
const profile={name:'Ada Example',position:'Researcher',affiliation:'Example University',email:'ada@example.org',orcid:'0000-0000-0000-0001',website:'https://example.org'};
const card=profileToVCard(profile),parsed=parseVCard(card);if(parsed.name!==profile.name||parsed.email!==profile.email)throw new Error('vCard round trip failed');
const compact=compactProfileVCard(profile);const matrix=qrMatrix(compact);if(matrix.length<21||matrix.some(row=>row.some(v=>typeof v!=='boolean')))throw new Error('QR matrix invalid');
const zip=createStoredZip([{name:'a.txt',data:'hello'},{name:'b.txt',data:'world'}]);const entries=await readStoredZip(zip);if(textEntry(entries,'a.txt')!=='hello'||textEntry(entries,'b.txt')!=='world')throw new Error('ZIP round trip failed');

const backupBlob=await createPersonalBackup({conferenceId:'demo',state:{favorites:['x'],notes:{}},profile:{name:'Ada',photoBlob:new Blob([new Uint8Array([1,2,3])],{type:'image/png'})},friends:[],photos:[]});
const parsedBackup=await parsePersonalBackup(backupBlob);if(parsedBackup.payload.profile.name!=='Ada'||!(parsedBackup.payload.profile.photoBlob instanceof Blob))throw new Error('Personal backup profile-photo round trip failed');

const builderProject={conference:{name:'Identity Test',shortName:'Identity Test',startDate:'2027-05-01',endDate:'2027-05-01',timezone:'Europe/Helsinki',venueName:'Venue'},rows:[{id:'row-1',date:'2027-05-01',start:'10:00',end:'10:30',type:'talk',session:'Session A',title:'Original title',speaker:'Person A',affiliation:'Lab',location:'Room A',track:'Track A'}],features:{},branding:{primary:'#000000',secondary:'#222222',accent:'#000000',trackColors:{},locationColors:{}},identityRegistry:{people:{},locations:{},tracks:{}},dataVersion:1,lastPublishedVersion:0,changelog:[]};
const built1=await buildPackage(builderProject);if(built1.report.errors.length)throw new Error(built1.report.errors.join('; '));
const ids1={conference:built1.pkg.conference.id,presentation:built1.pkg.programme.presentations[0].id,calendar:built1.pkg.programme.presentations[0].calendarUid,location:built1.pkg.programme.sessions[0].locationId,person:built1.pkg.programme.presentations[0].speakerIds[0]};
builderProject.rows[0].title='Corrected title';builderProject.rows[0].location='Renamed Room';builderProject.rows[0].speaker='Corrected Person';
const built2=await buildPackage(builderProject);const ids2={conference:built2.pkg.conference.id,presentation:built2.pkg.programme.presentations[0].id,calendar:built2.pkg.programme.presentations[0].calendarUid,location:built2.pkg.programme.sessions[0].locationId,person:built2.pkg.programme.presentations[0].speakerIds[0]};
if(JSON.stringify(ids1)!==JSON.stringify(ids2))throw new Error('Builder immutable entity identities changed after content edits');
builderProject.lastPublishedVersion=1;builderProject.dataVersion=1;const badVersion=await buildPackage(builderProject);if(!badVersion.report.errors.some(x=>x.includes('last published version')))throw new Error('Builder did not block non-monotonic dataVersion');

console.log('Core tests OK');

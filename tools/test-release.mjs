import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createConferenceModel} from '../src/model.js';
import {validatePackage} from '../src/validation.js';
import {buildICS} from '../src/calendar.js';

function load(directory){const get=n=>JSON.parse(fs.readFileSync(`${directory}/${n}.json`,'utf8'));return {manifest:get('conference-manifest'),conference:get('conference'),programme:get('programme'),people:get('people'),locations:get('locations'),branding:get('branding')};}
const original=load('conference'),other=load('fixtures/multi-track-no-posters'),multiPosters=load('fixtures/multiple-poster-sessions');
for(const [label,pkg] of [['default',original],['independent',other],['multiple-posters',multiPosters]]){
 const result=validatePackage(pkg);assert.deepEqual(result.errors,[],`${label}: semantic errors`);
 const directory=label==='default'?'conference':label==='independent'?'fixtures/multi-track-no-posters':'fixtures/multiple-poster-sessions';
 for(const f of pkg.manifest.files){const digest=crypto.createHash('sha256').update(fs.readFileSync(`${directory}/${f}`)).digest('hex');assert.equal(pkg.manifest.checksums[f],digest,`${label}: checksum ${f}`);}
 const m=createConferenceModel(pkg);assert.ok(m.items.length);assert.ok(m.calendarItems().length);
 const ics=buildICS({conference:pkg.conference,manifest:pkg.manifest,items:m.calendarItems(),locationLabel:id=>m.location(id)?.name||id});
 const count=(ics.match(/BEGIN:VEVENT/g)||[]).length;assert.equal(count,m.calendarItems().length,`${label}: ICS events`);
 for(const item of m.calendarItems())assert.ok(ics.includes(`UID:${item.calendarUid}`),`${label}: immutable UID lost`);
 assert.ok(ics.includes(`TZID:${pkg.conference.timezone}`),`${label}: TZID`);
}
assert.notEqual(original.conference.timezone,other.conference.timezone);
assert.ok(other.programme.tracks.length>=3);
assert.ok(other.locations.locations.filter(l=>l.type==='venue').length>=2);
assert.equal(other.programme.posters.length,0);
const multiModel=createConferenceModel(multiPosters);
assert.equal(multiModel.posterSessions.length,2);
assert.deepEqual(multiModel.posters.map(x=>x.posterSession?.id),['poster-morning','poster-morning','poster-afternoon']);
assert.deepEqual(multiModel.calendarItems().filter(x=>x.kind==='poster-session').map(x=>x.id),['poster-morning','poster-afternoon']);
console.log('Release contract tests OK');

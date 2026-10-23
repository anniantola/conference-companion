import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePackage} from '../src/validation.js';
for(const base of ['conference','fixtures/multi-track-no-posters']){
 const pkg={};for(const [key,file] of Object.entries({manifest:'conference-manifest',conference:'conference',programme:'programme',people:'people',locations:'locations',branding:'branding'}))pkg[key]=JSON.parse(await readFile(`${base}/${file}.json`,'utf8'));
 assert.deepEqual(validatePackage(pkg).errors,[]);
 let bad=structuredClone(pkg);const p=bad.programme.presentations[0];const s=bad.programme.sessions.find(x=>x.id===p.sessionId);s.presentationIds=s.presentationIds.filter(id=>id!==p.id);
 assert.ok(validatePackage(bad).errors.some(x=>x.includes('missing from parent')));
 bad=structuredClone(pkg);const loc=bad.locations.locations[0];loc.parentLocationId=loc.id;
 assert.ok(validatePackage(bad).errors.some(x=>x.includes('cyclic parent')));
 bad=structuredClone(pkg);bad.programme.posters.push({id:'test-poster',title:'Test',posterSessionId:s.id,authorIds:[]});
 assert.ok(validatePackage(bad).errors.some(x=>x.includes('parent must be a poster-session')));
}
console.log('Conference-independent referential validation regressions OK');

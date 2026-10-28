import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePackage} from '../src/validation.js';
import {validatePackageSchemas} from '../src/json-schema.js';
for(const base of ['conference','fixtures/multi-track-no-posters','fixtures/multiple-poster-sessions']){
 const pkg={};for(const [key,file] of Object.entries({manifest:'conference-manifest',conference:'conference',programme:'programme',people:'people',locations:'locations',branding:'branding'}))pkg[key]=JSON.parse(await readFile(`${base}/${file}.json`,'utf8'));
 assert.deepEqual(validatePackage(pkg).errors,[]);
 assert.deepEqual(await validatePackageSchemas(pkg),[],`${base}: schema validation`);
 let bad=structuredClone(pkg);const p=bad.programme.presentations[0];const s=bad.programme.sessions.find(x=>x.id===p.sessionId);s.presentationIds=s.presentationIds.filter(id=>id!==p.id);
 assert.ok(validatePackage(bad).errors.some(x=>x.includes('missing from parent')));
 bad=structuredClone(pkg);const loc=bad.locations.locations[0];loc.parentLocationId=loc.id;
 assert.ok(validatePackage(bad).errors.some(x=>x.includes('cyclic parent')));
 bad=structuredClone(pkg);bad.conference.officialWebsite='javascript:alert(1)';assert.ok(validatePackage(bad).errors.some(x=>x.includes('officialWebsite')));
 bad=structuredClone(pkg);bad.locations.locations[0].mapUrl='data:text/html,unsafe';assert.ok(validatePackage(bad).errors.some(x=>x.includes('mapUrl')));
 bad=structuredClone(pkg);const person=bad.people.people[0];person.links=[{label:'Unsafe',url:'javascript:alert(1)'}];assert.ok(validatePackage(bad).errors.some(x=>x.includes('safe HTTPS')));
 bad=structuredClone(pkg);bad.programme.posters.push({id:'test-poster',title:'Test',posterSessionId:s.id,authorIds:[]});
 assert.ok(validatePackage(bad).errors.some(x=>x.includes('parent must be a poster-session')));
 if(pkg.programme.posters.length){bad=structuredClone(pkg);delete bad.programme.posters[0].posterSessionId;assert.ok(validatePackage(bad).errors.some(x=>x.includes('posterSessionId required')));}
}
const basePkg={};for(const [key,file] of Object.entries({manifest:'conference-manifest',conference:'conference',programme:'programme',people:'people',locations:'locations',branding:'branding'}))basePkg[key]=JSON.parse(await readFile(`conference/${file}.json`,'utf8'));
for(const [field,value] of [['defaultAppearance','purple'],['headingFont','invalid-font'],['brandMode','unknown']]){
 const bad=structuredClone(basePkg);bad.branding[field]=value;
 assert.ok((await validatePackageSchemas(bad)).some(message=>message.includes(`branding.${field}`)),`${field} enum rejected`);
}
const {normalizeWebUrl,validatePackageUrls}=await import('../src/safe-url.js');
for(const path of ['assets/logo.svg','./assets/logo.svg','/assets/logo.svg','https://cdn.example.org/logo.svg'])assert.ok(normalizeWebUrl(path,{allowRelative:true}),`${path} remains valid`);
for(const path of ['javascript:alert(1)','data:image/svg+xml,x','../outside.svg','%2e%2e/outside.svg','assets/%252e%252e/secret.svg','assets/%25252e%25252e/secret.svg','assets%2flogo.svg','assets//logo.svg','%5cserver','assets/%not-encoded.svg'])assert.equal(normalizeWebUrl(path,{allowRelative:true}),'',`${path} rejected`);
const branded=structuredClone(basePkg);branded.branding.logoLight='assets/light.svg';branded.branding.logoDark='https://cdn.example.org/dark.svg';branded.branding.sponsorAssets=['assets/sponsor.svg'];branded.branding.sponsorLogos=[{name:'Sponsor',light:'assets/sponsor-light.svg',dark:'/assets/sponsor-dark.svg',height:40}];branded.people.people[0].photoUrl='assets/person.png';
assert.deepEqual(validatePackageUrls(branded),[],'new and legacy branding image paths accept valid assets');
for(const [target,field] of [[branded.branding,'logoLight'],[branded.branding,'logoDark'],[branded.branding,'sponsorAssets'],[branded.branding.sponsorLogos[0],'light'],[branded.branding.sponsorLogos[0],'dark'],[branded.people.people[0],'photoUrl']]){
 const original=target[field];target[field]=field==='sponsorAssets'?['javascript:alert(1)']:'javascript:alert(1)';
 assert.ok(validatePackageUrls(branded).length,`${field} unsafe reference rejected`);target[field]=original;
}
console.log('Conference-independent referential validation regressions OK');

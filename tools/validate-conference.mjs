#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validatePackage} from '../src/validation.js';

const base=path.resolve(process.argv[2]||'conference');
const read=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));
const manifest=read('conference-manifest.json');
const pkg={manifest,conference:read('conference.json'),programme:read('programme.json'),people:read('people.json'),locations:read('locations.json'),branding:read('branding.json')};
const report=validatePackage(pkg,{strictCalendarUid:true});
for(const file of manifest.files||[]){
  const fp=path.join(base,file);
  if(!fs.existsSync(fp)){report.errors.push(`manifest file missing: ${file}`);continue;}
  const got=crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
  const expected=manifest.checksums?.[file];
  if(!expected)report.errors.push(`manifest checksum missing: ${file}`);
  else if(expected!==got)report.errors.push(`checksum mismatch: ${file}`);
}
console.log(`Conference: ${pkg.conference.name}`);
console.log(`Sessions: ${pkg.programme.sessions.length}; presentations: ${pkg.programme.presentations.length}; posters: ${pkg.programme.posters.length}`);
if(report.warnings.length)console.log('Warnings:\n- '+report.warnings.join('\n- '));
if(report.errors.length){console.error('Errors:\n- '+report.errors.join('\n- '));process.exit(1);}else console.log('Validation OK');

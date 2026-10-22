#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {validateJsonSchema} from '../src/json-schema.js';

const base=path.resolve(process.argv[2]||'conference');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const pairs=[
  ['conference-manifest.json','conference-manifest.schema.json'],
  ['conference.json','conference.schema.json'],
  ['programme.json','programme.schema.json'],
  ['people.json','people.schema.json'],
  ['locations.json','locations.schema.json'],
  ['branding.json','branding.schema.json']
];
const errors=[];
for(const [file,schemaFile] of pairs){
  const value=JSON.parse(fs.readFileSync(path.join(base,file),'utf8'));
  const schema=JSON.parse(fs.readFileSync(path.join(root,'schemas',schemaFile),'utf8'));
  errors.push(...validateJsonSchema(value,schema,file));
}
if(errors.length){console.error('JSON Schema contract errors:\n- '+errors.join('\n- '));process.exit(1);}
console.log(`JSON Schema contract OK: ${base}`);

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function typeOk(value,type){
  if(Array.isArray(type))return type.some(t=>typeOk(value,t));
  if(type==='null')return value===null;if(type==='array')return Array.isArray(value);if(type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value);if(type==='integer')return Number.isInteger(value);if(type==='number')return typeof value==='number'&&Number.isFinite(value);return typeof value===type;
}
function check(value,schema,at='$',errors=[]){
  if(schema.type&&!typeOk(value,schema.type)){errors.push(`${at}: expected ${Array.isArray(schema.type)?schema.type.join('|'):schema.type}`);return errors;}
  if(schema.enum&&!schema.enum.includes(value))errors.push(`${at}: value not in enum`);
  if(schema.pattern&&typeof value==='string'&&!new RegExp(schema.pattern).test(value))errors.push(`${at}: does not match ${schema.pattern}`);
  if(schema.minimum!=null&&typeof value==='number'&&value<schema.minimum)errors.push(`${at}: must be >= ${schema.minimum}`);
  if(schema.minItems!=null&&Array.isArray(value)&&value.length<schema.minItems)errors.push(`${at}: needs at least ${schema.minItems} items`);
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const key of schema.required||[])if(!(key in value))errors.push(`${at}.${key}: required`);
    for(const [key,sub] of Object.entries(schema.properties||{}))if(key in value)check(value[key],sub,`${at}.${key}`,errors);
  }
  if(Array.isArray(value)&&schema.items)for(let i=0;i<value.length;i++)check(value[i],schema.items,`${at}[${i}]`,errors);
  return errors;
}

const base=path.resolve(process.argv[2]||'conference'),root=path.resolve(new URL('..',import.meta.url).pathname);
const pairs=[['conference-manifest.json','conference-manifest.schema.json'],['conference.json','conference.schema.json'],['programme.json','programme.schema.json'],['people.json','people.schema.json'],['locations.json','locations.schema.json'],['branding.json','branding.schema.json']];
const errors=[];
for(const [file,schemaFile] of pairs){const value=JSON.parse(fs.readFileSync(path.join(base,file),'utf8')),schema=JSON.parse(fs.readFileSync(path.join(root,'schemas',schemaFile),'utf8'));check(value,schema,file,errors);}
if(errors.length){console.error('JSON Schema contract errors:\n- '+errors.join('\n- '));process.exit(1);}console.log(`JSON Schema contract OK: ${base}`);

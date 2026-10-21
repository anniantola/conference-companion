#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const base=path.resolve(process.argv[2] || "conference");
const read=name=>JSON.parse(fs.readFileSync(path.join(base,name),"utf8"));
const manifest=read("conference-manifest.json");
const conference=read("conference.json"), programme=read("programme.json"), people=read("people.json"), locations=read("locations.json"), branding=read("branding.json");
const errors=[], warnings=[];
const uniq=(rows,label)=>{const seen=new Set();for(const r of rows){if(!r.id)errors.push(`${label}: missing id`);else if(seen.has(r.id))errors.push(`${label}: duplicate id ${r.id}`);else seen.add(r.id);}return seen;};
if(!conference.id) errors.push("conference.id is required");
try{new Intl.DateTimeFormat("en",{timeZone:conference.timezone}).format();}catch{errors.push(`invalid timezone ${conference.timezone}`)}
const personIds=uniq(people.people||[],"people");
const locationIds=uniq(locations.locations||[],"locations");
const sessionIds=uniq(programme.sessions||[],"sessions");
const presentationIds=uniq(programme.presentations||[],"presentations");
uniq(programme.posters||[],"posters");
const trackIds=uniq(programme.tracks||[],"tracks");
for(const s of programme.sessions||[]){
  if(!s.date||!s.start||!s.end||!s.title||!s.type) errors.push(`session ${s.id}: date/start/end/title/type required`);
  if(s.locationId && !locationIds.has(s.locationId)) errors.push(`session ${s.id}: unknown location ${s.locationId}`);
  if(s.trackId && !trackIds.has(s.trackId)) errors.push(`session ${s.id}: unknown track ${s.trackId}`);
  for(const id of s.chairIds||[]) if(!personIds.has(id)) errors.push(`session ${s.id}: unknown chair ${id}`);
  for(const id of s.presentationIds||[]) if(!presentationIds.has(id)) errors.push(`session ${s.id}: unknown presentation ${id}`);
}
for(const p of programme.presentations||[]){
  if(!sessionIds.has(p.sessionId)) errors.push(`presentation ${p.id}: unknown session ${p.sessionId}`);
  for(const id of p.speakerIds||[]) if(!personIds.has(id)) errors.push(`presentation ${p.id}: unknown speaker ${id}`);
}
for(const p of programme.posters||[]) for(const id of p.authorIds||[]) if(!personIds.has(id)) errors.push(`poster ${p.id}: unknown author ${id}`);
for(const l of locations.locations||[]) if(l.parentLocationId && !locationIds.has(l.parentLocationId)) errors.push(`location ${l.id}: unknown parent ${l.parentLocationId}`);
for(const file of manifest.files||[]){
  const fp=path.join(base,file); if(!fs.existsSync(fp)){errors.push(`manifest file missing: ${file}`);continue;}
  const got=crypto.createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
  if(manifest.checksums?.[file] && manifest.checksums[file]!==got) errors.push(`checksum mismatch: ${file}`);
}
console.log(`Conference: ${conference.name}`);
console.log(`Sessions: ${(programme.sessions||[]).length}; presentations: ${(programme.presentations||[]).length}; posters: ${(programme.posters||[]).length}`);
if(warnings.length) console.log("Warnings:\n- "+warnings.join("\n- "));
if(errors.length){console.error("Errors:\n- "+errors.join("\n- "));process.exit(1);} else console.log("Validation OK");

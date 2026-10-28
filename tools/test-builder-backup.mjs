import assert from 'node:assert/strict';
import './test-webcrypto.mjs';
import {createBuilderProjectFile,readBuilderProjectFile,normalizeBuilderProjectAssets,validateBuilderProjectStructure,validateBuilderProjectTrial} from '../src/builder/project-file.js';
import {createStoredZip,readStoredZip,textEntry} from '../src/zip.js';

const asset=(name,bytes,type='image/svg+xml')=>({name,type,extension:name.slice(name.lastIndexOf('.')),bytes:new Uint8Array(bytes)});
const bytes=value=>[...value];
const project={
  conference:{id:'backup-fixture',name:'Backup fixture',startDate:'2032-05-01',endDate:'2032-05-02'},
  rows:[{id:'entry-one',title:'Imported title',source:{id:'programme:1'}}],
  identityRegistry:{people:{'name-key':'person-stable'},personRecords:{'person-stable':{id:'person-stable',name:'Example Person'}}},
  peopleOverrides:{'person-stable':{position:'Professor',affiliation:'Example University'}},
  sessionOverrides:{sessionOne:{locationId:'roomA',sequenceBump:2}},
  lastPublishedVersion:4,lastExportedVersion:5,dataVersion:6,changelog:[{version:6,message:'Backup fixture'}],
  branding:{defaultAppearance:'system',previewAppearance:'dark',headingFont:'noto-serif',bodyFont:'inter',trackColors:{trackA:'#123456'},locationColors:{roomA:'#654321'}},
  logo:asset('same-name.svg',[1,2,3]),
  logoLight:asset('same-name.svg',[10,11,12]),
  logoDark:asset('same-name.svg',[20,21,22]),
  appIcon:asset('same-name.svg',[30,31,32]),
  sponsorFiles:[
    {id:'sponsor-alpha',name:'Alpha',height:43,light:asset('same-name.svg',[40,41]),dark:asset('same-name.svg',[42,43])},
    {id:'sponsor-beta',name:'Beta',height:77,light:asset('same-name.svg',[50,51]),dark:asset('same-name.svg',[52,53])}
  ],
  peoplePhotos:{'person-stable':asset('portrait.png',[60,61,62],'image/png')},
  sourceFiles:[{id:'source-import',name:'programme.csv',type:'text/csv',blob:new Blob(['source data'])}]
};

const archive=await createBuilderProjectFile(project),entries=await readStoredZip(archive),wrapper=JSON.parse(textEntry(entries,'project.json'));
const restored=await readBuilderProjectFile(archive);
for(const key of ['logo','logoLight','logoDark','appIcon'])assert.deepEqual(bytes(restored[key].bytes),bytes(project[key].bytes),`${key} image bytes`);
for(let i=0;i<project.sponsorFiles.length;i++)for(const theme of ['light','dark'])assert.deepEqual(bytes(restored.sponsorFiles[i][theme].bytes),bytes(project.sponsorFiles[i][theme].bytes),`sponsor ${i} ${theme} bytes`);
assert.deepEqual(bytes(restored.peoplePhotos['person-stable'].bytes),bytes(project.peoplePhotos['person-stable'].bytes));
assert.equal(await restored.sourceFiles[0].blob.text(),'source data');
assert.deepEqual(restored.sponsorFiles.map(({id,name,height})=>({id,name,height})),project.sponsorFiles.map(({id,name,height})=>({id,name,height})),'sponsor ids, names, order, and sizes');
for(const key of ['conference','rows','identityRegistry','peopleOverrides','sessionOverrides','branding','lastPublishedVersion','lastExportedVersion','dataVersion','changelog'])assert.deepEqual(restored[key],project[key],`${key} project data`);
const descriptors=[wrapper.project.logo,wrapper.project.logoLight,wrapper.project.logoDark,wrapper.project.appIcon,...Object.values(wrapper.project.peoplePhotos),...wrapper.project.sponsorFiles.flatMap(s=>[s.light,s.dark]),...wrapper.project.sourceFiles];
const paths=descriptors.map(x=>x?.archivePath).filter(Boolean);
assert.equal(new Set(paths).size,paths.length,'each asset has a collision-free ZIP path');
for(const descriptor of descriptors.filter(Boolean))assert.ok(entries.has(descriptor.archivePath),`archive includes ${descriptor.archivePath}`);

const legacy={conference:{name:'Older project'},rows:[],logo:asset('legacy-logo.png',[71,72,73],'image/png'),sponsorFiles:[asset('legacy-sponsor.png',[74,75],'image/png')],peoplePhotos:{},sourceFiles:[]};
const oldRoundTrip=await readBuilderProjectFile(await createBuilderProjectFile(legacy));
assert.deepEqual(bytes(oldRoundTrip.logo.bytes),bytes(legacy.logo.bytes),'legacy single logo is preserved');
assert.deepEqual(bytes(oldRoundTrip.sponsorFiles[0].bytes),bytes(legacy.sponsorFiles[0].bytes),'legacy flat sponsor asset is preserved');
const legacyAutosave={logoLight:{name:'old-autosave.svg',bytes:{'0':81,'1':82,'2':83}},sponsorFiles:[{id:'old-sponsor',name:'Old sponsor',height:55,light:{name:'old-sponsor.svg',bytes:{'0':91,'1':92}},dark:null}]};
normalizeBuilderProjectAssets(legacyAutosave);
assert.deepEqual(bytes(legacyAutosave.logoLight.bytes),[81,82,83],'numeric-key bytes from old Builder autosaves are migrated');
assert.deepEqual(bytes(legacyAutosave.sponsorFiles[0].light.bytes),[91,92],'old autosaved sponsor variant bytes are migrated');

const incompleteDraft={conference:{id:'draft',name:'Incomplete but valid draft',startDate:'',endDate:'',timezone:'UTC'},rows:[{id:'unfinished',date:'',title:''}],branding:{primary:'#5b4b9a',secondary:'#2f7d68',accent:'#5b4b9a',trackColors:{},locationColors:{}},features:{},identityRegistry:{people:{},locations:{},tracks:{}}};
assert.equal(await validateBuilderProjectTrial(incompleteDraft),true,'a structurally valid but incomplete programme remains restorable');
await assert.rejects(()=>validateBuilderProjectTrial({...incompleteDraft,conference:{...incompleteDraft.conference,startDate:'someday'}}),/invalid package structure.*conference\.startDate/);
const malformed=[
  [{conference:[],rows:[]},/conference object/],
  [{conference:{},rows:'not an array'},/rows collection/],
  [{conference:{},rows:[{title:7}]},/row 1 field title/],
  [{conference:{},rows:[],peopleOverrides:[]},/peopleOverrides identity/],
  [{conference:{},rows:[],identityRegistry:{people:{a:7}}},/non-string identity/],
  [{conference:{},rows:[],identityRegistry:{personRecords:{personA:{id:'personB'}}}},/inconsistent person identity/],
  [{conference:{},rows:[],branding:{brandMode:'unknown'}},/branding\.brandMode/]
];
for(const [value,pattern] of malformed)assert.throws(()=>validateBuilderProjectStructure(value),pattern);
const missingRows=await createStoredZip([{name:'project.json',data:JSON.stringify({format:'conference-companion-builder-project',version:1,project:{conference:{name:'No rows'}}})}]);
await assert.rejects(()=>readBuilderProjectFile(missingRows),/rows collection/);
const unsupported=await createStoredZip([{name:'project.json',data:JSON.stringify({format:'conference-companion-builder-project',version:2,project:{conference:{},rows:[]}})}]);
await assert.rejects(()=>readBuilderProjectFile(unsupported),/Unsupported Builder project/);

const missingWrapper={format:'conference-companion-builder-project',version:1,project:{logoLight:{name:'missing.svg',archivePath:'assets/missing.svg'}}};
const missingZip=await createStoredZip([{name:'project.json',data:JSON.stringify(missingWrapper)}]);
await assert.rejects(()=>readBuilderProjectFile(missingZip),/missing or has an empty logoLight asset/);

const corruptData=new Uint8Array(await archive.arrayBuffer());
let offset=0,corrupted=false;
while(offset+30<=corruptData.length&&new DataView(corruptData.buffer).getUint32(offset,true)===0x04034b50){
  const view=new DataView(corruptData.buffer),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),size=view.getUint32(offset+18,true),name=new TextDecoder().decode(corruptData.slice(offset+30,offset+30+nameLength)),dataStart=offset+30+nameLength+extraLength;
  if(name===wrapper.project.logoLight.archivePath){corruptData[dataStart]^=0xff;corrupted=true;break;}
  offset=dataStart+size;
}
assert.ok(corrupted,'test archive locates a logo payload');
await assert.rejects(()=>readBuilderProjectFile(new Blob([corruptData])),/failed its integrity check/);

const duplicateZip=await createStoredZip([{name:'project.json',data:'{}'},{name:'project.json',data:'{}'}]);
await assert.rejects(()=>readBuilderProjectFile(duplicateZip),/duplicate entry/);
console.log('Builder project backup regressions passed: light/dark logos, nested sponsors, legacy assets, sources, identities and metadata retain exact content; missing, corrupt and duplicate entries are rejected.');

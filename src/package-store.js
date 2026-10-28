import {validatePackage} from './validation.js';
import {validatePackageSchemas} from './json-schema.js';
import {CURRENT_SCHEMA_VERSION,migratePackage} from './migrations.js';

const DB_NAME = 'conferenceCompanionPackages';
const DB_VERSION = 1;
// Keep the active release plus four recent validated releases for rollback.
export const RELEASE_HISTORY_LIMIT = 5;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('packages')) db.createObjectStore('packages', {keyPath:'key'});
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath:'base'});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getRecord(storeName, key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

async function activateRecord(base, record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['packages','meta'], 'readwrite');
    const packages = tx.objectStore('packages');
    const meta = tx.objectStore('meta');
    let activated=false;
    const getMeta = meta.get(base);
    getMeta.onsuccess = () => {
      const old = getMeta.result || {base, history:[]};
      // A candidate download may finish after a rollback was selected in
      // another page. Recheck the persisted lock inside the activation tx.
      if(old.rollbackActive)return;
      const candidates=[record.key,...(old.history||[]),...(old.rollbackKey?[old.rollbackKey]:[])].filter((key,index,all)=>typeof key==='string'&&all.indexOf(key)===index);
      const retained=candidates.slice(0,Math.max(RELEASE_HISTORY_LIMIT,old.rollbackActive?2:1));
      const history=retained;
      for(const key of candidates)if(!retained.includes(key))packages.delete(key);
      packages.put(record);
      meta.put({base,activeKey:record.key,history,rollbackActive:false,rollbackKey:null,rollbackDataVersion:null,updatedAt:Date.now()});
      activated=true;
    };
    getMeta.onerror = () => reject(getMeta.error);
    tx.oncomplete = () => { db.close(); resolve(activated); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Package activation aborted')); };
  });
}

async function validateStoredRecord(record){
  if(!record?.pkg||!record.pkg.manifest)return {ok:false,reason:'Cached conference release is incomplete.'};
  if(Number(record.dataVersion)!==Number(record.pkg.manifest.dataVersion))return {ok:false,reason:'Cached conference release version metadata is inconsistent.'};
  try{
    const schemaErrors=await validatePackageSchemas(record.pkg);
    if(schemaErrors.length)return {ok:false,reason:`Cached release failed schema validation: ${schemaErrors.join('; ')}`};
    const report=validatePackage(record.pkg,{strictCalendarUid:true});
    if(report.errors.length)return {ok:false,reason:`Cached release failed validation: ${report.errors.join('; ')}`};
    return {ok:true,record,warnings:report.warnings||[]};
  }catch(error){return {ok:false,reason:`Cached release could not be validated: ${error?.message||String(error)}`};}
}

async function cachedRecords(meta){
  const keys=[meta?.activeKey,meta?.rollbackActive?meta?.rollbackKey:null,...(meta?.history||[])].filter((key,index,all)=>typeof key==='string'&&all.indexOf(key)===index).slice(0,RELEASE_HISTORY_LIMIT);
  const records=[];
  for(const key of keys){
    const record=await getRecord('packages',key).catch(()=>null);
    records.push(record?{key,...await validateStoredRecord(record)}:{key,ok:false,reason:`Cached conference release ${key} is missing.`});
  }
  return records;
}

async function writeMeta(base,transform){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('meta','readwrite'),store=tx.objectStore('meta'),request=store.get(base);let output=null;
    request.onsuccess=()=>{output=transform(request.result||{base,history:[]});if(output)store.put(output);};
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>{db.close();resolve(output);};
    tx.onerror=()=>{db.close();reject(tx.error);};
    tx.onabort=()=>{db.close();reject(tx.error||new Error('Conference release metadata update aborted'));};
  });
}

function versionParts(v) { return String(v || '0').split('.').map(x => Number(x) || 0); }
export function versionAtLeast(have, need) {
  const a = versionParts(have), b = versionParts(need);
  for (let i = 0; i < Math.max(a.length,b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function fetchText(url) {
  const response = await fetch(url, {cache:'no-store', headers:{'Cache-Control':'no-cache'}});
  if (!response.ok) throw new Error(`${url.split('/').pop()}: HTTP ${response.status}`);
  return response.text();
}

async function fetchManifest(base) {
  const text = await fetchText(`${base}/conference-manifest.json`);
  let manifest;
  try { manifest = JSON.parse(text); }
  catch { throw new Error('conference-manifest.json is not valid JSON'); }
  const schema = Number(manifest.schemaVersion);
  if (!Number.isInteger(schema) || schema < 1) throw new Error('conference-manifest.schemaVersion must be a positive integer');
  if (schema > CURRENT_SCHEMA_VERSION) {
    const err = new Error(`Conference data schema ${schema} is newer than this app supports (${CURRENT_SCHEMA_VERSION}).`);
    err.code = 'SCHEMA_TOO_NEW';
    throw err;
  }
  return manifest;
}

function sameManifest(a, b) {
  if (!a || !b) return false;
  if (Number(a.dataVersion) !== Number(b.dataVersion)) return false;
  if (Number(a.schemaVersion) !== Number(b.schemaVersion)) return false;
  return JSON.stringify(a.checksums || {}) === JSON.stringify(b.checksums || {});
}

function releaseChanges(manifest, previousVersion) {
  return (manifest?.changelog || [])
    .filter(x => Number(x.version) > Number(previousVersion || 0))
    .sort((a,b)=>Number(a.version)-Number(b.version));
}

async function downloadCandidate(base, manifest, engineVersion) {
  if (!versionAtLeast(engineVersion, manifest.minimumEngineVersion)) {
    const err = new Error(`This conference requires app engine ${manifest.minimumEngineVersion} or newer.`);
    err.code = 'ENGINE_TOO_OLD';
    throw err;
  }
  const required = ['conference.json','programme.json','people.json','locations.json','branding.json'];
  const files = [...new Set([...(manifest.files || []), ...required])];
  const textByFile = {};
  for (const file of files) {
    const text = await fetchText(`${base}/${file}`);
    const expected = manifest.checksums?.[file];
    if (!expected) throw new Error(`conference-manifest.json has no checksum for ${file}`);
    const actual = await sha256Hex(text);
    if (actual !== expected) throw new Error(`Integrity check failed for ${file}`);
    textByFile[file] = text;
  }
  const parse = file => {
    try { return JSON.parse(textByFile[file]); }
    catch { throw new Error(`${file} is not valid JSON`); }
  };
  const rawPkg = {
    manifest,
    conference:parse('conference.json'),
    programme:parse('programme.json'),
    people:parse('people.json'),
    locations:parse('locations.json'),
    branding:parse('branding.json')
  };
  const pkg = migratePackage(rawPkg);
  const schemaErrors = await validatePackageSchemas(pkg);
  if (schemaErrors.length) throw new Error(`JSON Schema validation failed: ${schemaErrors.join('; ')}`);
  const report = validatePackage(pkg, {strictCalendarUid:true});
  if (report.errors.length) throw new Error(report.errors.join('; '));
  return {pkg, warnings:report.warnings};
}

export async function loadConferencePackage(base, engineVersion) {
  const normalizedBase = String(base || './conference').replace(/\/$/, '');
  const meta=await getRecord('meta',normalizedBase).catch(()=>null);
  const stored=await cachedRecords(meta).catch(()=>[]);
  const cachedEntry=stored.find(row=>row.ok)||null;
  const cached=cachedEntry?.record||null;
  const cacheWarnings=stored.filter(row=>!row.ok).map(row=>row.reason);

  // A rollback is a persistent user choice: do not even fetch the network
  // manifest until the attendee explicitly resumes automatic updates.
  if(meta?.rollbackActive){
    const pinnedKey=meta.rollbackKey||meta.activeKey;
    const pinned=stored.find(row=>row.key===pinnedKey&&row.ok)||null;
    const targetVersion=Number(meta.rollbackDataVersion??pinned?.record?.dataVersion??0);
    const safeFallback=stored.find(row=>row.ok&&Number(row.record.dataVersion)<=targetVersion)||null;
    const selected=pinned||safeFallback;
    if(!selected)throw new Error(`Automatic updates are paused, but no valid cached conference release is available. ${cacheWarnings.join(' ')}`.trim());
    if(selected.key!==pinnedKey)await writeMeta(normalizedBase,current=>current.rollbackActive?{...current,activeKey:selected.key,rollbackKey:selected.key,rollbackDataVersion:selected.record.dataVersion,updatedAt:Date.now()}:current);
    return {pkg:selected.record.pkg,source:'rollback-cache',updated:false,warnings:[...selected.warnings,...cacheWarnings,'Automatic updates are paused at this validated release.'],networkManifest:null,changes:[],rollbackActive:true};
  }

  let networkError = null;
  try {
    const manifest = await fetchManifest(normalizedBase);
    const cachedVersion = Number(cached?.pkg?.manifest?.dataVersion || 0);
    const networkVersion = Number(manifest.dataVersion || 0);
    if (!Number.isFinite(networkVersion) || networkVersion < 1) throw new Error('conference-manifest.dataVersion must be a positive number');

    if (cached) {
      if (networkVersion < cachedVersion) {
        return {
          pkg:cached.pkg, source:'cache-newer', updated:false,
          warnings:[...(cached.warnings || []),`Ignored older network data version ${networkVersion}; active version is ${cachedVersion}.`],
          networkManifest:manifest, changes:[]
        };
      }
      if (networkVersion === cachedVersion) {
        if (sameManifest(cached.pkg?.manifest, manifest)) {
          return {pkg:cached.pkg, source:'cache-current', updated:false, warnings:cached.warnings || [], networkManifest:manifest, changes:[]};
        }
        const err = new Error(`Network release reused dataVersion ${networkVersion} with different checksums; the cached release was kept.`);
        err.code = 'MUTATED_RELEASE';
        throw err;
      }
    }

    const {pkg, warnings} = await downloadCandidate(normalizedBase, manifest, engineVersion);
    const key = `${normalizedBase}::${manifest.dataVersion}::${manifest.publishedAt || Date.now()}`;
    const record = {key, base:normalizedBase, dataVersion:manifest.dataVersion, pkg, warnings, storedAt:Date.now()};
    const activated=await activateRecord(normalizedBase, record);
    if(!activated){
      const lockedMeta=await getRecord('meta',normalizedBase).catch(()=>null);
      const lockedRows=await cachedRecords(lockedMeta).catch(()=>[]);
      const lockedKey=lockedMeta?.rollbackKey||lockedMeta?.activeKey;
      const selected=lockedRows.find(row=>row.key===lockedKey&&row.ok)||lockedRows.find(row=>row.ok);
      if(!selected)throw new Error('Conference package activation was blocked by a rollback selection, but no valid cached release remains.');
      return {pkg:selected.record.pkg,source:'rollback-cache',updated:false,warnings:[...selected.warnings,'Automatic updates are paused at this validated release.'],networkManifest:manifest,changes:[],rollbackActive:true};
    }
    return {
      pkg, source:'network', updated:!!cached, warnings:[...warnings,...cacheWarnings], networkManifest:manifest,
      changes:releaseChanges(manifest, cachedVersion)
    };
  } catch (err) {
    networkError = err;
  }
  if (cached?.pkg) {
    return {
      pkg:cached.pkg, source:'cache-fallback', updated:false,
      warnings:[...(cachedEntry?.warnings||[]),...cacheWarnings,networkError?.message ? `Network update not activated: ${networkError.message}` : 'Network update unavailable.'].filter(Boolean),
      networkError, changes:[]
    };
  }
  throw networkError || new Error('Conference package is unavailable');
}

export async function rollbackConferencePackage(base) {
  const normalizedBase = String(base || './conference').replace(/\/$/, '');
  const meta = await getRecord('meta', normalizedBase);
  if(meta?.rollbackActive)throw new Error('Automatic updates are already paused at a rollback release.');
  const candidateKeys=(meta?.history||[]).filter(key=>key!==meta?.activeKey).slice(0,RELEASE_HISTORY_LIMIT-1);
  if(!candidateKeys.length)throw new Error('No previous validated conference package is available');
  let previous=null,lastReason='Previous conference package is unavailable';
  for(const key of candidateKeys){
    const candidate=await getRecord('packages',key),checked=await validateStoredRecord(candidate);
    if(checked.ok){previous=candidate;break;}
    lastReason=checked.reason||lastReason;
  }
  if(!previous)throw new Error(lastReason);
  const updated=await writeMeta(normalizedBase,current=>current.activeKey===meta.activeKey&&!current.rollbackActive?{...current,activeKey:previous.key,rollbackActive:true,rollbackKey:previous.key,rollbackDataVersion:previous.dataVersion,updatedAt:Date.now()}:null);
  if(!updated)throw new Error('Conference release changed while rollback was being prepared. Please try again.');
  return previous;
}

export async function resumeConferencePackageUpdates(base){
  const normalizedBase=String(base||'./conference').replace(/\/$/,'');
  const current=await getRecord('meta',normalizedBase);
  if(!current?.rollbackActive)return false;
  const updated=await writeMeta(normalizedBase,meta=>meta.rollbackActive?{...meta,rollbackActive:false,rollbackKey:null,rollbackDataVersion:null,updatedAt:Date.now()}:null);
  return !!updated;
}

export async function getPackageDiagnostics(base) {
  const normalizedBase = String(base || './conference').replace(/\/$/, '');
  const meta = await getRecord('meta', normalizedBase).catch(() => null);
  if (!meta) return {base:normalizedBase, activeKey:null, history:[],rollbackActive:false,records:[]};
  const records=[];
  const diagnosticKeys=[meta.activeKey,...(meta.history||[])].filter((key,index,all)=>typeof key==='string'&&all.indexOf(key)===index).slice(0,RELEASE_HISTORY_LIMIT);
  for (const key of diagnosticKeys) {
    const row=await getRecord('packages',key).catch(()=>null);
    if(row)records.push({key:row.key,dataVersion:row.dataVersion,publishedAt:row.pkg?.manifest?.publishedAt,storedAt:row.storedAt,active:row.key===meta.activeKey,rollback:row.key===(meta.rollbackKey||'')});
  }
  return {...meta,rollbackActive:!!meta.rollbackActive,records};
}

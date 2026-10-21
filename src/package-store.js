import {validatePackage} from './validation.js';

const DB_NAME = 'conferenceCompanionPackages';
const DB_VERSION = 1;
const SUPPORTED_SCHEMA_VERSION = 1;

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
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['packages','meta'], 'readwrite');
    const packages = tx.objectStore('packages');
    const meta = tx.objectStore('meta');
    const getMeta = meta.get(base);
    getMeta.onsuccess = () => {
      const old = getMeta.result || {base, history:[]};
      packages.put(record);
      const history = [record.key, ...(old.history || []).filter(x => x !== record.key)].slice(0, 2);
      for (const key of old.history || []) if (!history.includes(key)) packages.delete(key);
      meta.put({base, activeKey:record.key, history, updatedAt:Date.now()});
    };
    getMeta.onerror = () => reject(getMeta.error);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Package activation aborted')); };
  });
}

async function activeRecord(base) {
  const meta = await getRecord('meta', base);
  if (!meta?.activeKey) return null;
  return getRecord('packages', meta.activeKey);
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
  if (schema > SUPPORTED_SCHEMA_VERSION) {
    const err = new Error(`Conference data schema ${schema} is newer than this app supports (${SUPPORTED_SCHEMA_VERSION}).`);
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
  const pkg = {
    manifest,
    conference:parse('conference.json'),
    programme:parse('programme.json'),
    people:parse('people.json'),
    locations:parse('locations.json'),
    branding:parse('branding.json')
  };
  const report = validatePackage(pkg, {strictCalendarUid:true});
  if (report.errors.length) throw new Error(report.errors.join('; '));
  return {pkg, warnings:report.warnings};
}

export async function loadConferencePackage(base, engineVersion) {
  const normalizedBase = String(base || './conference').replace(/\/$/, '');
  const cached = await activeRecord(normalizedBase).catch(() => null);
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
    await activateRecord(normalizedBase, record);
    return {
      pkg, source:'network', updated:!!cached, warnings, networkManifest:manifest,
      changes:releaseChanges(manifest, cachedVersion)
    };
  } catch (err) {
    networkError = err;
  }
  if (cached?.pkg) {
    return {
      pkg:cached.pkg, source:'cache-fallback', updated:false,
      warnings:[...(cached.warnings || []), networkError?.message ? `Network update not activated: ${networkError.message}` : 'Network update unavailable.'].filter(Boolean),
      networkError, changes:[]
    };
  }
  throw networkError || new Error('Conference package is unavailable');
}

export async function rollbackConferencePackage(base) {
  const normalizedBase = String(base || './conference').replace(/\/$/, '');
  const meta = await getRecord('meta', normalizedBase);
  if (!meta?.history?.[1]) throw new Error('No previous validated conference package is available');
  const previous = await getRecord('packages', meta.history[1]);
  if (!previous?.pkg) throw new Error('Previous conference package is unavailable');
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('meta','readwrite');
    tx.objectStore('meta').put({...meta, activeKey:previous.key, history:[previous.key, meta.history[0]], updatedAt:Date.now()});
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  return previous;
}

export async function getPackageDiagnostics(base) {
  const normalizedBase = String(base || './conference').replace(/\/$/, '');
  const meta = await getRecord('meta', normalizedBase).catch(() => null);
  if (!meta) return {base:normalizedBase, activeKey:null, history:[]};
  const records=[];
  for (const key of meta.history || []) {
    const row=await getRecord('packages',key).catch(()=>null);
    if(row)records.push({key:row.key,dataVersion:row.dataVersion,publishedAt:row.pkg?.manifest?.publishedAt,storedAt:row.storedAt});
  }
  return {...meta,records};
}

import {test,expect} from '@playwright/test';
import {readFile,writeFile,unlink} from 'node:fs/promises';

const A='/__test_deployment_a/';
const B='/__test_deployment_b/';
test.beforeEach(async({request})=>{await request.get('/__test_deployment_control?version=3');});
test.afterEach(async({request})=>{await request.get('/__test_deployment_control?version=3');});

async function open(page,path){
  await page.goto(path);
  await expect(page.locator('#programList')).not.toBeEmpty();
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  });
  return page.evaluate(()=>({name:window.CONFERENCE_PACKAGE.conference.name,id:window.CONFERENCE_PACKAGE.conference.id,version:window.CONFERENCE_PACKAGE.manifest.dataVersion}));
}

test('same-origin deployments keep packages, rollback, offline caches and personal data separate',async({page,context})=>{
  test.setTimeout(90000);
  await page.goto('/builder.html');
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('conferenceCompanionPackages',1);request.onupgradeneeded=()=>{request.result.createObjectStore('packages',{keyPath:'key'});request.result.createObjectStore('meta',{keyPath:'base'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['packages','meta'],'readwrite');tx.objectStore('packages').put({key:'legacy-record',base:'./conference',dataVersion:999,pkg:null});tx.objectStore('meta').put({base:'./conference',activeKey:'legacy-record',history:['legacy-record']});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    const personal=await new Promise((resolve,reject)=>{const request=indexedDB.open('conferenceCompanionUserData',2);request.onupgradeneeded=()=>{request.result.createObjectStore('states',{keyPath:'conferenceId'});request.result.createObjectStore('profiles',{keyPath:'conferenceId'});const friends=request.result.createObjectStore('friends',{keyPath:'key'});friends.createIndex('conferenceId','conferenceId',{unique:false});request.result.createObjectStore('meta',{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=personal.transaction('states','readwrite');tx.objectStore('states').put({conferenceId:'conference-companion-demo',data:{favorites:['legacy-private']}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});personal.close();
    localStorage.setItem('conferenceCompanion:conference-companion-demo:preferences:v1','{"theme":"dark"}');
    const oldPhotos=await new Promise((resolve,reject)=>{const request=indexedDB.open('conferenceCompanion:conference-companion-demo:photos',1);request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id',autoIncrement:true});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=oldPhotos.transaction('photos','readwrite');tx.objectStore('photos').add({blob:new Blob(['legacy photo'])});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});oldPhotos.close();
    await caches.open('conference-companion-engine-1.2.12');
  });
  const first=await open(page,A);expect(first).toMatchObject({name:'Conference Companion Demo',id:'conference-companion-demo',version:3});
  await page.evaluate(async()=>{
    const store=window.CONFERENCE_SERVICES.userStore;
    await store.saveState({favorites:['a-only'],posterFavorites:[],notes:{'talk:a-only':'A private note'}});
    await store.saveProfile({name:'A attendee'});
    await store.saveFriend({id:'a-friend',name:'A private contact'});
    const {attendeeStorageId}=await import('./src/user-store.js');
    localStorage.setItem(`conferenceCompanion:${attendeeStorageId(window.CONFERENCE_PACKAGE.conference.id)}:preferences:v1`,JSON.stringify({compact:true}));
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(`conferenceCompanion:${attendeeStorageId(window.CONFERENCE_PACKAGE.conference.id)}:photos`,1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('photos',{keyPath:'id',autoIncrement:true});store.createIndex('ownerKey','ownerKey',{unique:false});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readwrite');tx.objectStore('photos').add({ownerKey:'event:a-only',blob:new Blob(['A private photo'])});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  });
  const second=await open(page,B);expect(second).toMatchObject({name:'Synthetic Research Exchange',id:first.id,version:1});
  expect((await open(page,`${B}?conference=${B}conference`)).version).toBe(1);
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();expect(await page.evaluate(()=>window.CONFERENCE_PACKAGE.manifest.dataVersion)).toBe(1);
  const bPersonal=await page.evaluate(async()=>{
    const store=window.CONFERENCE_SERVICES.userStore,id=window.CONFERENCE_PACKAGE.conference.id;
    const {attendeeStorageId}=await import('./src/user-store.js');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(`conferenceCompanion:${attendeeStorageId(id)}:photos`,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const photos=await new Promise((resolve,reject)=>{if(!db.objectStoreNames.contains('photos')){db.close();resolve([]);return;}const tx=db.transaction('photos'),r=tx.objectStore('photos').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});
    return {state:await store.getState(),profile:await store.getProfile(),friends:await store.listFriends(),prefs:localStorage.getItem(`conferenceCompanion:${attendeeStorageId(id)}:preferences:v1`),photos};
  });
  expect(bPersonal.state).toEqual({favorites:[],posterFavorites:[],notes:{}});
  expect(bPersonal.profile).toEqual({});expect(bPersonal.friends).toEqual([]);
  expect(JSON.parse(bPersonal.prefs).compact).toBe(false);
  expect(bPersonal.photos).toEqual([]);
  const cachesAfterB=await page.evaluate(()=>caches.keys());
  expect(cachesAfterB.some(key=>key.includes(encodeURIComponent(new URL(A,page.url()).href)))).toBe(true);
  expect(cachesAfterB.some(key=>key.includes(encodeURIComponent(new URL(B,page.url()).href)))).toBe(true);
  expect(cachesAfterB).toContain('conference-companion-engine-1.2.12');
  const equivalent=await page.evaluate(async()=>{const {getPackageDiagnostics}=await import('./src/package-store.js');return [await getPackageDiagnostics(),await getPackageDiagnostics('./conference'),await getPackageDiagnostics(new URL('./conference',location.href).href)];});
  expect(equivalent[0]).toEqual(equivalent[1]);expect(equivalent[1]).toEqual(equivalent[2]);expect(equivalent[0].records).toHaveLength(1);
  expect(equivalent[0].base).toBe(new URL('./conference',page.url()).href);
  expect((await open(page,A)).version).toBe(3);
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();expect(await page.evaluate(()=>window.CONFERENCE_PACKAGE.manifest.dataVersion)).toBe(3);
  const aPersonal=await page.evaluate(async()=>{const store=window.CONFERENCE_SERVICES.userStore;return {state:await store.getState(),profile:await store.getProfile(),friends:await store.listFriends()};});
  expect(aPersonal.state.favorites).toEqual(['a-only']);expect(aPersonal.profile.name).toBe('A attendee');expect(aPersonal.friends).toHaveLength(1);
  await page.evaluate(()=>fetch('/__test_deployment_control?version=4'));
  expect((await open(page,A)).version).toBe(4);
  expect((await open(page,B)).version).toBe(1);
  await open(page,A);
  const rolled=await page.evaluate(()=>window.CONFERENCE_SERVICES.rollbackConferencePackage());expect(rolled.dataVersion).toBe(3);
  expect((await open(page,A)).version).toBe(3);
  expect((await open(page,B)).version).toBe(1);
  await context.setOffline(true);
  expect((await open(page,A)).version).toBe(3);
  expect((await open(page,B)).version).toBe(1);
  await context.setOffline(false);
  await open(page,A);await page.evaluate(()=>window.CONFERENCE_SERVICES.resumeConferencePackageUpdates());
  expect((await open(page,A)).version).toBe(4);
  await page.evaluate(()=>fetch('/__test_deployment_control?version=5'));
  expect((await open(page,A)).version).toBe(5);
  expect((await page.evaluate(()=>window.CONFERENCE_SERVICES.userStore.getState())).favorites).toEqual(['a-only']);
  expect((await open(page,B)).version).toBe(1);
  expect((await page.evaluate(()=>window.CONFERENCE_SERVICES.userStore.getState())).favorites).toEqual([]);
  expect((await page.evaluate(()=>caches.keys())).sort()).toEqual([...cachesAfterB].sort());
  const legacy=await page.evaluate(async()=>{
    const packages=await new Promise((resolve,reject)=>{const r=indexedDB.open('conferenceCompanionPackages',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const packageMeta=await new Promise((resolve,reject)=>{const tx=packages.transaction('meta'),r=tx.objectStore('meta').get('./conference');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>packages.close();});
    const legacyPackage=await new Promise((resolve,reject)=>{const r=indexedDB.open('conferenceCompanionPackages',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('packages'),get=tx.objectStore('packages').get('legacy-record');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);});
    const user=await new Promise((resolve,reject)=>{const r=indexedDB.open('conferenceCompanionUserData',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const state=await new Promise((resolve,reject)=>{const tx=user.transaction('states'),r=tx.objectStore('states').get('conference-companion-demo');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>user.close();});
    const photos=await new Promise((resolve,reject)=>{const r=indexedDB.open('conferenceCompanion:conference-companion-demo:photos',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const photo=await new Promise((resolve,reject)=>{const tx=photos.transaction('photos'),r=tx.objectStore('photos').get(1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>photos.close();});
    return {packageMeta,legacyPackage,state,prefs:localStorage.getItem('conferenceCompanion:conference-companion-demo:preferences:v1'),photo:await photo.blob.text()};
  });
  expect(legacy.packageMeta.activeKey).toBe('legacy-record');expect(legacy.legacyPackage.dataVersion).toBe(999);expect(legacy.state.data.favorites).toEqual(['legacy-private']);expect(legacy.prefs).toBe('{"theme":"dark"}');expect(legacy.photo).toBe('legacy photo');
});

test('Builder project keys are deployment-scoped and leave legacy projects intact',async({page})=>{
  await page.goto('/builder.html');
  await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('conferenceCompanionBuilder',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({id:'default',data:{conference:{name:'Legacy organizer project'}}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();});
  await page.goto(`${A}builder.html`);
  await page.evaluate(async()=>{const {saveProject}=await import('./src/builder/project-store.js');await saveProject({conference:{name:'A project'},rows:[]});});
  await page.goto(`${B}builder.html`);
  const separate=await page.evaluate(async()=>{const {loadProject}=await import('./src/builder/project-store.js');return loadProject();});
  expect(separate?.conference?.name).not.toBe('A project');
  await page.goto(`${A}builder.html`);
  const result=await page.evaluate(async()=>{const {loadProject}=await import('./src/builder/project-store.js');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('conferenceCompanionBuilder',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const legacy=await new Promise((resolve,reject)=>{const tx=db.transaction('projects'),r=tx.objectStore('projects').get('default');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});return {current:await loadProject(),legacy};});
  expect(result.current.conference.name).toBe('A project');expect(result.legacy.data.conference.name).toBe('Legacy organizer project');
});

test('an engine update cleans only its own deployment cache',async({context})=>{
  const a=await context.newPage(),b=await context.newPage();
  await open(a,A);await open(b,B);
  const scopeA=new URL(A,a.url()).href,scopeB=new URL(B,b.url()).href;
  const oldA=`conference-companion-engine:${encodeURIComponent(scopeA)}:1.2.13`;
  const existingB=`conference-companion-engine:${encodeURIComponent(scopeB)}:1.2.13`;
  const updatedA=`conference-companion-engine:${encodeURIComponent(scopeA)}:1.2.13-next`;
  const worker=await readFile('service-worker.js','utf8'),path='__test_scope_worker.js';
  await writeFile(path,worker.replace('1.2.13','1.2.13-next'));
  try{
    await a.evaluate(()=>navigator.serviceWorker.register('./__test_scope_worker.js',{scope:'./'}));
    await expect.poll(()=>a.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r.waiting?.scriptURL||null;})).toContain('__test_scope_worker.js');
    expect(await b.evaluate(()=>caches.keys())).toEqual(expect.arrayContaining([oldA,existingB,updatedA]));
    await a.close();
    const replacement=context.serviceWorkers().find(item=>item.url().endsWith('/__test_scope_worker.js'));
    if(replacement)await expect.poll(()=>replacement.evaluate(()=>self.registration.active?.state)).toBe('activated');
    await expect.poll(()=>b.evaluate(()=>caches.keys())).toEqual(expect.arrayContaining([updatedA,existingB]));
    await expect.poll(()=>b.evaluate(()=>caches.keys())).not.toContain(oldA);
    await context.setOffline(true);
    await b.reload();await expect(b.locator('#programList')).not.toBeEmpty();
    expect(await b.evaluate(()=>window.CONFERENCE_PACKAGE.manifest.dataVersion)).toBe(1);
  }finally{await context.setOffline(false);await unlink(path);await b.close();}
});

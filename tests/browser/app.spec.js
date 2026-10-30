import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

async function ready(page,path='/'){
  await page.goto(path);
  await expect(page.locator('#programList')).not.toBeEmpty();
}
async function controlled(page){
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
}
test('conference timezone label is rendered as text',async({page})=>{
  const files={};for(const name of ['conference-manifest.json','conference.json','programme.json','people.json','locations.json','branding.json'])files[name]=await readFile(`conference/${name}`,'utf8');
  const conference=JSON.parse(files['conference.json']);conference.timezoneLabel='<img src=x onerror="window.timezoneInjected=true">';files['conference.json']=JSON.stringify(conference);
  const manifest=JSON.parse(files['conference-manifest.json']);manifest.checksums['conference.json']=createHash('sha256').update(files['conference.json']).digest('hex');files['conference-manifest.json']=JSON.stringify(manifest);
  await page.route('**/timezone-fixture/**',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return files[name]?route.fulfill({contentType:'application/json',body:files[name]}):route.fulfill({status:404});});
  await ready(page,'/?conference=./timezone-fixture');
  await expect(page.locator('#programMeta')).toContainText(conference.timezoneLabel);
  await expect(page.locator('#programMeta img')).toHaveCount(0);
  expect(await page.evaluate(()=>window.timezoneInjected)).toBeUndefined();
});
for(const base of ['conference','fixtures/multi-track-no-posters']){
  test(`navigation, preferences and offline reload: ${base}`,async({page,context})=>{
    await ready(page,`/?conference=./${base}`);await controlled(page);
    const card=page.locator('#programList [data-event]').first();const eventId=await card.getAttribute('data-event');
    await card.locator('[data-star-event]').click();await card.click();
    await page.locator('.presentation-note').fill('Notes survive offline reload');
    await expect(page.locator('#noteSaveStatus')).toContainText('Saved');await page.locator('#modalClose').click();
    for(const target of ['my','gallery','settings','program']){
      await page.locator(`[data-target="${target}"]`).click();
      await expect(page.locator(`[data-view="${target}"]`)).toHaveClass(/active/);
    }
    await page.locator('[data-target="settings"]').click();
    await page.locator('#themeSelect').selectOption('light');
    await context.setOffline(true);await page.reload();
    await expect(page.locator('#themeSelect')).toHaveValue('light');
    await page.locator('[data-target="program"]').click();
    await expect(page.locator('#programList')).not.toBeEmpty();
    await expect(page.locator(`[data-star-event="${eventId}"]`).first()).toHaveClass(/on/);
    await page.locator(`#programList [data-event="${eventId}"]`).click();
    await expect(page.locator('.presentation-note')).toHaveValue('Notes survive offline reload');
    await context.setOffline(false);
  });
}
test('Builder CSV mapping, bulk edits and private autosave',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'programme.csv',mimeType:'text/csv',buffer:Buffer.from('date,start,end,title,session,speaker,room,track\n2030-05-10,09:00,09:30,Sample talk,Methods,A. Example,Room A,Methods')});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();
  await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toBeVisible();await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');
  await page.locator('#selectAllRows').check();await page.locator('#bulkField').selectOption('location');
  await page.locator('#bulkValue').fill('Room B');await page.locator('#applyBulkEdit').click();
  await expect(page.locator('[data-field="location"]')).toHaveValue('Room B');
  await expect.poll(()=>page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject())?.rows?.[0]?.location;})).toBe('Room B');
  await page.reload();await expect(page.locator('[data-field="location"]')).toHaveValue('Room B');
  await page.locator('[data-goto-step="8"]').click();await page.locator('#validateProject').click();await expect(page.locator('#validationReport')).toContainText('conference.startDate');
});

// Real IndexedDB and fetch: mock only the release server, not application modules.
test('atomic releases, corrupt/invalid/mutated updates, rollback and user data isolation',async({page})=>{
  await page.goto('/builder.html');
  const files={};
  for(const name of ['conference-manifest.json','conference.json','programme.json','people.json','locations.json','branding.json'])files[name]=await readFile(`conference/${name}`,'utf8');
  let current={...files};
  await page.route('**/release/**',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return current[name]===undefined?route.fulfill({status:503,body:'unavailable'}):route.fulfill({contentType:'application/json',body:current[name]});});
  const load=()=>page.evaluate(async()=>{const {loadConferencePackage}=await import('/src/package-store.js');const r=await loadConferencePackage('/release','1.2.0');return {version:r.pkg.manifest.dataVersion,source:r.source,warnings:r.warnings,id:r.pkg.conference.id};});
  const first=await load();
  const state={favorites:['immutable-event'],posterFavorites:['immutable-poster'],notes:{'talk:immutable-event':'Private notes'}};
  await page.evaluate(async({id,state})=>{const {createUserStore,encodeStoredValue,attendeeStorageId}=await import('/src/user-store.js');const s=createUserStore(id);await s.saveState(state);await s.saveProfile({name:'Private attendee',photo:new Blob(['photo'])});await s.saveFriend({id:'friend',name:'Private contact'});await createUserStore('other-event').saveState({favorites:['other']});const row=await encodeStoredValue({ownerKey:'event:immutable-event',ownerType:'event',ownerId:'immutable-event',blob:new Blob(['image']),addedAt:1});await new Promise((resolve,reject)=>{const request=indexedDB.open(`conferenceCompanion:${attendeeStorageId(id)}:photos`,1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('photos',{keyPath:'id',autoIncrement:true});store.createIndex('ownerKey','ownerKey',{unique:false});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('photos','readwrite');tx.objectStore('photos').add(row);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});},{id:first.id,state});
  function release(version,mutate=()=>{}){
    current={...files};const programme=JSON.parse(current['programme.json']);mutate(programme);current['programme.json']=JSON.stringify(programme);
    const m=JSON.parse(files['conference-manifest.json']);m.dataVersion=version;
    for(const name of m.files)m.checksums[name]=createHash('sha256').update(current[name]).digest('hex');
    current['conference-manifest.json']=JSON.stringify(m);
  }
  release(first.version+1);expect((await load()).version).toBe(first.version+1);
  release(first.version+2);current['programme.json']+='corrupt';let result=await load();expect(result.source).toBe('cache-fallback');expect(result.warnings.join()).toContain('Integrity check');
  release(first.version+2,p=>{p.presentations[0].sessionId='missing';});result=await load();expect(result.source).toBe('cache-fallback');expect(result.warnings.join()).toContain('session');
  release(first.version+2,p=>{p.presentations[0].title=123;});result=await load();expect(result.source).toBe('cache-fallback');expect(result.warnings.join()).toContain('JSON Schema');
  release(first.version+2);delete current['people.json'];expect((await load()).source).toBe('cache-fallback');
  release(first.version+1,p=>{p.presentations[0].title='Mutated';});expect((await load()).warnings.join()).toContain('reused dataVersion');
  current={...files};expect((await load()).source).toBe('cache-newer');
  const rollback=await page.evaluate(async()=>{const m=await import('/src/package-store.js');const r=await m.rollbackConferencePackage('/release');return {version:r.dataVersion,diagnostics:await m.getPackageDiagnostics('/release')};});expect(rollback.version).toBe(first.version);expect(rollback.diagnostics.history).toHaveLength(2);expect(rollback.diagnostics.rollbackActive).toBe(true);
  await page.unroute('**/release/**');const rolledBack=await load();expect(rolledBack.source).toBe('rollback-cache');expect(rolledBack.version).toBe(first.version);
  const saved=await page.evaluate(async id=>{const {createUserStore,decodeStoredValue,attendeeStorageId}=await import('/src/user-store.js');const s=createUserStore(id);const profile=await s.getProfile();const photo=await new Promise((resolve,reject)=>{const request=indexedDB.open(`conferenceCompanion:${attendeeStorageId(id)}:photos`,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('photos','readonly'),get=tx.objectStore('photos').get(1);get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};});return {state:await s.getState(),name:profile.name,photo:await profile.photo.text(),friends:await s.listFriends(),other:await createUserStore('other-event').getState(),storedPhoto:await decodeStoredValue(photo.blob).text()};},first.id);
  expect(saved.state).toEqual(state);expect(saved.name).toBe('Private attendee');expect(saved.photo).toBe('photo');expect(saved.friends[0].id).toBe('friend');expect(saved.other.favorites).toEqual(['other']);expect(saved.storedPhoto).toBe('image');
});

test('rollback persists online and offline until explicitly resumed and retains personal data',async({page,context})=>{
  await page.goto('/builder.html');
  const files={};for(const name of ['conference-manifest.json','conference.json','programme.json','people.json','locations.json','branding.json'])files[name]=await readFile(`conference/${name}`,'utf8');
  const makeRelease=version=>{const release={...files},manifest=JSON.parse(release['conference-manifest.json']);manifest.dataVersion=version;manifest.publishedAt=new Date(Date.UTC(2035,0,version)).toISOString();for(const name of manifest.files)manifest.checksums[name]=createHash('sha256').update(release[name]).digest('hex');release['conference-manifest.json']=JSON.stringify(manifest);return release;};
  let current=makeRelease(10);
  await page.route('**/rollback-release/**',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return current[name]===undefined?route.fulfill({status:503,body:'unavailable'}):route.fulfill({contentType:'application/json',body:current[name]});});
  const conferenceId=JSON.parse(files['conference.json']).id,personal={favorites:['rollback-favorite'],posterFavorites:['rollback-poster'],notes:{'talk:rollback-favorite':'Keep these notes'}};
  const load=()=>page.evaluate(async()=>{const {loadConferencePackage}=await import('/src/package-store.js');const result=await loadConferencePackage('./rollback-release','1.2.13');return {version:result.pkg.manifest.dataVersion,source:result.source,rollbackActive:result.rollbackActive};});
  const savePersonal=()=>page.evaluate(async({conferenceId,personal})=>{const {createUserStore}=await import('/src/user-store.js'),store=createUserStore(conferenceId);await store.saveState(personal);await store.saveProfile({name:'Rollback attendee',photo:new Blob(['profile-photo'])});await store.saveFriend({id:'rollback-contact',name:'Rollback contact',privateNotes:'Private contact note'});},{conferenceId,personal});
  const checkPersonal=async()=>{const value=await page.evaluate(async id=>{const {createUserStore}=await import('/src/user-store.js'),store=createUserStore(id),friends=await store.listFriends(),profile=await store.getProfile();return {state:await store.getState(),name:profile.name,photo:await profile.photo.text(),friends};},conferenceId);expect(value.state).toEqual(personal);expect(value.name).toBe('Rollback attendee');expect(value.photo).toBe('profile-photo');expect(value.friends[0].name).toBe('Rollback contact');expect(value.friends[0].privateNotes).toBe('Private contact note');};
  expect(await load()).toMatchObject({version:10,source:'network'});await savePersonal();
  current=makeRelease(11);expect(await load()).toMatchObject({version:11,source:'network'});await checkPersonal();
  const rolled=await page.evaluate(async()=>{const {rollbackConferencePackage}=await import('/src/package-store.js');return rollbackConferencePackage('./rollback-release');});expect(rolled.dataVersion).toBe(10);
  await page.reload();expect(await load()).toMatchObject({version:10,source:'rollback-cache',rollbackActive:true});await checkPersonal();
  await context.setOffline(true);expect(await load()).toMatchObject({version:10,source:'rollback-cache',rollbackActive:true});await checkPersonal();
  await context.setOffline(false);current=makeRelease(11);const resumed=await page.evaluate(async()=>{const {resumeConferencePackageUpdates}=await import('/src/package-store.js');return resumeConferencePackageUpdates('./rollback-release');});expect(resumed).toBe(true);expect(await load()).toMatchObject({version:11,source:'network'});await checkPersonal();
  current=makeRelease(12);expect(await load()).toMatchObject({version:12,source:'network'});await checkPersonal();
  for(let version=13;version<=17;version++){current=makeRelease(version);expect(await load()).toMatchObject({version,source:'network'});await checkPersonal();}
  const bounded=await page.evaluate(async()=>{const {getPackageDiagnostics}=await import('/src/package-store.js');return getPackageDiagnostics('./rollback-release');});expect(bounded.records.map(x=>x.dataVersion)).toEqual([17,16,15,14,13]);
  const selected=await page.evaluate(async()=>{const {rollbackConferencePackage}=await import('/src/package-store.js');return rollbackConferencePackage('./rollback-release');});expect(selected.dataVersion).toBe(16);
  current=makeRelease(18);await page.reload();expect(await load()).toMatchObject({version:16,source:'rollback-cache',rollbackActive:true});await checkPersonal();
  await context.setOffline(true);expect(await load()).toMatchObject({version:16,source:'rollback-cache',rollbackActive:true});await checkPersonal();await context.setOffline(false);
  await page.evaluate(async()=>{const {resumeConferencePackageUpdates}=await import('/src/package-store.js');await resumeConferencePackageUpdates('./rollback-release');});expect(await load()).toMatchObject({version:18,source:'network'});await checkPersonal();
  const diagnostics=await page.evaluate(async()=>{const {getPackageDiagnostics,RELEASE_HISTORY_LIMIT}=await import('/src/package-store.js');return {value:await getPackageDiagnostics('./rollback-release'),limit:RELEASE_HISTORY_LIMIT};});expect(diagnostics.limit).toBe(5);expect(diagnostics.value.records.map(x=>x.dataVersion)).toEqual([18,17,16,15,14]);expect(diagnostics.value.rollbackActive).toBe(false);
  await page.unroute('**/rollback-release/**');await context.setOffline(true);await page.evaluate(async key=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('conferenceCompanionPackages',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});await new Promise((resolve,reject)=>{const tx=db.transaction('packages','readwrite'),request=tx.objectStore('packages').get(key);request.onsuccess=()=>tx.objectStore('packages').put({...request.result,pkg:null});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});},diagnostics.value.records[0].key);
  expect(await load()).toMatchObject({version:17,source:'cache-fallback'});await checkPersonal();await context.setOffline(false);
});

test('rollback status is visible and automatic updates can be explicitly resumed',async({page})=>{
  await page.goto('/?conference=./conference');await expect(page.locator('#programList')).not.toBeEmpty();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await page.evaluate(async()=>{const {getPackageDiagnostics,canonicalPackageBase}=await import('/src/package-store.js'),diagnostics=await getPackageDiagnostics('./conference');const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('conferenceCompanionPackages',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite'),request=tx.objectStore('meta').get(canonicalPackageBase('./conference'));request.onsuccess=()=>tx.objectStore('meta').put({...request.result,rollbackActive:true,rollbackKey:diagnostics.activeKey,rollbackDataVersion:diagnostics.records.find(record=>record.active).dataVersion});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});});
  await page.context().setOffline(true);await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="settings"]').click();await expect(page.locator('#dataReleaseStatus')).toContainText('rollback active');await expect(page.locator('#rollbackNotice')).toBeVisible();await expect(page.locator('#resumeDataUpdatesBtn')).toBeVisible();
  await page.context().setOffline(false);await page.locator('#resumeDataUpdatesBtn').click();await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="settings"]').click();await expect(page.locator('#rollbackNotice')).toBeHidden();await expect(page.locator('#resumeDataUpdatesBtn')).toBeHidden();
});

test('engine update waits while a client edits and activates on clean launch',async({page,context})=>{
  await ready(page);await controlled(page);
  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Unsaved editing');
  const originalController=await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL);
  const worker=await readFile('service-worker.js','utf8');
  const originalApp=await readFile('app.js','utf8');
  await context.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:'// replacement engine'}));
  expect(await page.evaluate(()=>fetch('/app.js').then(r=>r.text()))).toBe(originalApp);
  await context.unroute('**/app.js');
  // A genuine second service-worker script/cache, served by the local HTTP server.
  const {writeFile,unlink}=await import('node:fs/promises');const path='test-engine-worker.js';
  await writeFile(path,worker.replace('1.2.13', 'test'));
  try{
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/test-engine-worker.js',{scope:'/'});});
    await expect.poll(()=>page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r.waiting?.scriptURL||null;})).toContain('test-engine-worker.js');
    await expect(page.locator('#profileName')).toHaveValue('Unsaved editing');
    expect(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL)).toBe(originalController);
    const replacement=context.serviceWorkers().find(worker=>worker.url().endsWith('/test-engine-worker.js'))||null;
    if(replacement)expect(await replacement.evaluate(()=>self.registration.waiting.state)).toBe('installed');

    // Closing the last client permits activation; it does not await activation.
    // Observe through the worker, which is not a scoped document client. Opening
    // a scoped page here can race activation/claim and hold navigation pending.
    await page.close();
    if(replacement)await expect.poll(()=>replacement.evaluate(()=>({
      url:self.registration.active?.scriptURL,
      state:self.registration.active?.state,
      waiting:self.registration.waiting?.scriptURL||null
    }))).toEqual({url:new URL('/test-engine-worker.js',originalController).href,state:'activated',waiting:null});
    const next=await context.newPage();await next.goto('/builder.html');
    await expect.poll(()=>next.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r.active?.scriptURL;})).toContain('test-engine-worker.js');
    await expect(page.isClosed()).toBe(true);
    await next.locator('[data-goto-step="2"]').click();
    await expect(next.locator('#programmeFile')).toBeVisible();
    expect(await next.evaluate(()=>navigator.serviceWorker.controller.scriptURL)).toContain('test-engine-worker.js');
    expect(await next.evaluate(()=>caches.keys())).toEqual([`conference-companion-engine:${encodeURIComponent(new URL('/',originalController).href)}:test`]);
  }finally{await unlink(path);}
});

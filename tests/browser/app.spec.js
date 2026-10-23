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
  await page.locator('#programmeFile').setInputFiles({name:'programme.csv',mimeType:'text/csv',buffer:Buffer.from('date,start,end,title,session,speaker,room,track\n2030-05-10,09:00,09:30,Sample talk,Methods,A. Example,Room A,Methods')});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();
  await page.locator('#applyMapping').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');
  await page.locator('#selectAllRows').check();await page.locator('#bulkField').selectOption('location');
  await page.locator('#bulkValue').fill('Room B');await page.locator('#applyBulkEdit').click();
  await expect(page.locator('[data-field="location"]')).toHaveValue('Room B');
  await expect.poll(()=>page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject())?.rows?.[0]?.location;})).toBe('Room B');
  await page.reload();await expect(page.locator('[data-field="location"]')).toHaveValue('Room B');
  await page.locator('#validateProject').click();await expect(page.locator('#validationReport')).toContainText('conference.startDate');
});

// Real IndexedDB and fetch: mock only the release server, not application modules.
test('atomic releases, corrupt/invalid/mutated updates, rollback and user data isolation',async({page})=>{
  await page.goto('/builder.html');
  const files={};
  for(const name of ['conference-manifest.json','conference.json','programme.json','people.json','locations.json','branding.json'])files[name]=await readFile(`conference/${name}`,'utf8');
  let current={...files};
  await page.route('**/release/**',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return current[name]===undefined?route.fulfill({status:503,body:'unavailable'}):route.fulfill({contentType:'application/json',body:current[name]});});
  const load=()=>page.evaluate(async()=>{const {loadConferencePackage}=await import('/src/package-store.js');const r=await loadConferencePackage('/release','1.1.2');return {version:r.pkg.manifest.dataVersion,source:r.source,warnings:r.warnings,id:r.pkg.conference.id};});
  const first=await load();
  const state={favorites:['immutable-event'],posterFavorites:['immutable-poster'],notes:{'talk:immutable-event':'Private notes'}};
  await page.evaluate(async({id,state})=>{const {createUserStore}=await import('/src/user-store.js');const s=createUserStore(id);await s.saveState(state);await s.saveProfile({name:'Private attendee',photo:new Blob(['photo'])});await s.saveFriend({id:'friend',name:'Private contact'});await createUserStore('other-event').saveState({favorites:['other']});},{id:first.id,state});
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
  const rollback=await page.evaluate(async()=>{const m=await import('/src/package-store.js');const r=await m.rollbackConferencePackage('/release');return {version:r.dataVersion,diagnostics:await m.getPackageDiagnostics('/release')};});expect(rollback.version).toBe(first.version);expect(rollback.diagnostics.history).toHaveLength(2);
  await page.unroute('**/release/**');expect((await load()).source).toBe('cache-fallback');
  const saved=await page.evaluate(async id=>{const {createUserStore}=await import('/src/user-store.js');const s=createUserStore(id);const profile=await s.getProfile();return {state:await s.getState(),name:profile.name,photo:await profile.photo.text(),friends:await s.listFriends(),other:await createUserStore('other-event').getState()};},first.id);
  expect(saved.state).toEqual(state);expect(saved.name).toBe('Private attendee');expect(saved.photo).toBe('photo');expect(saved.friends[0].id).toBe('friend');expect(saved.other.favorites).toEqual(['other']);
});

test('engine update waits while a client edits and activates on clean launch',async({page,context})=>{
  await ready(page);await controlled(page);
  await page.locator('[data-target="settings"]').click();await page.locator('#profileName').fill('Unsaved editing');
  const worker=await readFile('service-worker.js','utf8');
  const originalApp=await readFile('app.js','utf8');
  await context.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:'// replacement engine'}));
  expect(await page.evaluate(()=>fetch('/app.js').then(r=>r.text()))).toBe(originalApp);
  // A genuine second service-worker script/cache, served by the local HTTP server.
  const {writeFile,unlink}=await import('node:fs/promises');const path='test-engine-worker.js';
  await writeFile(path,worker.replace('conference-companion-engine-1.1.2','conference-companion-engine-test'));
  try{
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/test-engine-worker.js',{scope:'/'});});
    await expect.poll(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    await expect(page.locator('#profileName')).toHaveValue('Unsaved editing');
    const next=await context.newPage();await page.close();await next.goto('/builder.html');
    await expect.poll(()=>next.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r.active?.scriptURL;})).toContain('test-engine-worker.js');
  }finally{await unlink(path);}
});

import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createStoredZip,readStoredZip,textEntry} from '../../src/zip.js';

const fixture='/?conference=./fixtures/multiple-poster-sessions';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

async function ready(page,path=fixture){
  await page.goto(path);
  await expect(page.locator('#programList')).not.toBeEmpty();
}

async function downloadText(page,click){
  const pending=page.waitForEvent('download');
  await click();
  const download=await pending,path=await download.path();
  return {download,path,text:await readFile(path,'utf8')};
}

test('multiple poster sessions retain session-specific UI, suggestions and calendar entries',async({page})=>{
  await ready(page);
  await page.locator('[data-target="posters"]').click();
  await expect(page.locator('.poster-session-group')).toHaveCount(2);
  await expect(page.locator('.poster-session-group').nth(0)).toContainText('Morning poster exchange');
  await expect(page.locator('.poster-session-group').nth(0)).toContainText('West Lab');
  await expect(page.locator('.poster-session-group').nth(1)).toContainText('Afternoon poster exchange');
  await expect(page.locator('.poster-session-group').nth(1)).toContainText('Studio 3');
  await page.locator('#posterSearch').fill('B1');await expect(page.locator('#posterList [data-poster]')).toHaveCount(1);await expect(page.locator('#posterList')).toContainText('Afternoon poster exchange');await page.locator('#posterSearch').fill('');
  await page.locator('#posterSearch').fill('Studio 3');await expect(page.locator('#posterList [data-poster]')).toHaveCount(1);await expect(page.locator('#posterList')).toContainText('Synthetic systems poster');await page.locator('#posterSearch').fill('');

  await page.locator('[data-star-poster="poster-a1"]').click();
  await page.locator('[data-star-poster="poster-b1"]').click();
  await page.locator('#posterList [data-poster="poster-b1"]').click();
  await expect(page.locator('#modalContent')).toContainText('Afternoon poster exchange');
  await expect(page.locator('#modalContent')).toContainText('Studio 3');
  await page.locator('.presentation-note').fill('Second-session poster note');
  await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');
  await page.locator('#modalClose').click();

  await page.locator('[data-target="my"]').click();
  await expect(page.locator('#mySchedule .my-day-head').filter({hasText:'Starred posters'})).toHaveCount(2);
  await expect(page.locator('#mySchedule')).toContainText('Morning poster exchange');
  await expect(page.locator('#mySchedule')).toContainText('Afternoon poster exchange');

  await page.locator('[data-target="gallery"]').click();
  await page.evaluate(()=>{
    const input=document.querySelector('#smartPhotoInput'),dt=new DataTransfer();
    dt.items.add(new File([new Uint8Array([137,80,78,71])],'afternoon.png',{type:'image/png',lastModified:Date.parse('2027-11-09T19:30:00Z')}));
    input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(page.locator('#photoImportDialog')).toBeVisible();
  const options=await page.locator('[data-import-select="0"] option').allTextContents();
  expect(options.join('\n')).toContain('Synthetic systems poster');
  expect(options.join('\n')).not.toContain('Synthetic materials poster');
  await page.locator('#photoImportCancel').click();

  await page.locator('[data-target="settings"]').click();
  const starred=await downloadText(page,()=>page.locator('#exportStarredIcsBtn').click());
  expect(starred.text).toContain('UID:poster-morning@example.org');
  expect(starred.text).toContain('UID:poster-afternoon@example.org');
  expect((starred.text.match(/BEGIN:VEVENT/g)||[])).toHaveLength(2);
});

test('personal backup restores notes, photos, favorites, profile and private contacts',async({page})=>{
  await ready(page);
  const event=page.locator('#programList [data-event]').first();
  const eventId=await event.getAttribute('data-event');
  await event.locator('[data-star-event]').click();await event.click();
  await page.locator('.presentation-note').fill('Backup round-trip note');
  await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');
  const individual=await downloadText(page,()=>page.locator('#modalCalendarBtn').click());
  expect(individual.text).toContain('BEGIN:VEVENT');
  await page.locator('#photoInput').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('#modalPhotos [data-photo-id]')).toHaveCount(1);
  await page.locator('#modalPhotos [data-photo-id]').click();await expect(page.locator('#photoViewer')).toBeVisible();
  await page.locator('#photoViewerTitle').fill('Evidence photo');await expect(page.locator('#photoViewerSaveStatus')).toHaveText('Saving…');await page.locator('#photoViewerTitle').press('Tab');await expect(page.locator('#photoViewerSaveStatus')).toHaveText('Saved');
  await page.locator('#photoViewerNote').fill('Private photo note');await expect(page.locator('#photoViewerSaveStatus')).toHaveText('Saving…');await page.locator('#photoViewerNote').press('Tab');await expect(page.locator('#photoViewerSaveStatus')).toHaveText('Saved');await page.locator('#photoViewerClose').click();
  await page.locator('#modalClose').click();

  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill('Casey Example');
  await page.locator('#profileAffiliation').fill('Synthetic Institute');
  await page.locator('#profileEmail').fill('casey@example.test');
  await page.locator('#saveProfileBtn').click();
  const vcard=await downloadText(page,()=>page.locator('#downloadVcardBtn').click());
  expect(vcard.text).toContain('FN:Casey Example');
  expect(vcard.text).toContain('casey@example.test');

  await page.locator('[data-target="settings"]').click();
  const full=await downloadText(page,()=>page.locator('#exportFullIcsBtn').click());
  expect((full.text.match(/BEGIN:VEVENT/g)||[]).length).toBeGreaterThan(5);
  const starred=await downloadText(page,()=>page.locator('#exportStarredIcsBtn').click());
  expect((starred.text.match(/BEGIN:VEVENT/g)||[])).toHaveLength(1);

  await page.locator('[data-target="friends"]').click();
  await page.locator('#friendVcardInput').setInputFiles({name:'contact.vcf',mimeType:'text/vcard',buffer:Buffer.from('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Jordan Contact\r\nORG:Test Laboratory\r\nEMAIL:jordan@example.test\r\nEND:VCARD\r\n')});
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-note]').fill('Private follow-up');
  await page.locator('[data-friend-tags]').fill('poster, collaborator');
  await expect.poll(()=>page.evaluate(async()=>{const rows=await window.CONFERENCE_SERVICES.userStore.listFriends();return [rows[0]?.privateNotes,rows[0]?.tags];})).toEqual(['Private follow-up',['poster','collaborator']]);

  await page.locator('[data-target="settings"]').click();
  const pendingBackup=page.waitForEvent('download');await page.locator('#exportBtn').click();
  const backup=await pendingBackup,backupPath=await backup.path();
  const backupEntries=await readStoredZip(new Blob([await readFile(backupPath)]));
  const payload=JSON.parse(textEntry(backupEntries,'backup.json'));
  expect(payload.state.favorites).toContain(eventId);expect(payload.photos).toHaveLength(1);expect(payload.photos[0].customTitle).toBe('Evidence photo');expect(payload.photos[0].customNote).toBe('Private photo note');expect(payload.friends[0].privateNotes).toBe('Private follow-up');

  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Changed');await page.locator('#saveProfileBtn').click();
  await page.locator('[data-target="program"]').click();await page.locator(`[data-star-event="${eventId}"]`).first().click();
  await page.locator(`#programList [data-event="${eventId}"]`).click();await page.locator('.presentation-note').fill('Changed note');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');await page.locator('#modalClose').click();
  await page.locator('[data-target="settings"]').click();const restoreDialog=page.waitForEvent('dialog');await page.locator('#importInput').setInputFiles(backupPath);await (await restoreDialog).accept();
  await expect(page.locator('#toast')).toContainText('Backup restored');

  await page.locator('[data-target="program"]').click();
  await expect(page.locator(`[data-star-event="${eventId}"]`).first()).toHaveClass(/on/);
  await page.locator(`#programList [data-event="${eventId}"]`).click();
  await expect(page.locator('.presentation-note')).toHaveValue('Backup round-trip note');
  await expect(page.locator('#modalPhotos [data-photo-id]')).toHaveCount(1);
  await page.locator('#modalPhotos [data-photo-id]').click();await expect(page.locator('#photoViewerTitle')).toHaveValue('Evidence photo');await expect(page.locator('#photoViewerNote')).toHaveValue('Private photo note');await page.locator('#photoViewerClose').click();
  await page.locator('#modalClose').click();
  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await expect(page.locator('#profileName')).toHaveValue('Casey Example');
  await page.locator('#cancelProfileBtn').click();await page.locator('[data-friend-toggle]').click();await expect(page.locator('[data-friend-note]')).toHaveValue('Private follow-up');await expect(page.locator('[data-friend-tags]')).toHaveValue('poster, collaborator');
});

test('invalid backup and failed database restore leave all saved personal data intact',async({page})=>{
  await ready(page);
  const event=page.locator('#programList [data-event]').first(),eventId=await event.getAttribute('data-event');
  await event.locator('[data-star-event]').click();await event.click();await page.locator('.presentation-note').fill('Existing note stays');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');
  await page.locator('#photoInput').setInputFiles({name:'existing.png',mimeType:'image/png',buffer:png});await expect(page.locator('#modalPhotos [data-photo-id]')).toHaveCount(1);await page.locator('#modalClose').click();
  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Existing profile');await page.locator('#profileEmail').fill('existing@example.test');await page.locator('#saveProfileBtn').click();
  await page.locator('#friendVcardInput').setInputFiles({name:'existing.vcf',mimeType:'text/vcard',buffer:Buffer.from('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Existing contact\r\nEMAIL:contact@example.test\r\nEND:VCARD\r\n')});
  await expect(page.locator('.friend-card')).toHaveCount(1);
  const snapshot=()=>page.evaluate(async()=>{
    const store=window.CONFERENCE_SERVICES.userStore,id=window.CONFERENCE_PACKAGE.conference.id;
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(`conferenceCompanion:${id}:photos`,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const photos=await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readonly'),r=tx.objectStore('photos').getAll();r.onsuccess=()=>resolve(r.result.map(p=>({id:p.id,name:p.name,title:p.customTitle||'',size:p.blob?.size||0})));r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});
    return {state:await store.getState(),profile:await store.getProfile(),friends:await store.listFriends(),photos,prefs:localStorage.getItem(`conferenceCompanion:${id}:preferences:v1`)};
  });
  await page.locator('[data-target="settings"]').click();
  const before=await snapshot();expect(before.profile.name).toBe('Existing profile');expect(before.photos).toHaveLength(1);
  const payload={format:'conference-companion-backup',version:3,conferenceId:await page.evaluate(()=>window.CONFERENCE_PACKAGE.conference.id),state:{favorites:[],posterFavorites:[],notes:{}},profile:{name:'Should not restore'},friends:[],photos:[{id:99,file:'photos/00000099.png',type:'image/png',ownerType:'event',ownerId:eventId}]};
  const missing=createStoredZip([{name:'backup.json',data:JSON.stringify(payload)}]);
  await page.locator('#importInput').setInputFiles({name:'missing-photo.zip',mimeType:'application/zip',buffer:Buffer.from(await missing.arrayBuffer())});
  await expect(page.locator('#toast')).toContainText('Existing personal data was preserved');expect(await snapshot()).toEqual(before);

  const valid=createStoredZip([{name:'backup.json',data:JSON.stringify(payload)},{name:'photos/00000099.png',data:png}]);
  await page.evaluate(()=>{const store=window.CONFERENCE_SERVICES.userStore,original=store.replacePersonalData.bind(store);let fail=true;store.replacePersonalData=async data=>{if(fail){fail=false;throw new Error('simulated IndexedDB failure');}return original(data);};});
  let confirmation='';page.once('dialog',async dialog=>{confirmation=dialog.message();await dialog.accept();});await page.locator('#importInput').setInputFiles({name:'valid-restore.zip',mimeType:'application/zip',buffer:Buffer.from(await valid.arrayBuffer())});
  await expect.poll(()=>confirmation).toContain('replacing all saved personal data');
  await expect(page.locator('#toast')).toContainText('Existing personal data was preserved');expect(await snapshot()).toEqual(before);
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();expect(await snapshot()).toEqual(before);await page.locator('[data-target="program"]').click();await page.locator(`#programList [data-event="${eventId}"]`).click();await expect(page.locator('.presentation-note')).toHaveValue('Existing note stays');await page.locator('#modalClose').click();
});

for(const width of [320,375,768,1280]){
  test(`attendee flows fit and remain operable at ${width}px`,async({browser})=>{
    const context=await browser.newContext({viewport:{width,height:800},hasTouch:width<=768,isMobile:width<=375});
    const page=await context.newPage();await ready(page);
    const assertFits=async label=>expect(await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})),label).toEqual({scroll:width,client:width});
    await assertFits('programme');
    const visibleNav=page.locator('.nav-btn:visible');expect(await visibleNav.count()).toBe(6);
    for(let i=0;i<await visibleNav.count();i++){const box=await visibleNav.nth(i).boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
    await page.locator('#roomFilters .chip').nth(1).click();await expect(page.locator('#roomFilters .chip').nth(1)).toHaveClass(/active/);
    await page.locator('#programList [data-event]').first().click();await expect(page.locator('#detailModal')).toBeVisible();await assertFits('event dialog');await page.locator('.presentation-note').fill('Mobile note');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');
    const sheet=page.locator('#detailModal .modal-sheet'),dimensions=await sheet.evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));if(dimensions.scroll>dimensions.client){await sheet.evaluate(el=>el.scrollTop=el.scrollHeight);expect(await sheet.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);}
    if(width===320){await page.locator('#photoInput').setInputFiles({name:'mobile.png',mimeType:'image/png',buffer:png});await expect(page.locator('#modalPhotos [data-photo-id]')).toHaveCount(1);await page.locator('#modalPhotos [data-photo-id]').click();await expect(page.locator('#detailModal')).not.toBeVisible();await page.locator('#photoViewerTitle').fill('Touch edit');await expect(page.locator('#photoViewerSaveStatus')).toHaveText('Saving…');await page.locator('#photoViewerTitle').press('Tab');await expect(page.locator('#photoViewerSaveStatus')).toHaveText('Saved');await page.locator('#photoViewerClose').click();await expect(page.locator('#detailModal')).toBeVisible();}
    await page.locator('#modalClose').click();
    for(const target of ['posters','gallery','friends','settings']){await page.locator(`[data-target="${target}"]`).click();await expect(page.locator(`[data-view="${target}"]`)).toHaveClass(/active/);await assertFits(target);}
    await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Mobile User');await page.locator('#saveProfileBtn').click();await page.locator('#friendShareBtn').click();await expect(page.locator('#shareQrViewer')).toBeVisible();await assertFits('QR dialog');await page.locator('#shareQrClose').click();
    await page.locator('[data-target="posters"]').click();await page.locator('[data-poster="poster-a1"]').click();await expect(page.locator('#detailModal')).toBeVisible();await assertFits('poster dialog');
    await context.close();
  });
}

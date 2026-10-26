import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readStoredZip,textEntry} from '../../src/zip.js';

const fixture='/?conference=./fixtures/multiple-poster-sessions';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

async function ready(page,path=fixture){
  await page.goto(path);
  await expect(page.locator('#programList')).not.toBeEmpty();
}

async function controlled(page){
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
}

test('PWA assets, Pages scope, native prompt and offline QR fallback are operational',async({page,context})=>{
  await ready(page);await controlled(page);
  const result=await page.evaluate(async()=>{
    const manifest=await fetch('/manifest.webmanifest').then(r=>r.json());
    const registration=await navigator.serviceWorker.getRegistration();
    const dimensions=[];
    for(const icon of manifest.icons){const bitmap=await createImageBitmap(await fetch(icon.src).then(r=>r.blob()));dimensions.push([bitmap.width,bitmap.height]);bitmap.close();}
    return {manifest,scope:registration.scope,dimensions,caches:await window.caches.keys()};
  });
  expect(result.manifest).toMatchObject({id:'./',start_url:'./',scope:'./',display:'standalone'});
  expect(result.scope).toBe('http://127.0.0.1:8080/');
  expect(result.dimensions).toEqual([[192,192],[512,512]]);
  expect(result.caches).toContain('conference-companion-engine-1.2.0');

  await context.setOffline(true);
  const decoded=await page.evaluate(async()=>{
    delete window.BarcodeDetector;
    const [{drawQr},{default:QrScanner}]=await Promise.all([import('/src/qrcode.js'),import('/src/vendor/qr-scanner/qr-scanner.min.js')]);
    const canvas=document.createElement('canvas'),card='BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Offline QR\r\nEND:VCARD';
    drawQr(canvas,card,{scale:10,margin:4});
    return (await QrScanner.scanImage(canvas,{returnDetailedScanResult:true})).data;
  });
  expect(decoded).toContain('FN:Offline QR');
  await context.setOffline(false);

  await page.locator('[data-target="settings"]').click();
  await page.evaluate(()=>{
    window.__installPromptCalls=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{window.__installPromptCalls++;};
    Object.defineProperty(event,'userChoice',{value:Promise.resolve({outcome:'accepted',platform:'web'})});
    window.dispatchEvent(event);
  });
  await expect(page.locator('#installBtn')).toHaveText('Install');
  await page.locator('#installBtn').click();
  expect(await page.evaluate(()=>window.__installPromptCalls)).toBe(1);
});

test('unsupported iOS installation gets accurate instructions and standalone is detected',async({browser})=>{
  const ios=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  const page=await ios.newPage();await ready(page);await page.locator('[data-target="settings"]').click();
  await expect(page.locator('#installBtn')).toHaveText('Show instructions');
  await expect(page.locator('#installHelp')).toContainText('do not provide a programmatic install prompt');
  await page.locator('#installBtn').click();await expect(page.locator('#installDialog')).toBeVisible();await expect(page.locator('#installInstructions')).toContainText('Share');await expect(page.locator('#installInstructions')).toContainText('Add to Home Screen');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth)).toBe(true);
  await ios.close();

  const installed=await browser.newContext();
  await installed.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
  const installedPage=await installed.newPage();await ready(installedPage);await installedPage.locator('[data-target="settings"]').click();
  await expect(installedPage.locator('#installBtn')).toHaveText('Installed');await expect(installedPage.locator('#installBtn')).toBeDisabled();
  await installed.close();
});

for(const width of [320,375,768]){
  test(`installation, scanner and Friend Book controls fit at ${width}px`,async({browser})=>{
    const context=await browser.newContext({viewport:{width,height:820},hasTouch:true,isMobile:width<=375});
    const page=await context.newPage();await ready(page);
    const assertFits=async()=>expect(await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}))).toEqual({width,scroll:width});
    await page.locator('[data-target="friends"]').click();await assertFits();
    await page.locator('#scanFriendBtn').click();await expect(page.locator('#qrScanDialog')).toBeVisible();await assertFits();await page.locator('#qrScanCancel').click();
    await page.locator('[data-target="settings"]').click();await page.locator('#installBtn').click();await expect(page.locator('#installDialog')).toBeVisible();await assertFits();await page.locator('#installDialogDone').click();
    await page.locator('#deletePersonalDataBtn').scrollIntoViewIfNeeded();await assertFits();
    await context.close();
  });
}

test('live QR scanner imports once and releases the camera on success, cancel and inactivity',async({page})=>{
  await page.addInitScript(()=>{window.CONFERENCE_QR_SCANNER_CLASS=class QrScanner {
    constructor(video,callback,options){this.callback=callback;window.__qrCallback=callback;window.__qrOptions=options;}
    async start(){window.__qrStarts=(window.__qrStarts||0)+1;if(window.__qrStartError)throw new Error(window.__qrStartError);}
    async stop(){window.__qrStops=(window.__qrStops||0)+1;}
    destroy(){window.__qrDestroys=(window.__qrDestroys||0)+1;}
  };});
  await ready(page);await page.locator('[data-target="friends"]').click();await page.locator('#scanFriendBtn').click();
  await expect(page.locator('#qrScanDialog')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__qrStarts||0)).toBe(1);
  expect(await page.evaluate(()=>window.__qrOptions.preferredCamera)).toBe('environment');
  const card='BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Camera Contact\r\nTITLE:Researcher\r\nORG:Offline Lab\r\nEMAIL:camera@example.test\r\nEND:VCARD\r\n';
  await page.evaluate(()=>window.__qrCallback({data:'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Unsafe Camera Card\r\nURL:javascript:alert(1)\r\nEND:VCARD\r\n'}));
  await expect(page.locator('#qrScanStatus')).toContainText('not a valid conference contact card');await expect(page.locator('.friend-card')).toHaveCount(0);await expect(page.locator('#qrScanDialog')).toBeVisible();
  await page.evaluate(async card=>window.__qrCallback({data:card}),card);
  await expect(page.locator('#qrScanDialog')).not.toBeVisible();await expect(page.locator('.friend-card')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>window.__qrStops||0)).toBe(1);

  await page.locator('#scanFriendBtn').click();await expect.poll(()=>page.evaluate(()=>window.__qrStarts||0)).toBe(2);await page.evaluate(async card=>window.__qrCallback({data:card}),card);
  await expect(page.locator('.friend-card')).toHaveCount(1);

  await page.locator('#scanFriendBtn').click();await expect.poll(()=>page.evaluate(()=>window.__qrStarts||0)).toBe(3);await page.locator('#qrScanCancel').click();await expect(page.locator('#qrScanDialog')).not.toBeVisible();
  await page.locator('#scanFriendBtn').click();await expect.poll(()=>page.evaluate(()=>window.__qrStarts||0)).toBe(4);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('#qrScanDialog')).not.toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__qrStops||0)).toBe(4);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});window.__qrStartError='Camera permission denied';});
  await page.locator('#scanFriendBtn').click();await expect(page.locator('#qrScanStatus')).toContainText('permission was denied');await expect(page.locator('#qrScanStatus')).toContainText('Import vCard');await page.locator('#qrScanClose').click();
});

test('Friend Book is an alphabetical, keyboard-accessible expandable list',async({page})=>{
  await ready(page);await page.locator('[data-target="friends"]').click();
  const cards=[
    ['z.vcf','BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Zeta Person\r\nORG:Zeta Lab\r\nEMAIL:zeta@example.test\r\nEND:VCARD\r\n'],
    ['a.vcf','BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Amy Person\r\nTITLE:Professor\r\nORG:Alpha Lab\r\nEMAIL:amy@example.test\r\nURL:https://example.test/amy\r\nNOTE:Research profile\r\nEND:VCARD\r\n']
  ];
  for(const [name,buffer] of cards)await page.locator('#friendVcardInput').setInputFiles({name,mimeType:'text/vcard',buffer:Buffer.from(buffer)});
  await expect(page.locator('[data-friend-toggle]')).toHaveCount(2);
  expect(await page.locator('[data-friend-toggle]').allTextContents()).toEqual(['Amy Person⌄','Zeta Person⌄']);
  await expect(page.locator('.friend-card-details:visible')).toHaveCount(0);
  const amy=page.locator('[data-friend-toggle]').first();await amy.focus();await amy.press('Enter');await expect(amy).toHaveAttribute('aria-expanded','true');
  const details=page.locator('.friend-card-details:visible');await expect(details).toContainText('Professor');await expect(details).toContainText('Alpha Lab');await expect(details).toContainText('amy@example.test');await expect(details).toContainText('Research profile');await expect(details.locator('[data-friend-note]')).toBeEditable();
  await amy.click();await expect(page.locator('.friend-card-details:visible')).toHaveCount(0);
});

test('QR and scanner dialogs expose names, contain focus and restore focus on close',async({page})=>{
  await ready(page);await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Accessible Attendee');await page.locator('#saveProfileBtn').click();
  await page.locator('#friendShareBtn').click();const share=page.getByRole('dialog',{name:'Share QR code'});await expect(share).toBeVisible();await expect(page.locator('#shareQrClose')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#shareQrClose')).toBeFocused();await page.keyboard.press('Escape');await expect(share).toBeHidden();await expect(page.locator('#friendShareBtn')).toBeFocused();
  await page.evaluate(()=>{window.CONFERENCE_QR_SCANNER_CLASS=class {constructor(){}async start(){}async stop(){}destroy(){}};});
  await page.locator('#scanFriendBtn').click();const scanner=page.getByRole('dialog',{name:'Scan conference contact'});await expect(scanner).toBeVisible();await expect(page.locator('#qrScanClose')).toBeFocused();
  await page.keyboard.press('Escape');await expect(scanner).toBeHidden();await expect(page.locator('#scanFriendBtn')).toBeFocused();
});

test('My Card editor saves, cancels, reloads and restores every profile field from backup',async({page})=>{
  await ready(page);await page.locator('[data-target="settings"]').click();
  await expect(page.locator('#settingsView #profileName')).toHaveCount(0);
  await page.locator('[data-target="friends"]').click();
  await expect(page.locator('#myCardSection')).toBeVisible();await expect(page.locator('#friendList')).toBeVisible();
  const savedBefore=()=>page.evaluate(async()=>{const profile=await window.CONFERENCE_SERVICES.userStore.getProfile();return {...profile,hasPhoto:profile.photoBlob instanceof Blob};});

  await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill('Discarded Edit');await page.locator('#profilePhotoInput').setInputFiles({name:'discarded.png',mimeType:'image/png',buffer:png});
  await page.locator('#cancelProfileBtn').click();
  const cancelled=await savedBefore();expect(Object.keys(cancelled).filter(key=>key!=='hasPhoto')).toEqual([]);expect(cancelled.hasPhoto).toBe(false);await expect(page.locator('#myCardSummary')).toContainText('Create your conference card');

  await page.locator('#editProfileBtn').click();
  const values={profileName:'Riley Researcher',profilePosition:'Principal Investigator',profileAffiliation:'Example Institute',profileEmail:'riley@example.test',profileOrcid:'0000-0002-1234-5678',profileLinkedin:'https://www.linkedin.com/in/riley',profileWebsite:'https://example.test/riley',profileBio:'Offline-first systems researcher',profilePapers:'https://doi.org/10.0000/alpha\nhttps://doi.org/10.0000/beta'};
  for(const [id,value] of Object.entries(values))await page.locator(`#${id}`).fill(value);
  await page.locator('#profilePhotoInput').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:png});
  await page.locator('#saveProfileBtn').click();await expect(page.locator('#profileSection')).toBeHidden();
  await expect(page.locator('#myCardSummary')).toContainText('Riley Researcher');await expect(page.locator('#myCardSummary')).toContainText('Principal Investigator');await expect(page.locator('#myCardSummary')).toContainText('Example Institute');await expect(page.locator('#myCardSummary')).toContainText('riley@example.test');await expect(page.locator('#myCardSummary')).toContainText('Offline-first systems researcher');
  let saved=await savedBefore();expect(saved.name).toBe(values.profileName);expect(saved.position).toBe(values.profilePosition);expect(saved.affiliation).toBe(values.profileAffiliation);expect(saved.email).toBe(values.profileEmail);expect(saved.orcid).toBe(values.profileOrcid);expect(saved.linkedin).toBe(values.profileLinkedin);expect(saved.website).toBe(values.profileWebsite);expect(saved.bio).toBe(values.profileBio);expect(saved.papers).toEqual(values.profilePapers.split('\n'));expect(saved.hasPhoto).toBe(true);

  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="friends"]').click();await expect(page.locator('#myCardSummary')).toContainText('Riley Researcher');await expect(page.locator('.friend-profile-photo')).toBeVisible();
  await page.locator('[data-target="settings"]').click();const pending=page.waitForEvent('download');await page.locator('#exportBtn').click();const backup=await pending,backupPath=await backup.path();
  const entries=await readStoredZip(new Blob([await readFile(backupPath)]));const payload=JSON.parse(textEntry(entries,'backup.json'));
  expect(payload.profile.name).toBe(values.profileName);expect(payload.profilePhoto.file).toMatch(/^profile\//);expect(payload.profile.papers).toEqual(values.profilePapers.split('\n'));

  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Temporary Change');await page.locator('#profilePapers').fill('changed');await page.locator('#saveProfileBtn').click();
  await page.locator('[data-target="settings"]').click();const restoreDialog=page.waitForEvent('dialog');await page.locator('#importInput').setInputFiles(backupPath);await (await restoreDialog).accept();await expect(page.locator('#toast')).toContainText('Backup restored');
  await page.locator('[data-target="friends"]').click();await expect(page.locator('#myCardSummary')).toContainText('Riley Researcher');await page.locator('#editProfileBtn').click();
  for(const [id,value] of Object.entries(values))await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect(page.locator('#profilePhotoPreview')).toBeVisible();await page.locator('#cancelProfileBtn').click();
});

test('compact schedule has measurable density and persists for Program and My Schedule',async({browser})=>{
  const context=await browser.newContext({viewport:{width:375,height:800},hasTouch:true,isMobile:true});const page=await context.newPage();await ready(page);
  const card=page.locator('#programList [data-event]').first();await card.locator('[data-star-event]').click();
  const normal=await card.boundingBox();
  await page.locator('[data-target="settings"]').click();await page.locator('#compactToggle').click();
  await page.locator('[data-target="program"]').click();const compact=await page.locator('#programList [data-event]').first().boundingBox();
  expect(compact.height).toBeLessThan(normal.height-10);
  await page.locator('[data-target="my"]').click();const myCompact=await page.locator('#mySchedule [data-event]').first().boundingBox();expect(myCompact.height).toBeLessThan(normal.height-10);
  await page.reload();await expect(page.locator('html')).toHaveClass(/compact/);await page.locator('[data-target="program"]').click();const reloaded=await page.locator('#programList [data-event]').first().boundingBox();expect(Math.abs(reloaded.height-compact.height)).toBeLessThan(2);
  await context.close();
});

test('delete all personal data supports cancellation, drains saves, reloads empty and isolates conferences',async({page})=>{
  await ready(page);
  const event=page.locator('#programList [data-event]').first(),eventId=await event.getAttribute('data-event');await event.locator('[data-star-event]').click();await event.click();await page.locator('.presentation-note').fill('Delete me');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');await page.locator('#photoInput').setInputFiles({name:'private.png',mimeType:'image/png',buffer:png});await expect(page.locator('#modalPhotos [data-photo-id]')).toHaveCount(1);await page.locator('#modalClose').click();
  await page.locator('[data-target="posters"]').click();await page.locator('#posterList [data-star-poster="poster-a1"]').click();await page.locator('#posterList [data-poster="poster-a1"]').click();await page.locator('.presentation-note').fill('Poster note');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');await page.locator('#modalClose').click();
  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await page.locator('#profileName').fill('Private Profile');await page.locator('#profilePhotoInput').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:png});await page.locator('#saveProfileBtn').click();
  await page.locator('[data-target="settings"]').click();await page.locator('#themeSelect').selectOption('light');await page.locator('#compactToggle').click();
  await page.locator('[data-target="friends"]').click();await page.locator('#friendVcardInput').setInputFiles({name:'private.vcf',mimeType:'text/vcard',buffer:Buffer.from('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Private Friend\r\nEMAIL:friend@example.test\r\nEND:VCARD\r\n')});await page.locator('[data-friend-toggle]').click();await page.locator('[data-friend-note]').fill('Pending private note');
  await page.evaluate(async()=>{const {createUserStore}=await import('/src/user-store.js');const other=createUserStore('isolated-conference');await other.ensureReady();await other.saveState({favorites:['other-event'],posterFavorites:[],notes:{'event:other-event':'Other note'}});await other.saveProfile({name:'Other Profile'});await other.saveFriend({id:'other-friend',name:'Other Friend'});localStorage.setItem('conferenceCompanion:isolated-conference:preferences:v1',JSON.stringify({compact:true}));await new Promise((resolve,reject)=>{const request=indexedDB.open('conferenceCompanion:isolated-conference:photos',1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('photos',{keyPath:'id',autoIncrement:true});store.createIndex('ownerKey','ownerKey',{unique:false});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('photos','readwrite');tx.objectStore('photos').add({ownerKey:'event:other-event',ownerType:'event',ownerId:'other-event',blob:new Blob(['other']),addedAt:1});tx.oncomplete=()=>{db.close();resolve();};};});});
  await page.locator('[data-target="settings"]').click();
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('downloaded backups');dialog.dismiss();});await page.locator('#deletePersonalDataBtn').click();
  await page.locator('[data-target="friends"]').click();await page.locator('#editProfileBtn').click();await expect(page.locator('#profileName')).toHaveValue('Private Profile');await page.locator('[data-target="settings"]').click();

  page.once('dialog',dialog=>{expect(dialog.message()).toContain('Official programme data');expect(dialog.message()).toContain('cannot be deleted');dialog.accept();});await page.locator('#deletePersonalDataBtn').click();
  await expect(page.locator('#profileName')).toHaveValue('');await expect(page.locator('#compactToggle')).toHaveAttribute('aria-checked','false');await expect(page.locator('#exportBtn')).toBeEnabled();
  await page.locator('[data-target="friends"]').click();await expect(page.locator('.friend-card')).toHaveCount(0);await page.locator('[data-target="gallery"]').click();await expect(page.locator('[data-gallery-photo]')).toHaveCount(0);await page.locator('[data-target="program"]').click();await expect(page.locator(`[data-star-event="${eventId}"]`).first()).not.toHaveClass(/on/);
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();
  const stored=await page.evaluate(async()=>{const {createUserStore}=await import('/src/user-store.js');const current=createUserStore('multiple-poster-sessions-fixture'),other=createUserStore('isolated-conference');const photos=async name=>new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('photos','readonly'),get=tx.objectStore('photos').getAll();get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};});return {current:{state:await current.getState(),profile:await current.getProfile(),friends:await current.listFriends(),photos:await photos('conferenceCompanion:multiple-poster-sessions-fixture:photos')},other:{state:await other.getState(),profile:await other.getProfile(),friends:await other.listFriends(),photos:await photos('conferenceCompanion:isolated-conference:photos'),prefs:localStorage.getItem('conferenceCompanion:isolated-conference:preferences:v1')}};});
  expect(stored.current.state).toEqual({favorites:[],posterFavorites:[],notes:{}});expect(stored.current.profile).toEqual({});expect(stored.current.friends).toEqual([]);expect(stored.current.photos).toEqual([]);
  expect(stored.other.state.favorites).toEqual(['other-event']);expect(stored.other.profile.name).toBe('Other Profile');expect(stored.other.friends).toHaveLength(1);expect(stored.other.photos).toHaveLength(1);expect(stored.other.prefs).toContain('compact');
});

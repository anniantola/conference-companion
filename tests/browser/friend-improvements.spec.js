import {test,expect} from '@playwright/test';

const fixture='/?conference=./fixtures/multiple-poster-sessions';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function openFriends(page){await page.goto(fixture);await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="friends"]').click();}

test('an avatar and conference identity transfer in compact and full QR cards',async({page,browser})=>{
  await openFriends(page);
  await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill('Morgan Lee');
  await page.locator('#profileEmail').fill('morgan@example.org');
  await page.locator('#profileBio').fill('Adaptive materials');
  await page.locator('#avatarChoices input[value="av1-07"]').check();
  await expect(page.locator('#avatarPreview')).toContainText('Avatar 07 selected');
  await page.locator('#profileIdentityButton').click();
  await page.locator('#identitySearch').fill('Morgan');
  await page.locator('[data-identity-person="tp-1"]').click();
  await expect(page.locator('#identitySelected')).toContainText('Conference activities (4)');
  await page.locator('#identityConfirm').click();
  await page.locator('#saveProfileBtn').click();
  await expect(page.locator('#myCardSummary .friend-profile-photo')).toHaveAttribute('src',/av1-07\.svg/);
  await expect(page.locator('#myConferenceActivities .friend-activity')).toHaveCount(4);
  await expect(page.locator('.friend-card')).toHaveCount(0);
  await page.locator('#friendShareBtn').click();
  const cards=[];
  for(const mode of ['Compact','Full']){
    await page.locator(`#shareQr${mode}`).check();
    cards.push(await page.evaluate(async()=>{
      const Scanner=(await import('/src/vendor/qr-scanner/qr-scanner.min.js')).default;
      return Scanner.scanImage(document.querySelector('#shareQrCanvas'));
    }));
  }
  expect(cards[0]).toContain('X-CONFERENCE-COMPANION-AVATAR:av1-07');
  expect(cards[1]).toContain('X-CONFERENCE-COMPANION-AVATAR:av1-07');
  expect(cards[0]).not.toContain('Adaptive materials');
  expect(cards[1]).toContain('Adaptive materials');
  const recipient=await browser.newContext();
  try{
    const other=await recipient.newPage();await openFriends(other);
    await other.locator('#friendVcardInput').setInputFiles({name:'card.vcf',mimeType:'text/vcard',buffer:Buffer.from(cards[1])});
    await expect(other.locator('.friend-card')).toHaveCount(1);
    await expect(other.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/av1-07\.svg/);
    await expect(other.locator('#friendImportStatus')).toContainText('Linked to conference');
    await expect(other.locator('#friendsConferenceActivities .aggregate-activity')).toHaveCount(2);
    await other.locator('#friendVcardInput').setInputFiles({name:'compact.vcf',mimeType:'text/vcard',buffer:Buffer.from(cards[0])});
    await expect(other.locator('.friend-card')).toHaveCount(1);
    await other.locator('[data-friend-toggle]').click();
    await expect(other.locator('.friend-card-details')).toContainText('Adaptive materials');
  }finally{await recipient.close();}
});

test('a multi-photo gallery keeps captions, cover, identity and notes through backup and offline reload',async({page,context})=>{
  await openFriends(page);
  const card='BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Morgan Lee\r\nEMAIL:morgan@example.org\r\nURL;TYPE=ORCID:https://orcid.org/0000-0000-0000-0001\r\nX-CONFERENCE-COMPANION-AVATAR:av1-12\r\nEND:VCARD';
  await page.locator('#friendVcardInput').setInputFiles({name:'friend.vcf',mimeType:'text/vcard',buffer:Buffer.from(card)});
  await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-photo]:not([capture])').setInputFiles([{name:'a.png',mimeType:'image/png',buffer:png},{name:'b.png',mimeType:'image/png',buffer:png}]);
  await expect(page.locator('.friend-photo-gallery figure')).toHaveCount(2);
  await page.locator('[data-friend-photo-caption]').nth(1).fill('Conference dinner');
  await page.locator('[data-friend-photo-caption]').nth(1).dispatchEvent('change');
  await page.locator('[data-friend-photo-cover]').nth(1).click();
  await expect(page.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/^blob:/);
  await page.locator('[data-friend-note]').fill('Met after session');
  await page.locator('[data-friend-note]').dispatchEvent('input');
  await page.waitForTimeout(350);
  const snapshot=await page.evaluate(async()=>{const [friend]=await window.CONFERENCE_SERVICES.userStore.listFriends();return {id:friend.id,cover:friend.privateCoverPhotoId,count:friend.privatePhotos.length,caption:friend.privatePhotos[1].caption,note:friend.privateNotes,chronological:friend.privatePhotos[0].createdAt<friend.privatePhotos[1].createdAt};});
  expect(snapshot).toMatchObject({count:2,caption:'Conference dinner',note:'Met after session',chronological:true});
  await page.locator('[data-target="settings"]').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportBtn').click();const download=await downloadPromise;
  const path=await download.path();
  const confirmation=page.waitForEvent('dialog');await page.locator('#importInput').setInputFiles(path);await (await confirmation).accept();
  await expect(page.locator('#toast')).toContainText('Backup restored');
  await page.reload();await page.locator('[data-target="friends"]').click();
  await expect(page.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/^blob:/);
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-photo-gallery figure')).toHaveCount(2);
  await expect(page.locator('[data-friend-photo-caption]').nth(1)).toHaveValue('Conference dinner');
  const restored=await page.evaluate(async()=>{const [friend]=await window.CONFERENCE_SERVICES.userStore.listFriends();return {cover:friend.privateCoverPhotoId,count:friend.privatePhotos.length,note:friend.privateNotes,identity:friend.conferenceIdentity};});
  expect(restored).toMatchObject({cover:snapshot.cover,count:2,note:'Met after session',identity:{conferenceId:'multiple-poster-sessions-fixture',personId:'tp-1'}});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await context.setOffline(true);await page.reload();await page.locator('[data-target="friends"]').click();
  await expect(page.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/^blob:/);
  await expect(page.locator('#friendsConferenceActivities .aggregate-activity')).toHaveCount(2);
});

test('legacy contact photo migrates once and gallery edits survive a quota failure',async({page})=>{
  await openFriends(page);
  await page.evaluate(async()=>{
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),char=>char.charCodeAt(0));
    await window.CONFERENCE_SERVICES.userStore.saveFriend({id:'legacy-photo',name:'Legacy Friend',privatePhotoBlob:new Blob([bytes],{type:'image/png'}),privateNotes:'Keep this note'});
  });
  await page.reload();await page.locator('[data-target="friends"]').click();
  let stored=await page.evaluate(async()=>{const [row]=await window.CONFERENCE_SERVICES.userStore.listFriends();return {count:row.privatePhotos?.length,id:row.privatePhotos?.[0].id,legacy:row.privatePhotoBlob,note:row.privateNotes};});
  expect(stored).toMatchObject({count:1,id:'legacy-cover',legacy:null,note:'Keep this note'});
  await page.reload();await page.locator('[data-target="friends"]').click();
  stored=await page.evaluate(async()=>{const [row]=await window.CONFERENCE_SERVICES.userStore.listFriends();return {count:row.privatePhotos?.length,id:row.privatePhotos?.[0].id};});
  expect(stored).toEqual({count:1,id:'legacy-cover'});
  await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-photo-replace]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.friend-photo-gallery figure')).toHaveCount(1);
  await page.evaluate(()=>{
    const store=window.CONFERENCE_SERVICES.userStore;
    window.__friendSaveOriginal=store.saveFriend;
    store.saveFriend=()=>Promise.reject(Object.assign(new Error('Storage quota exceeded'),{name:'QuotaExceededError'}));
  });
  await page.locator('[data-friend-photo]:not([capture])').setInputFiles({name:'over-quota.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('#toast')).toContainText('Device storage is full');
  await expect(page.locator('.friend-photo-gallery figure')).toHaveCount(1);
  await page.evaluate(()=>{window.CONFERENCE_SERVICES.userStore.saveFriend=window.__friendSaveOriginal;});
  await page.locator('[data-friend-photo-delete]').click();
  await expect(page.locator('.friend-photo-gallery figure')).toHaveCount(0);
  await expect(page.locator('.friend-card-toggle .friend-avatar-placeholder')).toBeVisible();
});

test('completed conferences show the two most recent friend activities and full history',async({page})=>{
  await openFriends(page);
  await page.evaluate(()=>{
    const model=window.CONFERENCE_MODEL;
    for(const item of model.items)item.date='2020-01-01';
    for(const session of model.programme.sessions)session.date='2020-01-01';
    for(const poster of model.posters)if(poster.posterSession)poster.posterSession.date='2020-01-01';
  });
  const card='BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Morgan Lee\r\nEMAIL:morgan@example.org\r\nURL;TYPE=ORCID:https://orcid.org/0000-0000-0000-0001\r\nEND:VCARD';
  await page.locator('#friendVcardInput').setInputFiles({name:'friend.vcf',mimeType:'text/vcard',buffer:Buffer.from(card)});
  await expect(page.locator('#friendsConferenceActivities h4')).toHaveText('Previous conference activities');
  await expect(page.locator('#friendsConferenceActivities .aggregate-activity')).toHaveCount(2);
  await expect(page.locator('[data-friends-activities-toggle]')).toContainText('(4)');
  await page.locator('[data-friends-activities-toggle]').click();
  await expect(page.locator('#friendsConferenceActivities .aggregate-activity')).toHaveCount(4);
  await expect(page.locator('#friendsConferenceActivities')).toContainText('Previous');
  await page.locator('[data-friends-activities-toggle]').click();
  await expect(page.locator('#friendsConferenceActivities .aggregate-activity')).toHaveCount(2);
});

for(const width of [320,375,768,1280])test(`Friend Book avatar, activities, picker and gallery fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:760});await openFriends(page);
  await page.locator('#editProfileBtn').click();
  await expect(page.locator('#avatarChoices .avatar-choice')).toHaveCount(25);
  await page.locator('#cancelProfileBtn').click();
  const card='BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Morgan Lee\r\nEMAIL:morgan@example.org\r\nURL;TYPE=ORCID:https://orcid.org/0000-0000-0000-0001\r\nX-CONFERENCE-COMPANION-AVATAR:av1-03\r\nEND:VCARD';
  await page.locator('#friendVcardInput').setInputFiles({name:'friend.vcf',mimeType:'text/vcard',buffer:Buffer.from(card)});
  await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-photo]:not([capture])').setInputFiles({name:'friend.png',mimeType:'image/png',buffer:png});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.locator('[data-friend-identity]').click();
  await expect(page.locator('#identitySearch')).toBeFocused();
  await expect(page.locator('#identityDialog')).toBeInViewport();
});

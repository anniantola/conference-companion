import {test,expect} from '@playwright/test';

const fixture='/?conference=./fixtures/multiple-poster-sessions';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const card=`BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Morgan Lee\r\nORG:Independent Institute for Engineering\r\nEMAIL:morgan@example.org\r\nURL;TYPE=ORCID:https://orcid.org/0000-0000-0000-0001\r\nX-CONFERENCE-COMPANION-ID:multiple-poster-sessions-fixture\r\nX-CONFERENCE-COMPANION-PERSON-ID:tp-1\r\nEND:VCARD`;
async function openFriends(page){await page.goto(fixture);await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="friends"]').click();}
async function importCard(page,text=card){await page.locator('#friendVcardInput').setInputFiles({name:'friend.vcf',mimeType:'text/vcard',buffer:Buffer.from(text)});}

test('directory enriches met contacts without creating them',async({page})=>{
  const directoryPhotoRequests=[];page.on('request',request=>{if(request.url().includes('person-tp-1.png'))directoryPhotoRequests.push(request.url());});
  await openFriends(page);
  await expect(page.locator('.friend-card')).toHaveCount(0);
  await importCard(page);
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await expect(page.locator('.friend-card-main')).toContainText('Independent Institute');
  await expect(page.locator('.custom-avatar').first()).toBeVisible();
  expect(directoryPhotoRequests).toEqual([]);
  await expect(page.locator('#friendsConferenceActivities .aggregate-activity')).toHaveCount(2);
  await expect(page.locator('#friendsConferenceActivities')).toContainText('View all friend activities (4)');
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-activities .friend-activity')).toHaveCount(4);
  await expect(page.locator('.friend-card .friend-activities')).toContainText('Session chair');
  await expect(page.locator('.friend-card .friend-activities')).toContainText('Oral presentation');
  await expect(page.locator('.friend-card .friend-activities')).toContainText('Poster presentation');
  await page.locator('.friend-card [data-friend-activity][data-activity-type="session"]').click();
  await expect(page.locator('#modalContent .modal-title')).toHaveText('Opening');
  await expect(page.locator('#modalStar')).toBeHidden();
  await page.locator('#detailModal').press('Escape');
  await page.locator('.friend-card [data-friend-favorite][data-activity-type="event"]').first().click();
  await expect(page.locator('.friend-card [data-friend-favorite][data-activity-type="event"]').first()).toHaveText('★');
  await page.locator('.friend-card [data-friend-activity][data-activity-type="poster"]').click();
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#modalContent')).toContainText('Poster #');
  await page.locator('#detailModal').press('Escape');
  await page.locator('[data-friend-unlink]').click();
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
  await importCard(page);
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
  await page.locator('[data-friend-identity]').click();
  await page.locator('[data-identity-person="tp-1"]').click();
  await page.locator('#identityConfirm').click();
  await expect(page.locator('.friend-activities .friend-activity')).toHaveCount(4);
  await importCard(page,card.replace('EMAIL:morgan@example.org','EMAIL:morgan@example.org'));
  await expect(page.locator('.friend-card')).toHaveCount(1);
});

test('private contact photos survive reload and backup, then can be removed',async({page})=>{
  await openFriends(page);await importCard(page);await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-photo]:not([capture])').setInputFiles({name:'friend.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/^blob:/);
  const saved=await page.evaluate(async()=>{const services=window.CONFERENCE_SERVICES,[friend]=await services.userStore.listFriends();const state={favorites:[],posterFavorites:[],notes:{}},backup=await services.backup.createPersonalBackup({conferenceId:window.CONFERENCE_CONFIG.conference.id,state,profile:{},friends:[friend],photos:[]});const parsed=await services.backup.parsePersonalBackup(backup);await services.userStore.replacePersonalData({state,profile:{},friends:parsed.payload.friends});return {size:friend.privatePhotos[0].blob.size,type:friend.privatePhotos[0].blob.type,restoredSize:parsed.payload.friends[0].privatePhotos[0].blob.size};});
  expect(saved).toMatchObject({type:'image/jpeg',restoredSize:saved.size});
  expect(saved.size).toBeLessThan(350000);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await expect(page.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/^blob:/);
  await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-photo][capture]').setInputFiles({name:'camera.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.friend-card-toggle .friend-avatar')).toHaveAttribute('src',/^blob:/);
  await page.locator('[data-friend-photo-remove]').click();
  await expect(page.locator('.custom-avatar').first()).toBeVisible();
});

test('shared avatar colors and linked activities remain available offline',async({page,context})=>{
  await openFriends(page);await importCard(page);
  await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-photo]:not([capture])').setInputFiles({name:'friend.png',mimeType:'image/png',buffer:png});
  await expect.poll(()=>page.locator('.friend-card-toggle .friend-avatar').evaluate(image=>image.complete&&image.naturalWidth)).toBeTruthy();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await context.setOffline(true);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await expect.poll(()=>page.locator('.friend-card-toggle .friend-avatar').evaluate(image=>image.complete&&image.naturalWidth)).toBeTruthy();
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-activities .friend-activity')).toHaveCount(4);
});

test('older saved contacts gain a unique ORCID directory link without adding contacts',async({page})=>{
  await openFriends(page);
  await page.evaluate(()=>window.CONFERENCE_SERVICES.userStore.saveFriend({id:'legacy-morgan',name:'Morgan Lee',orcid:'0000-0000-0000-0001',affiliation:'Independent Institute for Engineering',privateNotes:'Kept from v1.2.15'}));
  await page.reload();await page.locator('[data-target="friends"]').click();
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-activities .friend-activity')).toHaveCount(4);
  const friend=await page.evaluate(async()=>{const [row]=await window.CONFERENCE_SERVICES.userStore.listFriends();return row;});
  expect(friend.conferenceIdentity).toEqual({conferenceId:'multiple-poster-sessions-fixture',personId:'tp-1'});
  expect(friend.privateNotes).toBe('Kept from v1.2.15');
});

test('an unverified QR person ID stays a suggestion after reload',async({page})=>{
  await openFriends(page);
  const unverified=card.replace('EMAIL:morgan@example.org\r\n','').replace('URL;TYPE=ORCID:https://orcid.org/0000-0000-0000-0001\r\n','');
  await importCard(page,unverified);
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
});

test('manual contacts stay personal and unlinked unless selected',async({page})=>{
  await page.setViewportSize({width:375,height:720});await openFriends(page);
  await page.locator('#addFriendBtn').click();
  await page.locator('#addFriendForm [name="name"]').fill('Someone Met');
  await page.locator('#addFriendForm [name="affiliation"]').fill('Personal Lab');
  await page.locator('#addFriendForm button[type="submit"]').click();
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
  await expect(page.locator('.friend-card')).toBeInViewport();
  await page.locator('[data-friend-identity]').click();
  await page.locator('[data-identity-person="tp-1"]').click();
  await page.locator('#identityConfirm').click();
  await expect(page.locator('.friend-activities .friend-activity')).toHaveCount(4);
});

test('manual Leave unlinked choice is honored even when ORCID matches',async({page})=>{
  await openFriends(page);await page.locator('#addFriendBtn').click();
  await page.locator('#addFriendForm [name="name"]').fill('Morgan Lee');
  await page.locator('#addFriendForm [name="orcid"]').fill('0000-0000-0000-0001');
  await page.locator('#addFriendForm [name="leaveUnlinked"]').check();
  await page.locator('#addFriendForm button[type="submit"]').click();
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-card .friend-activities')).toHaveCount(0);
});

test('My Card can share a confirmed conference identity without saving a Friend Book contact',async({page})=>{
  await openFriends(page);
  await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill('Morgan Lee');
  await page.locator('#profileEmail').fill('morgan@example.org');
  await page.locator('#profileIdentityButton').click();
  await page.locator('[data-identity-person="tp-1"]').click();
  await page.locator('#identityConfirm').click();
  await page.locator('#saveProfileBtn').click();
  await expect(page.locator('.friend-card')).toHaveCount(0);
  await page.locator('#friendShareBtn').click();
  await expect(page.locator('#shareQrFields')).toContainText('Conference identity');
  const card=await page.evaluate(async()=>{
    const Scanner=(await import('/src/vendor/qr-scanner/qr-scanner.min.js')).default;
    return Scanner.scanImage(document.querySelector('#shareQrCanvas'));
  });
  expect(card).toContain('X-CONFERENCE-COMPANION-ID:multiple-poster-sessions-fixture');
  expect(card).toContain('X-CONFERENCE-COMPANION-PERSON-ID:tp-1');
  await page.locator('#shareQrClose').click();
  await expect(page.locator('.friend-card')).toHaveCount(0);
});

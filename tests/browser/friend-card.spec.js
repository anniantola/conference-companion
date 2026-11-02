import {test,expect} from '@playwright/test';

const fixture='/?conference=./fixtures/multiple-poster-sessions';
async function openFriends(page){await page.goto(fixture);await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="friends"]').click();}
async function importCard(page,text){await page.locator('#friendVcardInput').setInputFiles({name:'shared.vcf',mimeType:'text/vcard',buffer:Buffer.from(text,'utf8')});}
async function scanDisplayedQr(page){return page.evaluate(async()=>{
  const Scanner=(await import('/src/vendor/qr-scanner/qr-scanner.min.js')).default;
  return Scanner.scanImage(document.querySelector('#shareQrCanvas'));
});}

test('compact and full QR cards decode, and compact rescans keep full contact details',async({page})=>{
  await openFriends(page);
  await page.locator('#editProfileBtn').click();
  for(const [id,value] of Object.entries({profileName:'Zoë Ångström',profilePosition:'Senior Researcher',profileAffiliation:'Science Institute',profileEmail:'zoe@example.org',profileOrcid:'0000-0000-0000-0001',profileLinkedin:'https://www.linkedin.com/in/zoe',profileWebsite:'https://example.org/zoe',profileBio:'Research interests in λ networks and open science.',profilePapers:'A labeled paper | doi:10.1234/alpha.beta\nhttps://publisher.example/paper\nAn unlinked paper title'}))await page.locator(`#${id}`).fill(value);
  await page.locator('#saveProfileBtn').click();
  await expect(page.locator('#myCardSummary a[href="https://doi.org/10.1234/alpha.beta"]')).toHaveText(/A labeled paper/);
  await expect(page.locator('#myCardSummary a[href="https://publisher.example/paper"]')).toBeVisible();
  await expect(page.locator('#myCardSummary')).toContainText('An unlinked paper title');
  await expect(page.locator('#myCardSummary a')).toHaveCount(6); // email, ORCID, LinkedIn, website, two papers

  await page.locator('#friendShareBtn').click();
  await expect(page.locator('#shareQrCompact')).toBeChecked();
  await expect(page.locator('#shareQrFields')).toContainText('Position, Affiliation, Email, ORCID, Website');
  const compact=await scanDisplayedQr(page);
  expect(compact).toContain('FN:Zoë Ångström');
  expect(compact).toContain('TITLE:Senior Researcher');
  expect(compact).not.toContain('NOTE:');
  expect(compact).not.toContain('X-PAPER:');
  await page.locator('#shareQrFull').check();
  await expect(page.locator('#shareQrFields')).toContainText('Research interests / bio, Selected papers');
  const full=await scanDisplayedQr(page);
  expect(full).toContain('URL;TYPE=LinkedIn:');
  expect(full).toContain('NOTE:Research interests');
  expect(full).toContain('X-PAPER:A labeled paper');
  await page.locator('#shareQrClose').click();

  await importCard(page,full);
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-card a[href="https://doi.org/10.1234/alpha.beta"]')).toHaveText(/A labeled paper/);
  await expect(page.locator('.friend-card a[href="https://publisher.example/paper"]')).toBeVisible();
  await expect(page.locator('.friend-card')).toContainText('Senior Researcher');
  await expect(page.locator('.friend-card')).toContainText('Research interests in λ networks');
  await page.locator('[data-friend-note]').fill('Private follow-up');
  await page.locator('[data-friend-tags]').fill('collaborator');
  await expect.poll(()=>page.evaluate(async()=>{const rows=await window.CONFERENCE_SERVICES.userStore.listFriends();return rows[0]?.privateNotes;})).toBe('Private follow-up');
  await importCard(page,compact);
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await expect(page.locator('.friend-card')).toContainText('Research interests in λ networks');
  await expect(page.locator('.friend-card a[href="https://doi.org/10.1234/alpha.beta"]')).toBeVisible();
  await expect(page.locator('[data-friend-note]')).toHaveValue('Private follow-up');
  await expect(page.locator('[data-friend-tags]')).toHaveValue('collaborator');
  await importCard(page,full);
  await expect(page.locator('.friend-card')).toHaveCount(1);
  const saved=await page.evaluate(async()=>{const rows=await window.CONFERENCE_SERVICES.userStore.listFriends();return rows[0];});
  expect(saved.papers).toHaveLength(3);
  expect(saved.privateNotes).toBe('Private follow-up');
  await importCard(page,full.replaceAll('zoe@example.org','other@example.org').replaceAll('0000-0000-0000-0001','0000-0000-0000-0002'));
  await expect(page.locator('.friend-card')).toHaveCount(2);
  await page.reload();await page.locator('[data-target="friends"]').click();
  await expect(page.locator('.friend-card')).toHaveCount(2);
  const persisted=await page.evaluate(()=>window.CONFERENCE_SERVICES.userStore.listFriends());
  expect(persisted.find(friend=>friend.email==='zoe@example.org')?.privateNotes).toBe('Private follow-up');
});

test('a Full card remains scannable at its rendered 320px size',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await openFriends(page);
  await page.locator('#editProfileBtn').click();
  for(const [id,value] of Object.entries({profileName:'Ada Mobile',profilePosition:'Researcher',profileAffiliation:'Science Lab',profileEmail:'ada@example.org',profileOrcid:'0000-0000-0000-0001',profileBio:'Studies open science.',profilePapers:'doi:10.1234/mobile'}))await page.locator(`#${id}`).fill(value);
  await page.locator('#saveProfileBtn').click();
  await page.locator('#friendShareBtn').click();
  await page.locator('#shareQrFull').check();
  await expect(page.locator('#shareQrCanvas')).toBeVisible();
  const full=await scanDisplayedQr(page);
  const displayed=await page.locator('#shareQrCanvas').screenshot();
  const screenDecoded=await page.evaluate(async base64=>{
    const Scanner=(await import('/src/vendor/qr-scanner/qr-scanner.min.js')).default;
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
    const image=new Image(),url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;return Scanner.scanImage(image,{canvas,disallowCanvasResizing:true});}finally{URL.revokeObjectURL(url);}
  },displayed.toString('base64'));
  expect(screenDecoded.data).toBe(full);
});

test('oversized full cards show export fallback in a mobile accessible dialog',async({page})=>{
  await page.setViewportSize({width:375,height:667});
  await openFriends(page);
  await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill('Long Card');
  await page.locator('#profileEmail').fill('long@example.org');
  await page.locator('#profileBio').fill('Detailed public research statement '.repeat(70));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  await page.locator('#profilePhotoInput').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:png});
  await page.locator('#saveProfileBtn').click();
  await page.locator('#friendShareBtn').click();
  await expect(page.getByRole('group',{name:'Share card details'})).toBeVisible();
  await expect(page.locator('#shareQrCompact')).toBeChecked();
  await expect(page.locator('#shareQrCanvas')).toBeVisible();
  await expect(page.locator('#shareQrPhotoNote')).toBeVisible();
  await page.locator('#shareQrFull').check();
  await expect(page.locator('#shareQrHint')).toContainText('too large');
  await expect(page.locator('#shareQrCanvas')).toBeHidden();
  await expect(page.locator('#shareVcardFallback')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#shareVcardFallback').click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.vcf$/);
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});

test('Compact sharing names an omitted website when it exceeds the mobile QR limit',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await openFriends(page);
  await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill('Website Example');
  await page.locator('#profileEmail').fill('website@example.org');
  await page.locator('#profileWebsite').fill('https://example.org/'+ 'a'.repeat(350));
  await page.locator('#saveProfileBtn').click();
  await page.locator('#friendShareBtn').click();
  await expect(page.locator('#shareQrCanvas')).toBeVisible();
  await expect(page.locator('#shareQrHint')).toContainText('Website omitted');
  await expect(page.locator('#shareQrFields')).not.toContainText('Website');
  const card=await scanDisplayedQr(page);
  expect(card).toContain('EMAIL:website@example.org');
  expect(card).not.toContain('URL;TYPE=HOME:');
});

test('unsafe paper references remain inert after vCard import',async({page})=>{
  await openFriends(page);
  await importCard(page,'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Safety Test\r\nX-PAPER:An ordinary title\r\nX-PAPER:Unsafe label | javascript:alert(1)\r\nEND:VCARD');
  await expect(page.locator('.friend-card')).toHaveCount(1);
  await page.locator('[data-friend-toggle]').click();
  await expect(page.locator('.friend-card')).toContainText('An ordinary title');
  await expect(page.locator('.friend-card')).toContainText('Unsafe label');
  await expect(page.locator('.friend-card a')).toHaveCount(0);
  await importCard(page,'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Rejected Link\r\nURL:javascript:alert(1)\r\nEND:VCARD');
  await expect(page.locator('.friend-card')).toHaveCount(1);
});

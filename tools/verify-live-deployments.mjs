import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium, firefox} from '@playwright/test';

const args = process.argv.slice(2);
if (args.length !== 4) throw new Error('Usage: node tools/verify-live-deployments.mjs ENGINE_REPO ENGINE_URL CONFERENCE_REPO CONFERENCE_URL');
const deployments = [0, 2].map(index => ({root: resolve(args[index]), url: new URL(args[index + 1])}));
for (const deployment of deployments) {
  deployment.conference = JSON.parse(await readFile(join(deployment.root, 'conference/conference.json'), 'utf8'));
  deployment.programme = JSON.parse(await readFile(join(deployment.root, 'conference/programme.json'), 'utf8'));
  deployment.branding = JSON.parse(await readFile(join(deployment.root, 'conference/branding.json'), 'utf8'));
}

async function verifyOnline(page, deployment) {
  console.log(`Checking ${deployment.url.href}`);
  await page.goto(deployment.url.href);
  await page.waitForFunction(name => window.CONFERENCE_PACKAGE?.conference?.name === name && !!document.querySelector('#programList')?.textContent?.trim(), deployment.conference.name);
  console.log(`Loaded ${deployment.conference.name}`);
  const live = await page.evaluate(async () => {
    const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not become ready within 20 seconds')), 20000))]);
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifest = await fetch(manifestLink.href).then(response => response.json());
    return {
      name: window.CONFERENCE_PACKAGE.conference.name,
      engineVersion: window.CONFERENCE_CONFIG.engineVersion,
      id: window.CONFERENCE_PACKAGE.conference.id,
      sessions: window.CONFERENCE_PACKAGE.programme.sessions.length,
      presentations: window.CONFERENCE_PACKAGE.programme.presentations.length,
      posters: window.CONFERENCE_PACKAGE.programme.posters.length,
      brand: window.CONFERENCE_PACKAGE.branding.primary,
      logo: document.querySelector('.conference-logo')?.getAttribute('src'),
      scope: registration.scope,
      storageScope: window.CONFERENCE_STORAGE_SCOPE,
      manifest,
      title: document.title,
      body: document.body.innerText
    };
  });
  assert.equal(live.name, deployment.conference.name);
  assert.equal(live.engineVersion,'1.2.15');
  assert.equal(live.id, deployment.conference.id);
  assert.equal(live.sessions, deployment.programme.sessions.length);
  assert.equal(live.presentations, deployment.programme.presentations.length);
  assert.equal(live.posters, deployment.programme.posters.length);
  assert.equal(live.brand, deployment.branding.primary);
  assert.equal(live.scope, deployment.url.href);
  assert.equal(live.storageScope, new URL('conference', deployment.url).href);
  for (const field of ['id', 'start_url', 'scope']) assert.equal(live.manifest[field], './');
  assert.equal(live.manifest.display, 'standalone');
  console.log(`Service worker ready at ${live.scope}`);
  for (const icon of live.manifest.icons) assert.equal((await page.request.get(new URL(icon.src, deployment.url).href)).status(), 200);
  if (deployment.branding.logoLight) assert.equal(new URL(live.logo, deployment.url).href, new URL(`conference/${deployment.branding.logoLight}`, deployment.url).href);
  for (const file of ['conference-manifest.json', 'conference.json', 'programme.json', 'people.json', 'locations.json', 'branding.json']) {
    const expected = await readFile(join(deployment.root, 'conference', file));
    const response = await page.request.get(new URL(`conference/${file}`, deployment.url).href);
    assert.equal(response.status(), 200, `${deployment.url.href}${file}`);
    assert.deepEqual(await response.body(), expected, `${file} differs from local repository`);
  }
  console.log(`Conference files match ${deployment.url.href}`);
  for (const file of ['app.js', 'bootstrap.js', 'service-worker.js', 'styles.css', 'src/package-store.js', 'src/vcard.js', 'src/qrcode.js', 'src/publications.js', 'src/friend-contact.js', 'src/vendor/qrcode-generator/qrcode.js']) {
    const expected = await readFile(join(deployments[0].root, file));
    const response = await page.request.get(new URL(file, deployment.url).href);
    assert.equal(response.status(), 200, `${deployment.url.href}${file}`);
    assert.deepEqual(await response.body(), expected, `${deployment.url.href}${file} is not the published shared engine`);
  }
  console.log(`Engine files match ${deployment.url.href}`);
  return live;
}

async function verifySharingUi(page,name){
  await page.locator('[data-target="friends"]').click();
  await page.locator('#editProfileBtn').click();
  await page.locator('#profileName').fill(name);
  await page.locator('#profileEmail').fill('verification@example.org');
  await page.locator('#profilePapers').fill('Live DOI paper | doi:10.1234/live-test');
  await page.locator('#saveProfileBtn').click();
  await page.locator('#myCardSummary a[href="https://doi.org/10.1234/live-test"]').waitFor();
  await page.locator('#friendShareBtn').click();
  assert.equal(await page.locator('#shareQrCompact').isChecked(),true);
  await page.locator('#shareQrFull').check();
  assert.ok((await page.locator('#shareQrFields').textContent()).includes('Selected papers'));
  const decoded=await page.evaluate(async()=>{
    const Scanner=(await import('./src/vendor/qr-scanner/qr-scanner.min.js')).default;
    return Scanner.scanImage(document.querySelector('#shareQrCanvas'));
  });
  assert.ok(decoded.includes('X-PAPER:Live DOI paper | https://doi.org/10.1234/live-test'));
  await page.locator('#shareQrClose').click();
  console.log(`Friend Book links and Full QR sharing OK for ${name}`);
}

for (const [browserName, browserType] of Object.entries({chromium, firefox})) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const first = await verifyOnline(page, deployments[0]);
    await verifySharingUi(page,'Engine verification A');
    const second = await verifyOnline(page, deployments[1]);
    assert.ok(!second.body.includes(first.name), 'Conference Test shows the engine example conference');
    await verifySharingUi(page,'Engine verification B');
    const keys = await page.evaluate(() => caches.keys());
    for (const deployment of deployments) assert.ok(keys.some(key => key.includes(encodeURIComponent(deployment.url.href))), `Missing scoped cache for ${deployment.url.href}`);
    await context.setOffline(true);
    for (const [index, deployment] of deployments.entries()) {
      await page.goto(deployment.url.href);
      await page.waitForFunction(name => window.CONFERENCE_PACKAGE?.conference?.name === name && !!document.querySelector('#programList')?.textContent?.trim(), deployment.conference.name);
      const profile = await page.evaluate(() => window.CONFERENCE_SERVICES.userStore.getProfile());
      assert.equal(profile.name, `Engine verification ${index === 0 ? 'A' : 'B'}`);
    }
    await context.setOffline(false);
    await context.close();
    console.log(`${browserName}: live package, branding, PWA scopes, caches, private state, and offline launch OK`);
  } finally {await browser.close();}
}

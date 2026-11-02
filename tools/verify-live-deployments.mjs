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
  await page.goto(deployment.url.href);
  await page.waitForFunction(name => window.CONFERENCE_PACKAGE?.conference?.name === name && !!document.querySelector('#programList')?.textContent?.trim(), deployment.conference.name);
  const live = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifest = await fetch(manifestLink.href).then(response => response.json());
    return {
      name: window.CONFERENCE_PACKAGE.conference.name,
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
  assert.equal(live.id, deployment.conference.id);
  assert.equal(live.sessions, deployment.programme.sessions.length);
  assert.equal(live.presentations, deployment.programme.presentations.length);
  assert.equal(live.posters, deployment.programme.posters.length);
  assert.equal(live.brand, deployment.branding.primary);
  assert.equal(live.scope, deployment.url.href);
  assert.equal(live.storageScope, new URL('conference', deployment.url).href);
  for (const field of ['id', 'start_url', 'scope']) assert.equal(live.manifest[field], './');
  assert.equal(live.manifest.display, 'standalone');
  for (const icon of live.manifest.icons) assert.equal((await page.request.get(new URL(icon.src, deployment.url))).status(), 200);
  if (deployment.branding.logoLight) assert.equal(live.logo, new URL(`conference/${deployment.branding.logoLight}`, deployment.url).href);
  for (const file of ['conference-manifest.json', 'conference.json', 'programme.json', 'people.json', 'locations.json', 'branding.json']) {
    const expected = await readFile(join(deployment.root, 'conference', file));
    const response = await page.request.get(new URL(`conference/${file}`, deployment.url));
    assert.equal(response.status(), 200, `${deployment.url.href}${file}`);
    assert.deepEqual(await response.body(), expected, `${file} differs from local repository`);
  }
  for (const file of ['app.js', 'bootstrap.js', 'service-worker.js', 'src/package-store.js']) {
    const expected = await readFile(join(deployments[0].root, file));
    const response = await page.request.get(new URL(file, deployment.url));
    assert.equal(response.status(), 200, `${deployment.url.href}${file}`);
    assert.deepEqual(await response.body(), expected, `${deployment.url.href}${file} is not the published shared engine`);
  }
  return live;
}

for (const [browserName, browserType] of Object.entries({chromium, firefox})) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const first = await verifyOnline(page, deployments[0]);
    await page.evaluate(() => window.CONFERENCE_SERVICES.userStore.saveProfile({name: 'Engine verification A'}));
    const second = await verifyOnline(page, deployments[1]);
    assert.ok(!second.body.includes(first.name), 'Conference Test shows the engine example conference');
    await page.evaluate(() => window.CONFERENCE_SERVICES.userStore.saveProfile({name: 'Engine verification B'}));
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

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium, firefox, webkit} from '@playwright/test';

const root = resolve(process.argv[2] || '../conference-test/_site');
const expectedConference = JSON.parse(await readFile(resolve(root, 'conference/conference.json'), 'utf8'));
const expectedProgramme = JSON.parse(await readFile(resolve(root, 'conference/programme.json'), 'utf8'));
const selectedBrowsers = (process.argv[3] || 'chromium,firefox,webkit').split(',');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
  if (path !== root && !path.startsWith(root + sep)) {response.writeHead(403).end(); return;}
  try {response.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream'}).end(await readFile(path));}
  catch {response.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}/`;
try {
  for (const name of selectedBrowsers) {
    const browserType = {chromium, firefox, webkit}[name];
    if (!browserType) throw new Error(`Unknown browser: ${name}`);
    const browser = await browserType.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(address);
      await page.waitForFunction(name => window.CONFERENCE_PACKAGE?.conference?.name === name, expectedConference.name);
      await page.waitForFunction(() => !!document.querySelector('#programList')?.textContent?.trim());
      const state = await page.evaluate(() => ({
        sessions: window.CONFERENCE_PACKAGE.programme.sessions.length,
        talks: window.CONFERENCE_PACKAGE.programme.presentations.length,
        posters: window.CONFERENCE_PACKAGE.programme.posters.length,
        scope: window.CONFERENCE_STORAGE_SCOPE,
        list: document.querySelector('#programList')?.textContent?.length || 0
      }));
      if (state.sessions !== expectedProgramme.sessions.length || state.talks !== expectedProgramme.presentations.length || state.posters !== expectedProgramme.posters.length || !state.list || !state.scope?.startsWith(address)) throw new Error(`${name}: unexpected loaded state ${JSON.stringify(state)}`);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(name => window.CONFERENCE_PACKAGE?.conference?.name === name, expectedConference.name);
      await page.waitForFunction(() => !!document.querySelector('#programList')?.textContent?.trim());
      if (!(await page.locator('#programList').textContent())?.trim()) throw new Error(`${name}: offline programme empty`);
      await context.close();
      console.log(`${name}: ${expectedConference.name} package, deployment scope, and offline reload OK`);
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve => server.close(resolve));}

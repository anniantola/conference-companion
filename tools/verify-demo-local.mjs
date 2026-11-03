import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from '@playwright/test';

const root=resolve(process.argv[2]||'../conference-test/_site');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html';
  const path=resolve(root,relative.endsWith('/')?join(relative,'index.html'):relative);
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const bytes=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch();
try{
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(url);await page.locator('#programList').waitFor();await page.locator('[data-target="friends"]').click();
  assert.equal(await page.locator('.friend-card').count(),0,'DEMO directory must not create contacts');
  for(const [name,email,orcid,avatar] of [
    ['Mira Koskinen','mira.koskinen@demo.example','0000-0000-0000-001X','av1-04'],
    ['Yuna Sato','yuna.sato@demo.example','0000-0000-0000-0036','av1-15']
  ]){
    const card=`BEGIN:VCARD\r\nVERSION:4.0\r\nFN:${name}\r\nEMAIL:${email}\r\nURL;TYPE=ORCID:https://orcid.org/${orcid}\r\nX-CONFERENCE-COMPANION-AVATAR:${avatar}\r\nEND:VCARD`;
    await page.locator('#friendVcardInput').setInputFiles({name:'contact.vcf',mimeType:'text/vcard',buffer:Buffer.from(card)});
    await page.locator('.friend-card').last().waitFor();
    assert.match(await page.locator('#friendImportStatus').textContent(),/Linked to conference/);
  }
  assert.equal(await page.locator('.friend-card').count(),2);
  assert.equal(await page.locator('#friendsConferenceActivities .aggregate-activity').count(),2);
  await page.locator('[data-friends-activities-toggle]').click();
  const rows=page.locator('#friendsConferenceActivities .aggregate-activity');
  assert.ok(await rows.count()>4,'Expected several real DEMO activities');
  const joint=rows.filter({hasText:'Beyond von Neumann: From Materials to Adaptive Systems'});
  assert.equal(await joint.count(),1,'Co-presented keynote must appear once');
  assert.equal(await joint.locator('[data-friend-jump]').count(),2,'Both friends must appear on the keynote');
  const text=await page.locator('#friendsConferenceActivities').textContent();
  assert.match(text,/Oral presentation/);assert.match(text,/Session chair/);assert.match(text,/Poster presentation/);
  assert.equal(await page.locator('.friend-card-toggle img[src*="av1-"]').count(),2);
  await joint.locator('[data-friend-activity]').click();
  assert.match(await page.locator('#modalContent').textContent(),/Beyond von Neumann/);
  await page.locator('#detailModal').press('Escape');
  await joint.locator('[data-friend-jump]').first().click();
  assert.equal(await page.locator('.friend-card.expanded').count(),1);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await context.setOffline(true);await page.reload();await page.locator('[data-target="friends"]').click();
  assert.equal(await page.locator('.friend-card').count(),2,'Saved DEMO contacts must work offline');
  assert.ok(await page.locator('#friendsConferenceActivities .aggregate-activity').count()>=2);
  assert.ok(await page.locator('.friend-card-toggle img[src*="av1-"]').first().evaluate(img=>img.complete&&img.naturalWidth>0));
  console.log(`DEMO staged application passed: ${url} — two linked friends, shared keynote, oral/poster/chair activities, avatars and offline reload`);
  await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

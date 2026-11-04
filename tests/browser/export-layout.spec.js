import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readStoredZip,textEntry} from '../../src/zip.js';

const fixture='/?conference=./fixtures/multiple-poster-sessions';
async function ready(page){await page.goto(fixture);await expect(page.locator('#programList')).not.toBeEmpty();}
async function downloadedPptx(page,path){const entries=await readStoredZip(new Blob([await readFile(path)]));expect(entries.has('ppt/presentation.xml')).toBe(true);const slides=[...entries.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));expect(slides.length).toBeGreaterThan(0);const xml=[...entries].filter(([name])=>name.endsWith('.xml')).map(([,bytes])=>new TextDecoder().decode(bytes));expect(await page.evaluate(values=>values.every(value=>{const doc=new DOMParser().parseFromString(value,'application/xml');return !doc.querySelector('parsererror');}),xml)).toBe(true);for(const slide of slides){const relName=slide.replace('slides/','slides/_rels/')+'.rels',relations=textEntry(entries,relName),targets=[...relations.matchAll(/Target="([^"]+)"/g)].map(match=>new URL(match[1],`https://ppt.invalid/${slide}`).pathname.slice(1));for(const target of targets)expect(entries.has(target)).toBe(true);}return {entries,slides};}
async function exportFile(page){const pending=page.waitForEvent('download');await page.locator('#exportPptxConfirm').click();return pending;}

test('Friend Book-only PPTX is valid and excludes private details until explicitly selected',async({page})=>{
  await ready(page);const programmeEntry=page.locator('#programList [data-event]').first();await programmeEntry.click();await page.locator('.presentation-note').fill('PROGRAMME ARCHIVE NOTE 528e');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');await page.locator('#modalClose').click();await page.locator('[data-target="friends"]').click();
  await page.locator('#friendVcardInput').setInputFiles({name:'archive-contact.vcf',mimeType:'text/vcard',buffer:Buffer.from('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Archive Friend Å\r\nORG:Public Research Lab\r\nEMAIL:secret-contact@example.test\r\nEND:VCARD\r\n')});
  await expect(page.locator('.friend-card')).toHaveCount(1);await page.locator('[data-friend-toggle]').click();
  await page.evaluate(async()=>{const store=window.CONFERENCE_SERVICES.userStore,friend=(await store.listFriends())[0],bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'image/png'});await store.saveFriend({...friend,privatePhotos:[{id:'archive-photo',blob,thumbnailBlob:blob,caption:'PRIVATE PHOTO CAPTION 119b',createdAt:1}],privateCoverPhotoId:'archive-photo'});});await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();await page.locator('[data-target="friends"]').click();await page.locator('[data-friend-toggle]').click();
  await page.locator('[data-friend-note]').fill('PRIVATE ARCHIVE NOTE 48b27');
  await page.locator('[data-target="settings"]').click();await page.locator('#exportPptxBtn').click();
  const dialog=page.locator('#exportPptxDialog');await expect(dialog).toBeVisible();await expect(page.locator('#exportPptxProgramme')).toBeChecked();await expect(page.locator('#exportPptxFriends')).not.toBeChecked();
  await page.locator('#exportPptxProgramme').uncheck();await page.locator('#exportPptxFriends').check();await expect(page.locator('#exportPptxPrivate')).toBeEnabled();await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();await expect(page.locator('#exportPptxConfirm')).toBeEnabled();
  const publicDownload=await exportFile(page),publicPath=await publicDownload.path(),publicArchive=await downloadedPptx(page,publicPath);
  const publicXml=[...publicArchive.entries].filter(([name])=>name.endsWith('.xml')).map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n');
  expect(publicXml).toContain('Archive Friend Å');expect(publicXml).toContain('Public Research Lab');expect(publicXml).not.toContain('secret-contact@example.test');expect(publicXml).not.toContain('PRIVATE ARCHIVE NOTE 48b27');
  expect(publicXml).not.toContain('PRIVATE PHOTO CAPTION 119b');expect([...publicArchive.entries.keys()].some(name=>name.startsWith('ppt/media/'))).toBe(false);
  expect(publicArchive.entries.has('ppt/notesSlides/notesSlide1.xml')).toBe(false);

  await page.locator('#exportPptxBtn').click();await expect(page.locator('#exportPptxProgramme')).toBeChecked();await expect(page.locator('#exportPptxFriends')).not.toBeChecked();await page.locator('#exportPptxFriends').check();
  const combinedDownload=await exportFile(page),combinedArchive=await downloadedPptx(page,await combinedDownload.path());const combinedXml=[...combinedArchive.entries].filter(([name])=>name.endsWith('.xml')).map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n');
  expect(combinedXml).toContain('PROGRAMME ARCHIVE NOTE 528e');expect(combinedXml).toContain('Archive Friend Å');expect(combinedXml).not.toContain('PRIVATE ARCHIVE NOTE 48b27');

  await page.locator('#exportPptxBtn').click();await page.locator('#exportPptxFriends').uncheck();await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  const programmeDownload=await exportFile(page),programmeArchive=await downloadedPptx(page,await programmeDownload.path());const programmeXml=[...programmeArchive.entries].filter(([name])=>name.endsWith('.xml')).map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n');expect(programmeXml).toContain('PROGRAMME ARCHIVE NOTE 528e');expect(programmeXml).not.toContain('Archive Friend Å');

  await page.locator('#exportPptxBtn').click();await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();await page.locator('#exportPptxProgramme').uncheck();await page.locator('#exportPptxFriends').check();await page.locator('#exportPptxPrivate').check();
  const privateDownload=await exportFile(page),privateArchive=await downloadedPptx(page,await privateDownload.path());
  const privateXml=[...privateArchive.entries].filter(([name])=>name.endsWith('.xml')).map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n');
  expect(privateXml).toContain('secret-contact@example.test');expect(privateXml).toContain('PRIVATE ARCHIVE NOTE 48b27');
  expect(privateXml).toContain('PRIVATE PHOTO CAPTION 119b');expect([...privateArchive.entries.keys()].filter(name=>name.startsWith('ppt/media/'))).toHaveLength(1);
  expect(await privateDownload.suggestedFilename()).toMatch(/\.pptx$/);
});

test('Friend Book actions are first, and compact density persists across attendee views',async({page})=>{
  await page.setViewportSize({width:320,height:800});await ready(page);await page.locator('[data-target="friends"]').click();
  const actions=page.locator('.friend-quick-actions');await expect(actions).toBeVisible();
  const actionY=await actions.boundingBox(),sectionY=await page.locator('#friendsConferenceSection').boundingBox();expect(actionY.y).toBeLessThan(sectionY.y);
  await page.locator('[data-target="settings"]').click();await expect(page.getByText('Compact layout',{exact:true})).toBeVisible();await page.locator('[data-target="program"]').click();
  const before=await page.locator('#programList [data-event]').first().evaluate(element=>element.getBoundingClientRect().height);
  await page.locator('[data-target="settings"]').click();await page.locator('#compactToggle').click();await expect(page.locator('html')).toHaveClass(/compact/);
  const compact=await page.locator('#programList [data-event]').first().evaluate(element=>element.getBoundingClientRect().height);expect(compact).toBeLessThan(before);
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();await expect(page.locator('html')).toHaveClass(/compact/);
  for(const view of ['posters','gallery','friends','settings']){await page.locator(`[data-target="${view}"]`).click();await expect(page.locator('html')).toHaveClass(/compact/);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);}
});

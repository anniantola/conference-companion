import {test,expect} from '@playwright/test';
import {copyFile,readFile} from 'node:fs/promises';
import {readStoredZip} from '../../src/zip.js';

async function inspectDownload(page,template){
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#exportPptxConfirm').click();
  const download=await downloadPromise,bytes=await readFile(await download.path()),archive=await readStoredZip(new Blob([bytes]));
  return {download,archive,xml:name=>new TextDecoder().decode(archive.get(name)||new Uint8Array())};
}

test('PowerPoint templates retain editable content, University master/layouts and private opt-in',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#programList')).not.toBeEmpty();
  const seeded=await page.evaluate(async()=>{
    let stage='start';try{
    const conference=window.CONFERENCE_CONFIG.conference,model=window.CONFERENCE_MODEL,event=model.items[0],
      {createUserStore,attendeeStorageId,encodeStoredValue}=await import('/src/user-store.js'),store=createUserStore(conference.id),
      storageId=attendeeStorageId(conference.id),friend={id:'pptx-private-test',name:'Archive Contact',privateNotes:'PRIVATE-UTU-SECRET',email:'private@example.invalid'};
    const longTitle='Long presentation title demonstrating continuation slides · '+('University template integration check · '.repeat(5));
    stage='save-state';await store.saveState({favorites:[],posterFavorites:[],notes:{[`event:${event.id}`]:'Editable Unicode note: Turku — café. '+('Long note sentence. '.repeat(24))}});
    stage='open-photo-db';const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(`conferenceCompanion:${storageId}:photos`,1);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('photos',{keyPath:'id',autoIncrement:true});s.createIndex('ownerKey','ownerKey',{unique:false});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    stage='get-photo';
    const blob=await fetch('/icon-192.png').then(response=>response.blob());
    const privateCaption='PRIVATE-GALLERY-CAPTION-'+('Long caption detail. '.repeat(10));friend.privatePhotos=[{id:'private-gallery-1',blob,thumbnailBlob:blob,caption:privateCaption,customNote:'PRIVATE-GALLERY-NOTE',createdAt:1},{id:'private-gallery-2',blob,thumbnailBlob:blob,caption:'Second private gallery image',customNote:'Private meeting photograph',createdAt:2}];
    stage='save-friend';await store.saveFriend(friend);
    stage='insert-photo';const stored=await encodeStoredValue({blob,thumbnailBlob:blob});await new Promise((resolve,reject)=>{const tx=db.transaction('photos','readwrite'),photos=tx.objectStore('photos');for(let i=0;i<2;i++)photos.add({ownerKey:`unclassified-photo:${i+1}`,ownerType:'unclassified',ownerId:String(i+1),name:`photo-${i+1}.png`,originalType:'image/png',addedAt:Date.now()+i,customTitle:longTitle,customNote:`Personal photo note ${i+1}`,blob:stored.blob,thumbnailBlob:stored.thumbnailBlob});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return event.id;
    }catch(error){return `__seed_error__${stage}:${error?.stack||String(error)}`;}
  });
  if(typeof seeded==='string'&&seeded.startsWith('__seed_error__'))throw new Error(seeded);
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();
  await page.locator('[data-target="settings"]').click();await page.locator('#exportPptxBtn').click();
  await expect(page.locator('#exportPptxDialog')).toBeVisible();
  await expect(page.locator('#exportPptxTemplate')).toHaveValue('standard');
  await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  const standardResult=await inspectDownload(page,'standard'),standardSlides=[...standardResult.archive.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name=>standardResult.xml(name)).join('\n');
  expect(standardSlides).toContain('Turku');expect(standardSlides).toContain('Long presentation title demonstrating continuation slides');expect(standardSlides).not.toContain('PRIVATE-UTU-SECRET');
  expect(standardResult.archive.has('ppt/media/image1.jpg')).toBeTruthy();
  await copyFile(await standardResult.download.path(),'/tmp/standard-conference-export.pptx');
  await page.locator('#exportPptxBtn').click();await expect(page.locator('#exportPptxTemplate')).toHaveValue('standard');

  await page.locator('#exportPptxTemplate').selectOption('utu');
  await expect(page.locator('#exportPptxTemplate')).toHaveValue('utu');
  await page.locator('#exportPptxFriends').check();
  await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  const offlineBlob=await page.evaluate(async()=>{const r=await fetch('./assets/utu-template.zip');return {ok:r.ok,size:(await r.blob()).size};});
  expect(offlineBlob.ok).toBeTruthy();expect(offlineBlob.size).toBeGreaterThan(100000);
  await context.setOffline(true);
  const result=await inspectDownload(page,'utu');
  await context.setOffline(false);
  const ppt=result.archive;
  expect(ppt.has('ppt/slideMasters/slideMaster1.xml')).toBeTruthy();
  expect(ppt.has('ppt/theme/theme1.xml')).toBeTruthy();
  expect([...ppt.keys()].filter(name=>/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))).toHaveLength(27);
  const presentation=result.xml('ppt/presentation.xml');expect(presentation).toContain('<p:sldMasterId id="2147483648" r:id="rId1"/>');expect(presentation).toContain('embeddedFontLst');
  const master=result.xml('ppt/slideMasters/slideMaster1.xml');expect(master).toContain('sldLayoutIdLst');
  const theme=result.xml('ppt/theme/theme1.xml');expect(theme).toContain('Noto Sans');expect(theme).toContain('Playfair Display');
  expect([...ppt.keys()].filter(name=>/^ppt\/fonts\/font\d+\.fntdata$/.test(name))).toHaveLength(14);
  expect((result.xml('ppt/_rels/presentation.xml.rels').match(/relationships\/font"/g)||[])).toHaveLength(14);
  expect(result.xml('ppt/slides/_rels/slide1.xml.rels')).toContain('../slideLayouts/slideLayout1.xml');
  const slideNames=[...ppt.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
  expect(slideNames.length).toBeGreaterThan(2);
  const slideXml=slideNames.map(name=>result.xml(name)).join('\n');
  expect(slideXml).toContain('Turku');expect(slideXml).toContain('Long presentation title demonstrating continuation slides');expect(slideXml).not.toContain('PRIVATE-UTU-SECRET');expect(slideXml).not.toContain('PRIVATE-GALLERY-CAPTION');
  expect(slideXml).toContain('r:embed="rId2"');
  const imageRelations=[...ppt.keys()].filter(name=>/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name)).map(name=>result.xml(name));
  expect(imageRelations.some(value=>value.includes('../media/image1.jpg'))).toBeTruthy();
  expect(imageRelations.some(value=>value.includes('../media/image2.jpg'))).toBeTruthy();
  for(const name of ppt.keys())if(name.endsWith('.rels')){
    const owner=name==='_rels/.rels'?'':name.replace(/(^|\/)\_rels\/([^/]+)\.rels$/,'$1$2');
    for(const [,attributes] of result.xml(name).matchAll(/<Relationship\b([^>]*)\/?\s*>/g)){
      const target=attributes.match(/\bTarget="([^"]+)"/)?.[1],mode=attributes.match(/\bTargetMode="([^"]+)"/)?.[1];
      if(!target||mode==='External')continue;
      const resolved=decodeURIComponent(new URL(target,`https://ppt.invalid/${owner}`).pathname.slice(1));
      expect(ppt.has(resolved),`${name} target ${target}`).toBeTruthy();
    }
  }
  const contentTypes=result.xml('[Content_Types].xml');expect(contentTypes).toContain('presentationml.slide+xml');expect(contentTypes).toContain('image/jpeg');
  expect(ppt.has('ppt/media/image1.jpg')).toBeTruthy();
  await copyFile(await result.download.path(),'/tmp/utu-template-export.pptx');

  await page.locator('#exportPptxBtn').click();
  await expect(page.locator('#exportPptxTemplate')).toHaveValue('utu');
  await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  await page.locator('#exportPptxFriends').check();
  await page.locator('#exportPptxPrivate').check();
  const privateResult=await inspectDownload(page,'utu');
  const privateSlides=[...privateResult.archive.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name=>privateResult.xml(name)).join('\n');
  expect(privateSlides).toContain('PRIVATE-UTU-SECRET');
  expect(privateSlides).toContain('private@example.invalid');
  expect(privateSlides).toContain('PRIVATE-GALLERY-CAPTION');expect(privateSlides).toContain('PRIVATE-GALLERY-NOTE');
  await copyFile(await privateResult.download.path(),'/tmp/utu-private-export.pptx');
  expect(seeded).toBeTruthy();
});

import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const row=(id,title,speaker,ids,chair='',chairId='')=>({id,date:'2031-06-10',start:'09:00',end:'09:30',type:'talk',session:'Identity session',title,speaker,chair,location:'Room A',track:'Common',speakerEntityIds:ids,chairEntityIds:chairId?[chairId]:[],personIdentityAssignments:{speaker:Object.fromEntries(ids.map((personId,index)=>[index,{personId,status:'confirmed'}])),...(chairId?{chair:{0:{personId:chairId,status:'confirmed'}}}:{})},manualEdited:true,manuallyCreated:true});
const stored=page=>page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return loadProject();});

test('bulk person edits preserve names, identities, reload and project backup',async({page})=>{
  await page.goto('/builder.html');await expect(page.locator('body')).toHaveAttribute('data-builder-ready','true');
  const project={conference:{id:'bulk-identity-fixture',name:'Bulk Identity Fixture',shortName:'Bulk',startDate:'2031-06-10',endDate:'2031-06-10',timezone:'Europe/Helsinki',venueName:'Main venue'},rows:[
    row('row-alex','Talk A','Alex Smith',['person-alex']),
    row('row-multiple','Talk B','Alex Smith; Sofia Brown',['person-alex','person-sofia']),
    row('row-chris','Talk C','Chris Green',['person-chris']),
    row('row-chair','Talk D','Dana West',['person-dana'],'Chair Old','person-chair-old')
  ],features:{},branding:{},identityRegistry:{people:{},locations:{},tracks:{}},peopleOverrides:{},peoplePhotos:{},extraPeople:[],dataVersion:1};
  await page.evaluate(async value=>{const {saveProject}=await import('/src/builder/project-store.js');await saveProject(value);},project);
  await page.reload();await expect(page.locator('body')).toHaveAttribute('data-builder-ready','true');await page.locator('[data-goto-step="3"]').click();
  await page.locator('[data-select-row="row-alex"]').check();await page.locator('[data-select-row="row-chris"]').check();
  await page.locator('#bulkField').selectOption('speaker');await page.locator('#bulkValue').fill('Maria Jones');await page.locator('#applyBulkEdit').click();
  await expect.poll(async()=>{const rows=(await stored(page)).rows;return rows.filter(item=>['row-alex','row-chris'].includes(item.id)).map(item=>item.speaker);}).toEqual(['Maria Jones','Maria Jones']);
  let saved=await stored(page);for(const id of ['row-alex','row-chris']){const changed=saved.rows.find(item=>item.id===id);expect(changed.speakerEntityIds).not.toContain(id==='row-alex'?'person-alex':'person-chris');expect(changed.personIdentityAssignments.speaker?.[0]?.status).not.toBe('confirmed');}
  await page.locator('[data-select-row="row-alex"]').uncheck();await page.locator('[data-select-row="row-chris"]').uncheck();await page.locator('[data-select-row="row-multiple"]').check();
  await page.locator('#bulkValue').fill('Alex Smith; Maya Brown');await page.locator('#applyBulkEdit').click();
  await expect.poll(async()=>(await stored(page)).rows.find(item=>item.id==='row-multiple').speaker).toBe('Alex Smith; Maya Brown');
  saved=await stored(page);let multiple=saved.rows.find(item=>item.id==='row-multiple');expect(multiple.speakerEntityIds[0]).toBe('person-alex');expect(multiple.speakerEntityIds[1]).not.toBe('person-sofia');expect(multiple.personIdentityAssignments.speaker[0]).toEqual({personId:'person-alex',status:'confirmed'});
  await page.locator('#applyBulkEdit').click();await expect.poll(async()=>(await stored(page)).rows.find(item=>item.id==='row-multiple').personIdentityAssignments.speaker[0]).toEqual({personId:'person-alex',status:'confirmed'});
  await page.locator('[data-select-row="row-multiple"]').uncheck();await page.locator('[data-select-row="row-chair"]').check();await page.locator('#bulkField').selectOption('chair');await page.locator('#bulkValue').fill('Chair New');await page.locator('#applyBulkEdit').click();
  await expect.poll(async()=>(await stored(page)).rows.find(item=>item.id==='row-chair').chair).toBe('Chair New');
  saved=await stored(page);expect(saved.rows.find(item=>item.id==='row-chair').chairEntityIds).not.toContain('person-chair-old');
  const rebuilt=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const {buildPackage}=await import('/src/builder/package.js');return (await buildPackage(await loadProject())).pkg;});
  expect(rebuilt.programme.presentations.find(item=>item.title==='Talk B').speakerIds).toContain('person-alex');
  await page.reload();await expect(page.locator('body')).toHaveAttribute('data-builder-ready','true');saved=await stored(page);expect(saved.rows.find(item=>item.id==='row-multiple').personIdentityAssignments.speaker[0].personId).toBe('person-alex');
  const downloadEvent=page.waitForEvent('download');await page.locator('#exportBuilderProject').click();const download=await downloadEvent,buffer=await readFile(await download.path());
  const reset=page.waitForNavigation();page.once('dialog',dialog=>dialog.accept());await page.locator('#resetProject').click();await reset;await expect(page.locator('body')).toHaveAttribute('data-builder-ready','true');
  const restore=page.waitForNavigation();const confirmation=page.waitForEvent('dialog');await page.locator('#builderProjectInput').setInputFiles({name:'bulk-project.zip',mimeType:'application/zip',buffer});await (await confirmation).accept();await restore;await expect(page.locator('body')).toHaveAttribute('data-builder-ready','true');
  saved=await stored(page);expect(saved.rows.find(item=>item.id==='row-multiple').personIdentityAssignments.speaker[0].personId).toBe('person-alex');expect(saved.rows.find(item=>item.id==='row-chair').chairEntityIds).not.toContain('person-chair-old');
});

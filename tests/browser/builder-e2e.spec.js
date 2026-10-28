import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readStoredZip,textEntry} from '../../src/zip.js';
import {synthetic91Csv} from '../../tools/synthetic-91-csv.js';

function pdfModuleStub(){
  const item=(str,x,y)=>({str,width:str.length*6,transform:[1,0,0,1,x,y]});
  const pages=[[
    item('2032-05-01',50,800),item('Track: North',50,770),item('Room: Hall A',50,740),item('Session: Methods',50,710),
    item('09:00–09:30 Recognized talk — Alex One',50,670),item('Programme footer — page 1',50,80)
  ],[item('09:30–10:00 Possible parallel item',50,700)]];
  return `export const GlobalWorkerOptions={};export function getDocument(){return{promise:Promise.resolve({numPages:${pages.length},getPage:async n=>({getTextContent:async()=>({items:${JSON.stringify(pages)}[n-1]})})})};}`;
}

test('Builder CSV import retains all 91 synthetic records and all 18 shared-slot posters',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-91-records.csv',mimeType:'text/csv',buffer:Buffer.from(synthetic91Csv())});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();
  await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toBeVisible();await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();
  await expect(page.locator('#rowCount')).toHaveText('91 rows');
  await expect(page.locator('#reviewTable tbody tr')).toHaveCount(91);
  const types=await page.locator('#reviewTable [data-field="type"]').evaluateAll(elements=>elements.map(el=>el.value));
  expect(types.filter(type=>type==='poster')).toHaveLength(18);
  await expect(page.locator('#reviewTable input[data-field="title"]').last()).toHaveValue('Synthetic poster 18');
  await page.setViewportSize({width:320,height:760});
  const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,elements:['.builder-shell','[data-step="3"]','.wizard-nav','.table-wrap','.bulk-edit-bar','.session-editor-wrap','.session-grid','#conflictPanel'].map(selector=>{const el=document.querySelector(selector),r=el?.getBoundingClientRect();return `${selector}: ${Math.round(r?.right||0)} / ${el?.scrollWidth}`;})}));
  expect(overflow.page,`Review table scrolls within its panel at 320px: ${overflow.elements.join(', ')}`).toBeLessThanOrEqual(overflow.viewport);
});

test('Builder produces a deployable synthetic multi-track, multi-poster conference',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track,posterNumber
2028-06-10,09:00,09:30,talk,Opening,Original title,Alex Example,Synthetic University,Hall A,Common,
2028-06-10,10:00,10:30,talk,Parallel research,Materials talk,Morgan Sample,Materials Lab,Hall A,Materials,
2028-06-10,10:00,10:30,talk,Parallel research,Devices talk,Taylor Sample,Devices Lab,Hall B,Devices,
2028-06-10,12:00,13:00,poster,Morning posters,Poster Alpha,Morgan Sample,Materials Lab,Hall B,Common,A1
2028-06-11,14:00,15:00,poster,Afternoon posters,Poster Beta,Taylor Sample,Devices Lab,Hall C,Common,B1
2028-06-11,18:00,20:00,social,Conference social,Evening reception,,,Offsite Venue,Common,`;
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-programme.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toBeVisible();await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();
  await expect(page.locator('#rowCount')).toHaveText('6 rows');
  await page.locator('[data-field="title"]').first().fill('Corrected opening title');
  const config={name:'Synthetic Conference',shortName:'SYN 2028',startDate:'2028-06-10',endDate:'2028-06-11',timezone:'Europe/Helsinki',city:'Helsinki',country:'Finland',venueName:'Synthetic Conference Center',venueAddress:'Example Street 1'};
  await page.locator('[data-goto-step="1"]').click();
  for(const [field,value] of Object.entries(config))await page.locator(`[data-config="${field}"]`).fill(value);
  await page.locator('[data-goto-step="8"]').click();
  await page.locator('#validateProject').click();await expect(page.locator('#validationReport .validation-error')).toHaveCount(0);

  const pending=page.waitForEvent('download');await page.locator('#downloadPackage').click();const download=await pending,path=await download.path();
  await expect(page.locator('#releaseStatus')).toContainText('No release confirmed as published');
  await expect(page.locator('#releaseStatus')).toContainText('Last exported: v1');
  await expect(page.locator('#dataVersion')).toHaveValue('1');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#confirmPublication').click();
  await expect(page.locator('#releaseStatus')).toContainText('Last confirmed published: v1');
  const entries=await readStoredZip(new Blob([await readFile(path)]));
  const get=name=>JSON.parse(textEntry(entries,`conference/${name}.json`));
  const conference=get('conference'),programme=get('programme');
  expect(conference.name).toBe('Synthetic Conference');expect(conference.features.posters).toBe(true);
  expect(programme.sessions.filter(x=>x.type==='poster-session')).toHaveLength(2);
  expect(new Set(programme.sessions.filter(x=>x.type==='poster-session').map(x=>x.locationId)).size).toBe(2);
  expect(programme.sessions.filter(x=>x.type==='social')).toHaveLength(1);
  expect(programme.presentations.find(x=>x.title==='Corrected opening title')).toBeTruthy();
  expect(programme.sessions.filter(x=>x.date==='2028-06-10'&&x.start==='10:00'&&x.presentationIds.length)).toHaveLength(2);

  await page.route('**/generated/conference/*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop(),body=entries.get(`conference/${name}`);return body?route.fulfill({body:Buffer.from(body),contentType:'application/json'}):route.fulfill({status:404});});
  await page.goto('/?conference=/generated/conference');await expect(page.locator('#programList')).not.toBeEmpty();await expect(page.locator('.conference-logo-fallback')).toHaveText('SYN 2028');await expect(page.locator('#programList')).toContainText('Corrected opening title');
  await page.locator('#dayTabs .day-tab').nth(1).click();await expect(page.locator('#programList')).toContainText('Conference social');
  await page.locator('[data-target="posters"]').click();await expect(page.locator('.poster-session-group')).toHaveCount(2);await expect(page.locator('#posterList')).toContainText('Poster Alpha');await expect(page.locator('#posterList')).toContainText('Poster Beta');
});

test('Builder keeps same-name people distinct until an organizer resolves the identity',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track
2028-04-10,09:00,09:30,talk,Methods,First talk,Alex Example,,Hall A,Methods
2028-04-10,10:00,10:30,talk,Methods,Second talk,Alex Example,,Hall A,Methods`;
  await page.locator('#programmeFile').setInputFiles({name:'ambiguous-people.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toBeVisible();await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();
  const identities=page.locator('#reviewTable select[data-person-identity]');await expect(identities).toHaveCount(2);
  const firstChoices=identities.nth(0).locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
  const secondChoices=identities.nth(1).locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
  const [first,second]=await Promise.all([firstChoices,secondChoices]);expect(first).toHaveLength(2);expect(second).toEqual(first);
  await identities.nth(0).selectOption(first[1]);
  await expect(page.locator('#reviewTable select[data-person-identity]')).toHaveCount(1);
  await page.locator('#reviewTable select[data-person-identity]').selectOption(first[1]);
  await expect(page.locator('#reviewTable select[data-person-identity]')).toHaveCount(0);
  await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#validationReport')).not.toContainText('Ambiguous person identity');
});

test('identity review shows programme context and persists an explicit different-people decision',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track
2032-04-10,09:00,09:30,talk,Neural systems,North presentation,Alex Same,North Institute,Hall A,North
2032-04-10,10:00,10:30,talk,Clinical methods,South presentation,Alex Same,South Institute,Hall B,South`;
  await page.locator('#programmeFile').setInputFiles({name:'identity-context.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toBeVisible();await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#duplicateReview')).toBeVisible();
  const group=page.locator('[data-duplicate-group]').first();await expect(group).toContainText('North presentation');await expect(group).toContainText('South presentation');await expect(group).toContainText('identity-context.csv');
  await group.locator('[data-identity-decision]').selectOption('different');await group.locator('[data-apply-identity]').click();
  await expect(page.locator('#duplicateReview')).toContainText('No unresolved same-name identity groups');
  const saved=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return loadProject();});
  expect(Object.values(saved.identityDecisions.pairs)).toContain('different');
  await page.reload();await expect(page.locator('[data-step="4"]')).toBeVisible();await expect(page.locator('#duplicateCount')).toHaveText('');
  await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#validationReport')).not.toContainText('Ambiguous person identity');
});

test('multiple programme sources preview cross-file matches, preserve edits, and can be removed safely',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const first=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-05-01,09:00,09:30,talk,Methods,Source title,Alex One,Lab,Hall A,Track A`;
  await page.locator('#programmeFile').setInputFiles({name:'programme.csv',mimeType:'text/csv',buffer:Buffer.from(first)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await page.locator('[data-field="title"]').fill('Organizer corrected title');await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  await page.locator('[data-goto-step="2"]').click();
  const second=JSON.stringify([{date:'2032-05-01',start:'09:00',end:'09:30',type:'talk',session:'Methods',title:'Source title',speaker:'Alex One',affiliation:'Lab',room:'Hall A',track:'Track A'}]);
  await page.locator('#programmeFile').setInputFiles({name:'programme-revised.json',mimeType:'application/json',buffer:Buffer.from(second)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toContainText('1 unchanged');await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Organizer corrected title');
  await page.locator('[data-goto-step="2"]').click();await expect(page.locator('#sourceManager [data-source-record]')).toHaveCount(2);
  await page.locator('#sourceManager [data-source-record]').first().locator('summary').click();
  await page.locator('[data-remove-source]').first().click();await expect(page.locator('#sourceRemovalDialog')).toBeVisible();
  await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();
  await expect(page.locator('[data-removal-impact="entriesRetainedByOtherSources"]')).toHaveText('1');
  await expect(page.locator('[data-removal-impact="programmeEntriesToDelete"]')).toHaveText('0');
  await page.locator('#cancelSourceRemoval').click();await expect(page.locator('#sourceRemovalDialog')).toBeHidden();
  await expect(page.locator('#sourceManager [data-source-record]')).toHaveCount(2);
  await page.locator('[data-remove-source]').first().click();
  await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();await page.locator('#confirmSourceRemoval').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Organizer corrected title');
  await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).toContainText('Alex One');
});

test('removing the last programme source updates rendered people, locations and attendee preview while preserving independent records',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-config="name"]').fill('Source removal pilot');await page.locator('[data-config="shortName"]').fill('Removal');
  await page.locator('[data-config="startDate"]').fill('2032-05-05');await page.locator('[data-config="endDate"]').fill('2032-05-05');
  await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track,posterNumber\n2032-05-05,09:00,09:30,talk,Methods,Imported talk,Ada Import,Imported Lab,Hall A,North,\n2032-05-05,12:00,13:00,poster,Poster session,Imported poster,Bea Poster,Poster Lab,Poster Hall,Common,P1`;
  await page.locator('#programmeFile').setInputFiles({name:'last-source.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('2 rows');
  await page.locator('[data-row="0"][data-field="title"]').fill('Corrected imported talk');
  await page.locator('#addRow').click();const manualIndex=2;
  for(const [field,value] of Object.entries({date:'2032-05-05',start:'16:00',end:'16:30',session:'Organizer session',title:'Manual event',location:'Independent room',track:'Independent track'}))await page.locator(`[data-row="${manualIndex}"][data-field="${field}"]`).fill(value);
  await page.locator('[data-goto-step="4"]').click();await page.locator('#addPerson').click();await page.locator('#personEditor [data-edit-field="name"]').fill('Independent person');await page.locator('#personEditor [data-edit-field="affiliation"]').fill('Independent lab');await page.locator('#personEditForm button[type="submit"]').click();
  await page.locator('[data-goto-step="5"]').click();await page.locator('#addLocation').click();const independentLocation=page.locator('[data-location-editor]').filter({has:page.locator('[data-location-field="name"][value="New location"]')});
  await independentLocation.locator('[data-location-field="name"]').fill('Independent room');await independentLocation.locator('[data-location-field="name"]').dispatchEvent('change');
  await page.locator('[data-goto-step="2"]').click();await page.locator('#sourceManager [data-source-record] summary').click();await page.locator('[data-remove-source]').click();
  await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();
  await expect(page.locator('[data-removal-impact="programmeEntriesToDelete"]')).toHaveText('2');
  await expect(page.locator('[data-removal-impact="manuallyEditedEntriesAffected"]')).toHaveText('1');
  await expect(page.locator('[data-removal-impact="peopleDisappearing"]')).toHaveText('2');
  await expect(page.locator('[data-removal-impact="postersAffected"]')).toHaveText('1');
  await page.locator('#cancelSourceRemoval').click();await page.locator('[data-remove-source]').click();await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();await page.locator('#confirmSourceRemoval').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Manual event');await expect(page.locator('#reviewTable input[data-field="title"]')).not.toHaveValue('Corrected imported talk');
  await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).toContainText('Independent person');await expect(page.locator('#peoplePreview')).not.toContainText('Ada Import');await expect(page.locator('#peoplePreview')).not.toContainText('Bea Poster');
  await page.locator('[data-goto-step="5"]').click();await expect(page.locator('#locationsPreview')).toContainText('Independent room');await expect(page.locator('#locationsPreview')).not.toContainText('Poster Hall');
  await page.locator('[data-goto-step="8"]').click();await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).toContain('Manual event');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).not.toContain('Imported talk');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).not.toContain('Imported poster');
  const stored=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return loadProject();});
  expect(stored.sourceFiles).toHaveLength(0);expect(stored.rows.map(row=>row.title)).toEqual(['Manual event']);expect(stored.rows[0].source).toBeUndefined();expect(stored.rows[0].manuallyMaintained).toBeFalsy();
  await page.reload();await expect(page.locator('[data-step="8"]')).toBeVisible();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Manual event');
  await page.locator('[data-goto-step="8"]').click();await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).toContain('Manual event');
  const backupPromise=page.waitForEvent('download');await page.locator('#exportBuilderProject').click();const backup=await backupPromise;
  page.once('dialog',dialog=>dialog.accept());await page.locator('#resetProject').click();await expect(page.locator('[data-step="1"]')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.locator('#builderProjectInput').setInputFiles(await backup.path());await expect.poll(()=>page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject())?.rows?.[0]?.title;})).toBe('Manual event');
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Manual event');
  const restored=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return loadProject();});expect(restored.sourceFiles).toHaveLength(0);expect(restored.rows[0].source).toBeUndefined();
});

test('preserved corrections become independent records and reimport requires an explicit match',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-config="name"]').fill('Manual record pilot');await page.locator('[data-config="shortName"]').fill('Manual');await page.locator('[data-config="startDate"]').fill('2032-05-06');await page.locator('[data-config="endDate"]').fill('2032-05-06');await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-05-06,09:00,09:30,talk,Methods,Imported title,Alex Researcher,North Lab,Hall A,North`;
  const upload=()=>page.locator('#programmeFile').setInputFiles({name:'manual-preserve.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await upload();await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();await page.locator('[data-field="title"]').fill('Organizer correction');await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  const before=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const row=(await loadProject()).rows[0];return {id:row.id,calendarUid:row.calendarUid};});
  await page.locator('[data-goto-step="2"]').click();await page.locator('#sourceManager [data-source-record] summary').click();await page.locator('[data-remove-source]').click();await page.locator('[name="sourceRemovalStrategy"][value="preserve-edited"]').check();
  await expect(page.locator('[data-removal-impact="programmeEntriesToDelete"]')).toHaveText('0');await expect(page.locator('[data-removal-impact="entriesRetainedAsManual"]')).toHaveText('1');await page.locator('#confirmSourceRemoval').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Organizer correction');await expect(page.locator('#reviewTable')).toContainText('Manually maintained');
  const detached=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject()).rows[0];});expect(detached.id).toBe(before.id);expect(detached.calendarUid).toBe(before.calendarUid);expect(detached.source).toBeUndefined();expect(detached.manuallyMaintained).toBe(true);
  await page.reload();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Organizer correction');await expect(page.locator('#reviewTable')).toContainText('Manually maintained');
  await page.locator('[data-goto-step="2"]').click();await upload();await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toContainText('1 uncertain matches');
  const choice=page.locator('[data-import-match]');await expect(choice.locator('option')).toHaveCount(3);const stillDetached=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject()).rows[0];});expect(stillDetached.title).toBe('Organizer correction');expect(stillDetached.source).toBeUndefined();
  await choice.selectOption(before.id);await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Organizer correction');
  const after=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject()).rows[0];});expect(after.id).toBe(before.id);expect(after.calendarUid).toBe(before.calendarUid);
});

test('a failed source-removal storage transaction leaves both the live and saved programme intact',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-05-07,09:00,09:30,talk,Methods,Keep on failure,Ada Example,Lab,Hall A,North`;
  await page.locator('#programmeFile').setInputFiles({name:'atomic-removal.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.originalProjectPut=put;IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(window.failProjectWrite&&this.name==='projects')queueMicrotask(()=>{try{this.transaction.abort();}catch{}});return result;};window.failProjectWrite=true;});
  await page.locator('#sourceManager [data-source-record] summary').click();await page.locator('[data-remove-source]').click();await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();await page.locator('#confirmSourceRemoval').click();
  await expect(page.locator('#builderSaveStatus')).toContainText('previous project remains intact');await expect(page.locator('#sourceRemovalDialog')).toBeVisible();
  const saved=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return loadProject();});expect(saved.sourceFiles).toHaveLength(1);expect(saved.rows).toHaveLength(1);expect(saved.rows[0].title).toBe('Keep on failure');
  await page.evaluate(()=>{window.failProjectWrite=false;IDBObjectStore.prototype.put=window.originalProjectPut;});await page.locator('#cancelSourceRemoval').click();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Keep on failure');
});

test('CSV followed by an overlapping XLSX source is matched before one atomic import',async({page})=>{
  await page.route('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs',route=>route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:`export function read(){return{SheetNames:['Schedule'],Sheets:{Schedule:{}}}};export const utils={sheet_to_json(){return[{date:'2032-05-02',start:'09:00',end:'09:30',type:'talk',session:'Methods',title:'Shared entry',speaker:'Alex One',affiliation:'Lab',room:'Hall A',track:'Track A'}]}};`}));
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-05-02,09:00,09:30,talk,Methods,Shared entry,Alex One,Lab,Hall A,Track A`;
  await page.locator('#programmeFile').setInputFiles({name:'programme.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();
  await page.locator('#programmeFile').setInputFiles({name:'programme.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic workbook bytes')});await page.locator('#importProgramme').click();
  await expect(page.locator('#mappingCard')).toBeVisible();await expect(page.locator('#importStatus')).toContainText('1 rows loaded from Schedule');await page.locator('#applyMapping').click();
  await expect(page.locator('#importReview')).toContainText('1 unchanged');await expect(page.locator('#importReview')).toContainText('0 new');
  const before=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js'),p=await loadProject();return p.rows.length;});expect(before).toBe(1,'overlapping XLSX preview must not write duplicated rows');
  await page.locator('#confirmImportChanges').click();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Shared entry');
  await page.locator('[data-goto-step="2"]').click();await expect(page.locator('#sourceManager [data-source-record]')).toHaveCount(2);
  const xlsxSource=page.locator('#sourceManager [data-source-record]').filter({hasText:'programme.xlsx'});await xlsxSource.locator('summary').click();await xlsxSource.locator('[data-remove-source]').click();await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();
  await expect(page.locator('[data-removal-impact="programmeEntriesToDelete"]')).toHaveText('0');await expect(page.locator('[data-removal-impact="entriesRetainedByOtherSources"]')).toHaveText('1');await page.locator('#confirmSourceRemoval').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Shared entry');await page.locator('[data-goto-step="2"]').click();await expect(page.locator('#sourceManager [data-source-record]')).toHaveCount(1);
});

test('uncertain cross-file matches require an explicit decision and can be retained separately',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const first=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-05-03,09:00,09:30,talk,Methods,Original title,Alex One,Lab,Hall A,Track A`;
  await page.locator('#programmeFile').setInputFiles({name:'original.csv',mimeType:'text/csv',buffer:Buffer.from(first)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();
  const revised=JSON.stringify([{date:'2032-05-03',start:'09:00',end:'09:30',type:'talk',session:'Methods',title:'Renamed title',speaker:'Alex One',affiliation:'Lab',room:'Hall A',track:'Track A'}]);
  await page.locator('#programmeFile').setInputFiles({name:'revised.json',mimeType:'application/json',buffer:Buffer.from(revised)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();
  await expect(page.locator('#importReview')).toContainText('1 uncertain matches');await expect(page.locator('[data-import-match]')).toHaveValue('');
  await page.locator('#confirmImportChanges').click();await expect(page.locator('#toast')).toContainText('Choose a match or explicitly keep each uncertain entry separate');
  await page.locator('[data-import-match]').selectOption('__separate__');await page.locator('#confirmImportChanges').click();await expect(page.locator('#importReview')).toBeHidden();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('2 rows');const titles=page.locator('#reviewTable [data-field="title"]');await expect(titles).toHaveCount(2);await expect(titles.nth(0)).toHaveValue('Original title');await expect(titles.nth(1)).toHaveValue('Renamed title');
});

test('PDF entries stay staged while unrecognized text and uncertain entries are reviewed',async({page})=>{
  await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.mjs',route=>route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:pdfModuleStub()}));
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'layout-review.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic test bytes')});await page.locator('#importProgramme').click();
  await expect(page.locator('#pdfReview')).toBeVisible();await expect(page.locator('#pdfReview')).toContainText('2 pages');await expect(page.locator('#pdfReview')).toContainText('Programme footer');
  const unchanged=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const project=await loadProject();return project?.rows?.length||0;});expect(unchanged).toBe(0,'PDF extraction must not write programme rows before organizer confirmation');
  await expect(page.locator('#pdfReview [data-pdf-entry]')).toHaveCount(2);await expect(page.locator('#pdfReview [data-pdf-entry="1"] [data-pdf-include]')).not.toBeChecked();
  await page.locator('#pdfReview [data-pdf-entry="0"] [data-pdf-field="title"]').fill('Corrected programme title');await page.locator('#previewPdfChanges').click();
  await expect(page.locator('#importReview')).toContainText('1 new');await expect(page.locator('#importReview')).toContainText('0 scheduled for removal');await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Corrected programme title');
});

test('source replacement previews removals, supports cancellation and keeps conference settings',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-config="name"]').fill('Preserved Conference Details');await page.locator('[data-goto-step="2"]').click();
  const original=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-06-01,09:00,09:30,talk,Methods,Alpha,Alex One,Lab,Hall A,North\n2032-06-01,10:00,10:30,talk,Methods,Beta,Bob Two,Lab,Hall B,South`;
  await page.locator('#programmeFile').setInputFiles({name:'schedule.csv',mimeType:'text/csv',buffer:Buffer.from(original)});await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await page.locator('[data-field="title"]').first().fill('Organizer correction');await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');await page.locator('[data-goto-step="2"]').click();
  const revised=`date,start,end,type,session,title,speaker,affiliation,room,track\n2032-06-01,09:00,09:30,talk,Methods,Alpha,Alex One,Lab,Hall A,North`;
  await page.locator('#programmeFile').setInputFiles({name:'schedule.csv',mimeType:'text/csv',buffer:Buffer.from(revised)});await page.locator('#importProgramme').click();await page.locator('#importMode').selectOption('replace-source');await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toContainText('1 scheduled for removal');await page.locator('#cancelImportPreview').click();
  const afterCancel=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js'),p=await loadProject();return{rows:p.rows.length,name:p.conference.name};});expect(afterCancel).toEqual({rows:2,name:'Preserved Conference Details'});
  await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toContainText('1 scheduled for removal');await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Organizer correction');
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{date:'2032-06-02',start:'11:00',end:'11:30',type:'talk',session:'Results',title:'Gamma',speaker:'Cara Three',affiliation:'Lab',room:'Hall C',track:'West'}]))});await page.locator('#importProgramme').click();await page.locator('#importMode').selectOption('replace-programme');await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toContainText('calendar identifiers');await expect(page.locator('#importReview')).toContainText('1 scheduled for removal');await page.locator('#confirmImportChanges').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('[data-field="title"]')).toHaveValue('Gamma');await page.locator('[data-goto-step="1"]').click();await expect(page.locator('[data-config="name"]')).toHaveValue('Preserved Conference Details');
});

import {test,expect} from '@playwright/test';

async function importCsv(page,name,csv){
  await page.locator('#programmeFile').setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();
  await page.locator('#applyMapping').click();await expect(page.locator('#importReview')).toBeVisible();
  await page.locator('#confirmImportChanges').click();await expect(page.locator('#sourceManager [data-source-record]')).toHaveCount(1);
}
async function storedProject(page){return page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return loadProject();});}
async function assertPreviewText(page,text,expected=true){
  const content=expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||''));
  if(expected)await content.toContain(text);else await content.not.toContain(text);
}

test('legacy source removal deletes corrected records through UI, IndexedDB, reload and backup restore',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-config="name"]').fill('Legacy source cleanup');await page.locator('[data-config="shortName"]').fill('Cleanup');await page.locator('[data-config="startDate"]').fill('2033-05-04');await page.locator('[data-config="endDate"]').fill('2033-05-04');
  await page.locator('[data-goto-step="2"]').click();
  const csv='date,start,end,type,session,title,speaker,affiliation,room,track,posterNumber\n2033-05-04,09:00,09:30,talk,Methods,Imported talk,Ada Imported,Imported Lab,Hall A,North,\n2033-05-04,12:00,13:00,poster,Poster hour,Imported poster,Bea Poster,Poster Lab,Poster Hall,Common,P1';
  await importCsv(page,'historical-programme.csv',csv);
  await page.locator('[data-goto-step="3"]').click();await page.locator('[data-row="0"][data-field="title"]').fill('Organizer corrected imported talk');await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  await page.locator('#addRow').click();const manual=2;
  await expect(page.locator('#rowCount')).toHaveText('3 rows');
  for(const [field,value] of Object.entries({date:'2033-05-04',start:'16:00',end:'16:30',session:'Organizer event',title:'Independent manual event',location:'Independent room',track:'Common'}))await page.locator(`[data-row="${manual}"][data-field="${field}"]`).fill(value);await page.locator(`[data-row="${manual}"][data-field="type"]`).selectOption('social');
  await expect.poll(async()=> (await storedProject(page)).rows.length).toBe(3);
  await page.locator('[data-goto-step="4"]').click();await page.locator('#addPerson').click();await page.locator('#personEditor [data-edit-field="name"]').fill('Independent organizer');await page.locator('#personEditor [data-edit-field="affiliation"]').fill('Organizer Group');await page.locator('#personEditForm button[type="submit"]').click();await expect.poll(async()=>(await storedProject(page)).extraPeople?.some(person=>person.name==='Independent organizer')).toBe(true);
  // Reproduce legacy backups that lost the current row.source object after a
  // correction, while retaining the old import journal and its field mapping.
  await page.evaluate(async()=>{const {loadProject,saveProject}=await import('/src/builder/project-store.js');const p=await loadProject();for(const row of p.rows.slice(0,2))delete row.source;await saveProject(p);});
  await page.reload();await page.locator('[data-goto-step="2"]').click();
  await expect(page.locator('#sourceManager')).toContainText('2 programme entries');await expect(page.locator('#orphanProgrammeSummary')).toContainText('All programme entries have clear source or manual provenance');
  await page.locator('#sourceManager [data-source-record] summary').click();await page.locator('[data-remove-source]').click();await page.locator('[name="sourceRemovalStrategy"][value="remove-associated"]').check();
  await expect(page.locator('[data-removal-impact="programmeEntriesToDelete"]')).toHaveText('2');await page.locator('#confirmSourceRemoval').click();
  await expect(page.locator('#toast')).toContainText('2 programme entries deleted');
  let saved=await storedProject(page);expect(saved.rows.map(row=>row.title)).toEqual(['Independent manual event']);expect(saved.sourceFiles).toHaveLength(0);expect(saved.sourceState).toHaveLength(0);
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await expect(page.locator('#reviewTable input[data-field="title"]')).toHaveValue('Independent manual event');
  await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).not.toContainText('Ada Imported');await expect(page.locator('#peoplePreview')).not.toContainText('Bea Poster');await expect(page.locator('#peoplePreview')).toContainText('Independent organizer');
  await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await assertPreviewText(page,'Organizer corrected imported talk',false);await assertPreviewText(page,'Imported poster',false);await assertPreviewText(page,'Organizer event');
  await page.reload();saved=await storedProject(page);expect(saved.rows.map(row=>row.title)).toEqual(['Independent manual event']);
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).not.toContainText('Ada Imported');
  await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await assertPreviewText(page,'Imported poster',false);
  const backup=page.waitForEvent('download');await page.locator('#exportBuilderProject').click();const download=await backup;
  page.once('dialog',dialog=>dialog.accept());const reset=page.waitForNavigation();await page.locator('#resetProject').click();await reset;
  page.once('dialog',dialog=>dialog.accept());const restored=page.waitForNavigation();await page.locator('#builderProjectInput').setInputFiles(await download.path());await restored;
  saved=await storedProject(page);expect(saved.rows.map(row=>row.title)).toEqual(['Independent manual event']);expect(saved.sourceFiles).toHaveLength(0);
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('1 rows');await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).not.toContainText('Bea Poster');
  await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await assertPreviewText(page,'Imported talk',false);
});

test('Clear imported programme reviews uncertain rows and persists the explicit deletion choice',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-config="name"]').fill('Clear imported programme');await page.locator('[data-config="shortName"]').fill('Clear');await page.locator('[data-config="startDate"]').fill('2033-06-01');await page.locator('[data-config="endDate"]').fill('2033-06-01');await page.locator('[data-goto-step="2"]').click();
  const csv='date,start,end,type,session,title,speaker,affiliation,room,track\n2033-06-01,09:00,09:30,talk,Methods,Known imported,Alex Known,Known Lab,Hall A,North\n2033-06-01,10:00,10:30,talk,Methods,Orphan imported,Blair Orphan,Orphan Lab,Hall B,North';
  await importCsv(page,'clear-data.csv',csv);
  await page.evaluate(async()=>{const {loadProject,saveProject}=await import('/src/builder/project-store.js');const p=await loadProject();delete p.rows[1].source;p.sourceState=[];await saveProject(p);});await page.reload();await page.locator('[data-goto-step="2"]').click();
  await page.locator('#clearImportedProgramme').click();await expect(page.locator('#clearProgrammeDialog')).toBeVisible();
  await expect(page.locator('[data-clear-impact="importedEntriesToDelete"]')).toHaveText('1');await expect(page.locator('[data-clear-impact="orphanedEntriesUncertain"]')).toHaveText('1');await expect(page.locator('#confirmClearProgramme')).toBeDisabled();
  const orphan=page.locator('[data-uncertain-row]');await expect(orphan).toContainText('Orphan imported');await orphan.locator('input[value="delete"]').check();await page.locator('#confirmClearProgramme').click();
  let saved=await storedProject(page);expect(saved.rows).toHaveLength(0);expect(saved.sourceFiles).toHaveLength(0);expect(saved.sourceState).toHaveLength(0);
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('0 rows');await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).not.toContainText('Alex Known');await expect(page.locator('#peoplePreview')).not.toContainText('Blair Orphan');
  await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await assertPreviewText(page,'Known imported',false);await page.reload();saved=await storedProject(page);expect(saved.rows).toHaveLength(0);await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('0 rows');await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).not.toContainText('Alex Known');await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await assertPreviewText(page,'Known imported',false);
  const backup=page.waitForEvent('download');await page.locator('#exportBuilderProject').click();const download=await backup;page.once('dialog',dialog=>dialog.accept());const reset=page.waitForNavigation();await page.locator('#resetProject').click();await reset;page.once('dialog',dialog=>dialog.accept());const restored=page.waitForNavigation();await page.locator('#builderProjectInput').setInputFiles(await download.path());await restored;saved=await storedProject(page);expect(saved.rows).toHaveLength(0);await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#rowCount')).toHaveText('0 rows');await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#peoplePreview')).not.toContainText('Alex Known');await page.locator('[data-goto-step="8"]').click();await expect(page.locator('#previewStatus')).toHaveText('Up to date');await assertPreviewText(page,'Known imported',false);
});

test('Clear imported programme cancellation and explicit retention preserve uncertain organizer data',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const csv='date,start,end,type,session,title,speaker,affiliation,room,track\n2033-07-01,09:00,09:30,talk,Methods,Imported talk,Ada Import,Lab,Hall A,North';await importCsv(page,'cancel-clear.csv',csv);
  await page.evaluate(async()=>{const {loadProject,saveProject}=await import('/src/builder/project-store.js');const p=await loadProject();delete p.rows[0].source;p.sourceState=[];await saveProject(p);});await page.reload();await page.locator('[data-goto-step="2"]').click();
  const before=await storedProject(page);await page.locator('#clearImportedProgramme').click();await page.locator('[data-uncertain-row] input[value="keep"]').check();await page.locator('#cancelClearProgramme').click();expect((await storedProject(page)).rows).toHaveLength(before.rows.length);
  await page.locator('#clearImportedProgramme').click();await page.locator('[data-uncertain-row] input[value="keep"]').check();await page.locator('#confirmClearProgramme').click();
  const after=await storedProject(page);expect(after.rows).toHaveLength(1);expect(after.rows[0].manuallyMaintained).toBe(true);expect(after.rows[0].source).toBeUndefined();await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#reviewTable')).toContainText('Manually maintained');
});

test('failed Clear imported programme persistence leaves the prior IndexedDB project intact',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();const csv='date,start,end,type,session,title,speaker,affiliation,room,track\n2033-08-01,09:00,09:30,talk,Methods,Keep after failure,Ada Saved,Lab,Hall A,North';await importCsv(page,'failed-clear.csv',csv);
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.originalProjectPut=put;IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(window.failProjectWrite&&this.name==='projects')queueMicrotask(()=>{try{this.transaction.abort();}catch{}});return result;};window.failProjectWrite=true;});
  await page.locator('#clearImportedProgramme').click();await expect(page.locator('[data-clear-impact="importedEntriesToDelete"]')).toHaveText('1');await page.locator('#confirmClearProgramme').click();
  await expect(page.locator('#builderSaveStatus')).toContainText('previous project remains intact');const saved=await storedProject(page);expect(saved.rows).toHaveLength(1);expect(saved.rows[0].title).toBe('Keep after failure');expect(saved.sourceFiles).toHaveLength(1);
  await page.evaluate(()=>{window.failProjectWrite=false;IDBObjectStore.prototype.put=window.originalProjectPut;});await page.locator('#cancelClearProgramme').click();
});

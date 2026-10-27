import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {synthetic91Csv} from '../../tools/synthetic-91-csv.js';

async function importSynthetic(page){
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-91-people.csv',mimeType:'text/csv',buffer:Buffer.from(synthetic91Csv())});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();
  await page.locator('#applyMapping').click();
  await page.locator('[data-goto-step="3"]').click();await expect(page.locator('#reviewTable tbody tr')).toHaveCount(91);
}

test('eight Builder steps preserve edits, active step and validation links',async({page})=>{
  await page.goto('/builder.html');
  await expect(page.locator('[data-step]:visible')).toHaveCount(1);
  await expect(page.locator('[data-step="1"]')).toBeVisible();
  for(let step=1;step<=8;step++){
    await page.locator(`[data-goto-step="${step}"]`).click();
    await expect(page.locator('[data-step]:visible')).toHaveCount(1);
    await expect(page.locator(`[data-step="${step}"]`)).toBeVisible();
    await expect(page.locator('#wizardProgress')).toContainText(`Step ${step} of 8`);
    await expect(page.locator(`[data-goto-step="${step}"]`)).toHaveAttribute('aria-current','step');
  }
  await page.locator('#previousStep').click();await expect(page.locator('[data-step="7"]')).toBeVisible();
  await page.locator('#nextStep').click();await expect(page.locator('[data-step="8"]')).toBeVisible();
  await page.locator('.validation-error').filter({hasText:'conference.startDate'}).first().locator('[data-error-step]').click();
  await expect(page.locator('[data-step="1"]')).toBeVisible();
  await page.locator('[data-config="name"]').fill('Synthetic Wizard Conference');
  await page.locator('[data-goto-step="6"]').click();
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  await page.reload();
  await expect(page.locator('[data-step="6"]')).toBeVisible();
  await page.locator('[data-goto-step="1"]').click();
  await expect(page.locator('[data-config="name"]')).toHaveValue('Synthetic Wizard Conference');
  await expect(page.locator('#exportBuilderProject')).toBeVisible();
  await expect(page.locator('#importBuilderProject')).toBeVisible();
  await expect(page.locator('#resetProject')).toBeVisible();
});

test('People directory lists 23 identities, searches roles and saves or cancels one editor',async({page})=>{
  await page.goto('/builder.html');await importSynthetic(page);
  await page.locator('[data-goto-step="4"]').click();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(23);
  await expect(page.locator('#duplicateCount')).toBeEmpty();
  await page.locator('#peopleSearch').fill('Researcher 08');
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(1);
  await expect(page.locator('#peoplePreview .person-row')).toContainText('Speaker');
  await expect(page.locator('#peoplePreview .person-row')).toContainText('Chair');
  await page.locator('#peopleRole').selectOption('author');await expect(page.locator('#peoplePreview .person-row')).toHaveCount(0);
  await page.locator('#peopleRole').selectOption('all');
  await page.locator('#peoplePreview .person-row').click();
  await expect(page.locator('#personEditor form')).toHaveCount(1);
  await page.locator('#personEditor [data-edit-field="name"]').fill('Temporary name');
  await page.locator('[data-goto-step="1"]').click();await page.locator('[data-goto-step="4"]').click();
  await expect(page.locator('#personEditor [data-edit-field="name"]')).toHaveValue('Temporary name');
  await page.locator('#cancelPersonEdit').click();
  await expect(page.locator('#peoplePreview .person-row')).toContainText('Researcher 08');
  await page.locator('#peoplePreview .person-row').click();
  await page.locator('#personEditor [data-edit-field="name"]').fill('Researcher Eight');
  await page.locator('#personEditor summary').click();
  await page.locator('#personEditor [data-edit-field="position"]').fill('Programme chair');
  await page.locator('#personEditor [data-edit-field="publicEmail"]').fill('eight@example.org');
  await page.locator('#personEditor [data-edit-field="website"]').fill('https://example.org/eight');
  await page.locator('#personEditForm button[type="submit"]').click();
  await page.locator('#peopleSearch').fill('Researcher Eight');
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(1);
  await expect(page.locator('#peoplePreview .person-row')).toContainText('Researcher Eight');
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  await page.reload();await expect(page.locator('[data-step="4"]')).toBeVisible();
  await page.locator('#peopleSearch').fill('Researcher Eight');
  await expect(page.locator('#peoplePreview .person-row')).toContainText('Researcher Eight');
  await page.locator('#peoplePreview .person-row').click();
  await expect(page.locator('#personEditor [data-edit-field="position"]')).toHaveValue('Programme chair');
  await expect(page.locator('#personEditor [data-edit-field="publicEmail"]')).toHaveValue('eight@example.org');
  await expect(page.locator('#personEditor [data-edit-field="website"]')).toHaveValue('https://example.org/eight');
});

test('organizer merge updates chair references and keeps chosen profile details',async({page})=>{
  await page.goto('/builder.html');await importSynthetic(page);
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  const keptId=await page.evaluate(async()=>{const {loadProject,saveProject}=await import('/src/builder/project-store.js');const p=await loadProject();const kept=p.rows.find(row=>row.speaker==='Researcher 08').speakerEntityIds[0];const chair=p.rows.find(row=>row.chair==='Researcher 08');chair.chairEntityIds=['person-legacy-chair'];p.peopleOverrides['person-legacy-chair']={position:'Chair profile',publicEmail:'chair@example.org'};p.activeStep=4;await saveProject(p);return kept;});
  await page.reload();await expect(page.locator('[data-step="4"]')).toBeVisible();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(24);
  await expect(page.locator('#duplicateCount')).toHaveText('(1)');
  await page.locator('#reviewDuplicates').click();
  await page.locator('[data-merge-keep]').selectOption(keptId);
  await page.locator('[data-merge-remove]').selectOption('person-legacy-chair');
  await page.locator('[data-merge-choice="position"]').selectOption('remove');
  await page.locator('[data-merge-choice="publicEmail"]').selectOption('remove');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-confirm-merge]').click();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(23);
  await expect(page.locator('#duplicateCount')).toBeEmpty();
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  const result=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const p=await loadProject();return {aliases:p.personIdAliases,chairIds:p.rows.filter(row=>row.chair==='Researcher 08').flatMap(row=>row.chairEntityIds||[]),position:p.peopleOverrides[p.personIdAliases['person-legacy-chair']]?.position};});
  expect(result.aliases['person-legacy-chair']).toBe(keptId);
  expect(result.chairIds).not.toContain('person-legacy-chair');
  expect(result.position).toBe('Chair profile');
});

test('bulk duplicate review merges only organizer-checked profile pairs',async({page})=>{
  await page.goto('/builder.html');await importSynthetic(page);
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  const kept=await page.evaluate(async()=>{const {loadProject,saveProject}=await import('/src/builder/project-store.js');const p=await loadProject(),ids={};for(const number of ['08','09']){ids[number]=p.rows.find(row=>row.speaker===`Researcher ${number}`).speakerEntityIds[0];p.rows.find(row=>row.chair===`Researcher ${number}`).chairEntityIds=[`person-legacy-${number}`];}p.activeStep=4;await saveProject(p);return ids;});
  await page.reload();await expect(page.locator('#duplicateCount')).toHaveText('(2)');
  await page.locator('#reviewDuplicates').click();
  const groups=page.locator('[data-duplicate-group]');await expect(groups).toHaveCount(2);
  for(const number of ['08','09']){const group=groups.filter({hasText:`Researcher ${number}`});await group.locator('[data-merge-keep]').selectOption(kept[number]);await group.locator('[data-merge-remove]').selectOption(`person-legacy-${number}`);await group.locator('[data-bulk-merge]').check();}
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-confirm-bulk-merge]').click();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(23);
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  const aliases=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject()).personIdAliases;});
  expect(aliases['person-legacy-08']).toBe(kept['08']);expect(aliases['person-legacy-09']).toBe(kept['09']);
});

test('hundreds of people and mobile step controls stay usable',async({page})=>{
  await page.goto('/builder.html');
  await page.evaluate(async()=>{const {saveProject}=await import('/src/builder/project-store.js');await saveProject({conference:{name:'Large Synthetic Conference',startDate:'2031-06-10',endDate:'2031-06-11',timezone:'Europe/Helsinki'},rows:[],extraPeople:Array.from({length:320},(_,i)=>({id:`extra-${i}`,name:`Person ${String(i).padStart(3,'0')}`,affiliation:`Institute ${i%10}`})),activeStep:4});});
  await page.reload();await expect(page.locator('#peoplePreview .person-row')).toHaveCount(320);
  await page.locator('#peopleSearch').fill('Person 319');await expect(page.locator('#peoplePreview .person-row')).toHaveCount(1);
  await page.locator('#peoplePreview .person-row').click();await expect(page.locator('#personEditor form')).toHaveCount(1);
  await page.locator('#personEditor [data-edit-field="name"]').fill('Person 319 revised');
  await expect(page.locator('#personEditor [data-edit-field="name"]')).toBeFocused();
  for(const width of [320,375,768]){
    await page.setViewportSize({width,height:760});
    await expect(page.locator('#wizardSteps')).toBeVisible();
    const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,elements:[...document.querySelectorAll('body *')].filter(el=>!el.hidden&&el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>`${el.tagName}.${el.className||''}#${el.id||''}: ${Math.round(el.getBoundingClientRect().right)}`)}));
    expect(overflow.page,`No horizontal page overflow at ${width}px: ${overflow.elements.join(', ')}`).toBeLessThanOrEqual(overflow.viewport);
    await page.locator('[data-goto-step="8"]').click();await expect(page.locator('[data-step="8"]')).toBeVisible();
    await page.locator('[data-goto-step="4"]').click();await expect(page.locator('#personEditor [data-edit-field="name"]')).toHaveValue('Person 319 revised');
  }
  await page.locator('#cancelPersonEdit').click();
});

test('Builder shows autosave failure and recovers when storage works again',async({page})=>{
  await page.goto('/builder.html');
  await page.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);window.__builderOriginalOpen=original;indexedDB.open=()=>{throw new Error('Synthetic storage failure');};});
  await page.locator('[data-config="name"]').fill('Unsaved conference');
  await expect(page.locator('#builderSaveStatus')).toContainText('Autosave failed');
  await page.evaluate(()=>{indexedDB.open=window.__builderOriginalOpen;});
  await page.locator('[data-config="name"]').fill('Saved conference');
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  await page.reload();
  await expect(page.locator('[data-config="name"]')).toHaveValue('Saved conference');
});

test('Builder project ZIP round trip preserves wizard state and imported people',async({page})=>{
  await page.goto('/builder.html');await importSynthetic(page);
  await page.locator('[data-goto-step="4"]').click();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(23);
  const pending=page.waitForEvent('download');await page.locator('#exportBuilderProject').click();
  const download=await pending,buffer=await readFile(await download.path());
  page.once('dialog',dialog=>dialog.accept());await page.locator('#resetProject').click();
  await expect(page.locator('[data-step="1"]')).toBeVisible();
  await page.locator('#builderProjectInput').setInputFiles({name:'previous-builder-project.zip',mimeType:'application/zip',buffer});
  await expect(page.locator('[data-step="4"]')).toBeVisible();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(23);
  await page.locator('[data-goto-step="3"]').click();
  await expect(page.locator('#reviewTable tbody tr')).toHaveCount(91);
});

test('ambiguous unaffiliated chair has a direct identity choice',async({page})=>{
  await page.goto('/builder.html');await page.locator('[data-goto-step="2"]').click();
  const csv=`date,start,end,type,session,title,speaker,chair,affiliation,room,track
2031-06-10,09:00,09:30,talk,North,North talk,Alex Same,,North Institute,Room A,North
2031-06-10,10:00,10:30,talk,South,South talk,Alex Same,,South Institute,Room B,South
2031-06-10,11:00,11:30,talk,Methods,Methods talk,Other Speaker,Alex Same,Other Institute,Room C,Methods`;
  await page.locator('#programmeFile').setInputFiles({name:'ambiguous-chair.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();await page.locator('[data-goto-step="3"]').click();
  const chairChoice=page.locator('#reviewTable tbody tr').nth(2).locator('select[data-person-role="chair"]');
  await expect(chairChoice).toHaveCount(1);
  await expect(page.locator('#reviewTable tbody tr').nth(2).locator('select[data-person-role="speaker"]')).toHaveCount(0);
  await expect(page.locator('#builderSaveStatus')).toHaveText('Project saved locally');
  const northId=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const project=await loadProject();return project.rows[0].speakerEntityIds[0];});
  await chairChoice.selectOption(northId);
  await expect(chairChoice).toHaveCount(0);
  await page.locator('[data-goto-step="4"]').click();
  await expect(page.locator('#peoplePreview .person-row')).toHaveCount(3);
});

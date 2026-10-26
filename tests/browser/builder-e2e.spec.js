import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readStoredZip,textEntry} from '../../src/zip.js';
import {synthetic91Csv} from '../../tools/synthetic-91-csv.js';

test('Builder CSV import retains all 91 synthetic records and all 18 shared-slot posters',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-91-records.csv',mimeType:'text/csv',buffer:Buffer.from(synthetic91Csv())});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();
  await page.locator('#applyMapping').click();
  await expect(page.locator('#rowCount')).toHaveText('91 rows');
  await expect(page.locator('#reviewTable tbody tr')).toHaveCount(91);
  const types=await page.locator('#reviewTable [data-field="type"]').evaluateAll(elements=>elements.map(el=>el.value));
  expect(types.filter(type=>type==='poster')).toHaveLength(18);
  await expect(page.locator('#reviewTable input[data-field="title"]').last()).toHaveValue('Synthetic poster 18');
});

test('Builder produces a deployable synthetic multi-track, multi-poster conference',async({page})=>{
  await page.goto('/builder.html');
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track,posterNumber
2028-06-10,09:00,09:30,talk,Opening,Original title,Alex Example,Synthetic University,Hall A,Common,
2028-06-10,10:00,10:30,talk,Parallel research,Materials talk,Morgan Sample,Materials Lab,Hall A,Materials,
2028-06-10,10:00,10:30,talk,Parallel research,Devices talk,Taylor Sample,Devices Lab,Hall B,Devices,
2028-06-10,12:00,13:00,poster,Morning posters,Poster Alpha,Morgan Sample,Materials Lab,Hall B,Common,A1
2028-06-11,14:00,15:00,poster,Afternoon posters,Poster Beta,Taylor Sample,Devices Lab,Hall C,Common,B1
2028-06-11,18:00,20:00,social,Conference social,Evening reception,,,Offsite Venue,Common,`;
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-programme.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await expect(page.locator('#mappingCard')).toBeVisible();await page.locator('#applyMapping').click();
  await expect(page.locator('#rowCount')).toHaveText('6 rows');
  await page.locator('[data-field="title"]').first().fill('Corrected opening title');
  const config={name:'Synthetic Conference',shortName:'SYN 2028',startDate:'2028-06-10',endDate:'2028-06-11',timezone:'Europe/Helsinki',city:'Helsinki',country:'Finland',venueName:'Synthetic Conference Center',venueAddress:'Example Street 1'};
  for(const [field,value] of Object.entries(config))await page.locator(`[data-config="${field}"]`).fill(value);
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
  const csv=`date,start,end,type,session,title,speaker,affiliation,room,track
2028-04-10,09:00,09:30,talk,Methods,First talk,Alex Example,,Hall A,Methods
2028-04-10,10:00,10:30,talk,Methods,Second talk,Alex Example,,Hall A,Methods`;
  await page.locator('#programmeFile').setInputFiles({name:'ambiguous-people.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();
  const identities=page.locator('#reviewTable select[data-person-identity]');await expect(identities).toHaveCount(2);
  const firstChoices=identities.nth(0).locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
  const secondChoices=identities.nth(1).locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
  const [first,second]=await Promise.all([firstChoices,secondChoices]);expect(first).toHaveLength(2);expect(second).toEqual(first);
  await identities.nth(0).selectOption(first[1]);
  await expect(page.locator('#reviewTable select[data-person-identity]')).toHaveCount(1);
  await page.locator('#reviewTable select[data-person-identity]').selectOption(first[1]);
  await expect(page.locator('#reviewTable select[data-person-identity]')).toHaveCount(0);
  await expect(page.locator('#validationReport')).not.toContainText('Ambiguous person identity');
});

import {test,expect} from '@playwright/test';
import {synthetic91Csv} from '../../tools/synthetic-91-csv.js';

const pilotCsv=`date,start,end,type,session,title,speaker,affiliation,room,track
2032-03-01,09:00,09:30,talk,Science,Alpha Talk,Ada North,North Institute,Room A,Track A
2032-03-02,10:00,10:30,talk,Methods,Beta Talk,Bob South,South Institute,Room B,Track B`;
const svg=color=>`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="${color}"/></svg>`;
async function openPilotPreview(page,{expectReady=true}={}){
  await page.goto('/builder.html');
  await page.locator('[data-config="name"]').fill('Pilot Preview Conference');
  await page.locator('[data-config="shortName"]').fill('Pilot');
  await page.locator('[data-config="startDate"]').fill('2032-03-01');
  await page.locator('[data-config="endDate"]').fill('2032-03-02');
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'pilot-preview.csv',mimeType:'text/csv',buffer:Buffer.from(pilotCsv)});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();
  await page.locator('[data-goto-step="8"]').click();
  if(expectReady)await expect(page.locator('#previewStatus')).toHaveText('Up to date');
}
const previewValue=(page,callback)=>page.evaluate(callback);

test('live Builder preview uses attendee UI, branding, filters and isolated personal data',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-config="name"]').fill('Synthetic Preview Conference');
  await page.locator('[data-config="shortName"]').fill('Preview');
  await page.locator('[data-config="startDate"]').fill('2031-06-10');
  await page.locator('[data-config="endDate"]').fill('2031-06-11');
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-91-preview.csv',mimeType:'text/csv',buffer:Buffer.from(synthetic91Csv())});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();
  await page.locator('[data-goto-step="5"]').click();
  await page.locator('[data-location-editor]').filter({hasText:'Room 1'}).locator('[data-location-color]').fill('#123456');
  await page.locator('.entity-editor').filter({hasText:'Track 1'}).locator('[data-track-color]').fill('#654321');
  await page.locator('[data-goto-step="3"]').click();
  await expect(page.locator('#reviewTable tbody tr').first().locator('[data-field="location"]')).toHaveCSS('border-left-color','rgb(18, 52, 86)');
  await expect(page.locator('#reviewTable tbody tr').first().locator('[data-field="track"]')).toHaveCSS('border-left-color','rgb(101, 67, 33)');
  await page.locator('[data-goto-step="6"]').click();
  await page.locator('#primaryColor').fill('#165a70');
  await page.locator('#accentColor').fill('#d02763');
  const logo='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#165a70"/></svg>';
  await page.locator('#logoFile').setInputFiles({name:'pilot-logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from(logo)});
  await page.locator('#sponsorFiles').setInputFiles({name:'sponsor.svg',mimeType:'image/svg+xml',buffer:Buffer.from(logo)});
  await page.locator('[data-goto-step="8"]').click();
  // Firefox can render a dynamically navigated same-origin iframe before
  // Playwright registers its frame. Read its real DOM through the parent.
  const preview=selector=>page.evaluate(selector=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector(selector)?.textContent||'',selector);
  await expect.poll(()=>preview('.brand-lockup')).toContain('Preview');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('.conference-logo')?.getAttribute('src')||'')).toMatch(/^blob:/);
  await expect.poll(()=>preview('#programList')).toContain('Synthetic talk 01');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentWindow?.getComputedStyle(document.querySelector('#attendeePreview').contentDocument.documentElement).getPropertyValue('--accent').trim()||'')).toBe('#d02763');
  await page.locator('#previewSize').selectOption('768');await expect(page.locator('#attendeePreview')).toHaveCSS('width','768px');
  await page.locator('#previewDate').selectOption('2031-06-11');
  await expect.poll(()=>preview('#programList')).toContain('Synthetic talk 29');
  await page.locator('#previewRoom').selectOption({label:'Room 1'});
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#roomFilters [data-room="all"]')?.classList.contains('active'))).toBe(false);
  const identity=await page.evaluate(()=>document.querySelector('#attendeePreview').contentWindow.CONFERENCE_PACKAGE.conference.id);
  expect(identity).toMatch(/^builder-preview-/);
  const saved=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');return (await loadProject()).conference.id;});
  expect(identity).not.toBe(saved);
});

test('contextual validation links directly to the conflicting session editor',async({page})=>{
  await page.goto('/builder.html');
  await page.locator('[data-config="name"]').fill('Synthetic Validation Conference');
  await page.locator('[data-config="startDate"]').fill('2031-06-10');
  await page.locator('[data-config="endDate"]').fill('2031-06-10');
  await page.locator('[data-goto-step="2"]').click();
  await page.locator('#programmeFile').setInputFiles({name:'synthetic-91-validation.csv',mimeType:'text/csv',buffer:Buffer.from(synthetic91Csv())});
  await page.locator('#importProgramme').click();await page.locator('#applyMapping').click();
  await page.locator('[data-goto-step="8"]').click();
  const issue=page.locator('.validation-error').filter({hasText:'date outside conference range'}).first();
  await expect(issue).toContainText('2031-06-11');
  await expect(issue).toContainText('Room');
  await issue.locator('[data-error-step]').click();
  await expect(page.locator('[data-step="3"]')).toBeVisible();
  await expect(page.locator('#sessionPreview [data-session-id]:focus-within')).toHaveCount(1);
});

test('Refresh preview rebuilds branding and keeps navigation, storage isolation and release state',async({page})=>{
  await openPilotPreview(page);
  let downloads=0;page.on('download',()=>downloads++);
  await page.locator('#previewSize').selectOption('768');
  await page.locator('#previewDate').selectOption('2032-03-02');
  await page.locator('#previewRoom').selectOption({label:'Room B'});
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).toContain('Beta Talk');
  const before=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const p=await loadProject();return {conferenceId:p.conference.id,dataVersion:p.dataVersion,published:p.lastPublishedVersion||0,exported:p.lastExportedVersion||0};});
  await page.evaluate(()=>{window.previewStates=[];const el=document.querySelector('#previewStatus');new MutationObserver(()=>window.previewStates.push(el.dataset.state)).observe(el,{attributes:true,attributeFilter:['data-state']});});
  await page.locator('[data-goto-step="5"]').click();
  await page.locator('[data-location-editor]').filter({hasText:'Room B'}).locator('[data-location-color]').fill('#216789');
  await page.locator('.entity-editor').filter({hasText:'Track A'}).locator('[data-track-color]').fill('#a35219');
  await page.locator('[data-goto-step="6"]').click();
  await page.locator('#primaryColor').fill('#165a70');
  await page.locator('#secondaryColor').fill('#22764f');
  await page.locator('#accentColor').fill('#d02763');
  await page.locator('#headerStyle').selectOption('logo');
  await page.locator('#typography').selectOption('serif');
  await page.locator('#brandingDarkMode').uncheck();
  await page.locator('#logoFile').setInputFiles({name:'logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg('#165a70'))});
  await page.locator('#sponsorFiles').setInputFiles({name:'sponsor.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg('#22764f'))});
  await page.locator('[data-goto-step="8"]').click();
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  const firstRevision=await page.locator('#attendeePreview').getAttribute('src');
  await page.locator('#refreshPreview').click();
  await expect.poll(()=>page.locator('#attendeePreview').getAttribute('src')).not.toBe(firstRevision);
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  const branded=await previewValue(page,()=>{const f=document.querySelector('#attendeePreview'),w=f.contentWindow,p=w.CONFERENCE_PACKAGE,r=f.contentDocument.documentElement,room=p.locations.locations.find(x=>x.name==='Room B'),track=p.programme.tracks.find(x=>x.name==='Track A');return {id:p.conference.id,primary:r.style.getPropertyValue('--brand-primary'),secondary:r.style.getPropertyValue('--brand-secondary'),accent:r.style.getPropertyValue('--accent'),header:r.dataset.headerStyle,typography:r.dataset.typography,dark:r.dataset.theme,roomColor:p.branding.locationColors[room.id],trackColor:p.branding.trackColors[track.id],logo:f.contentDocument.querySelector('.conference-logo')?.getAttribute('src'),sponsors:p.branding.sponsorAssets};});
  expect(branded).toMatchObject({primary:'#165a70',secondary:'#22764f',accent:'#d02763',header:'logo',typography:'serif',roomColor:'#216789',trackColor:'#a35219'});
  expect(branded.dark).not.toBe('dark');expect(branded.logo).toMatch(/^blob:/);expect(branded.sponsors[0]).toMatch(/^blob:/);
  expect(branded.id).not.toBe(before.conferenceId);
  await expect(page.locator('#previewSize')).toHaveValue('768');
  await expect(page.locator('#previewDate')).toHaveValue('2032-03-02');
  await expect(page.locator('#previewRoom')).toHaveValue(await page.evaluate(()=>{const p=document.querySelector('#attendeePreview').contentWindow.CONFERENCE_PACKAGE;return p.locations.locations.find(x=>x.name==='Room B').id;}));
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).toContain('Beta Talk');
  const secondRevision=await page.locator('#attendeePreview').getAttribute('src');
  await page.locator('#refreshPreview').click();
  await expect.poll(()=>page.locator('#attendeePreview').getAttribute('src')).not.toBe(secondRevision);
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  expect(await page.evaluate(()=>window.previewStates)).toContain('loading');
  const after=await page.evaluate(async()=>{const {loadProject}=await import('/src/builder/project-store.js');const p=await loadProject();return {dataVersion:p.dataVersion,published:p.lastPublishedVersion||0,exported:p.lastExportedVersion||0};});
  expect(after).toEqual({dataVersion:before.dataVersion,published:before.published,exported:before.exported});expect(downloads).toBe(0);
  const actualData=await page.evaluate(async id=>{const {createUserStore}=await import('/src/user-store.js');return createUserStore(id).getState();},before.conferenceId);
  expect(actualData.favorites||[]).toEqual([]);
});

test('Validate refreshes changed conference details even when validation reports errors',async({page})=>{
  await openPilotPreview(page);
  await page.locator('[data-goto-step="1"]').click();
  await page.locator('[data-config="shortName"]').fill('Changed Pilot');
  await page.locator('[data-config="endDate"]').fill('2032-03-01');
  await page.locator('[data-goto-step="8"]').click();
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  await expect(page.locator('#validationReport')).toContainText('date outside conference range');
  const before=await page.locator('#attendeePreview').getAttribute('src');
  await page.locator('#validateProject').click();
  await expect.poll(()=>page.locator('#attendeePreview').getAttribute('src')).not.toBe(before);
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('.conference-logo-fallback')?.textContent||'')).toBe('Changed Pilot');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).toContain('Alpha Talk');
  await expect(page.locator('#validationReport')).toContainText('date outside conference range');
});

test('rapid programme and settings edits cannot restore an older preview',async({page})=>{
  await openPilotPreview(page);
  await page.locator('[data-goto-step="1"]').click();
  await page.locator('[data-config="shortName"]').fill('First name');
  await page.locator('[data-config="shortName"]').fill('Second name');
  await page.locator('[data-config="shortName"]').fill('Final name');
  await page.locator('[data-goto-step="3"]').click();
  await page.locator('#reviewTable tbody tr').first().locator('[data-field="title"]').fill('Final programme title');
  await page.locator('[data-goto-step="7"]').click();
  await page.locator('[data-feature="notes"]').uncheck();
  await page.locator('[data-goto-step="8"]').click();
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('.conference-logo-fallback')?.textContent||'')).toBe('Final name');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('#programList')?.textContent||'')).toContain('Final programme title');
  expect(await page.evaluate(()=>document.querySelector('#attendeePreview').contentWindow.CONFERENCE_PACKAGE.conference.features.notes)).toBe(false);
  await page.locator('#refreshPreview').click();
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#attendeePreview')?.contentDocument?.querySelector('.conference-logo-fallback')?.textContent||'')).toBe('Final name');
});

test('a refresh waits for pending asset reads and uses the newest settings',async({page})=>{
  await openPilotPreview(page);
  await page.evaluate(()=>{
    const read=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=function(){
      if(this.name!=='slow-logo.svg')return read.call(this);
      window.logoReadStarted=true;
      return new Promise(resolve=>{window.releaseLogoRead=()=>read.call(this).then(resolve);});
    };
  });
  await page.locator('[data-goto-step="6"]').click();
  await page.locator('#logoFile').setInputFiles({name:'slow-logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg('#165a70'))});
  await expect.poll(()=>page.evaluate(()=>!!window.logoReadStarted)).toBe(true);
  await page.locator('#primaryColor').fill('#124578');
  await page.locator('#primaryColor').fill('#345678');
  await page.locator('[data-goto-step="1"]').click();
  await page.locator('[data-config="shortName"]').fill('Newest settings');
  await page.locator('[data-goto-step="8"]').click();
  await page.locator('#refreshPreview').click();
  await expect(page.locator('#previewStatus')).toHaveText('Loading preview…');
  await page.evaluate(()=>window.releaseLogoRead());
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
  const result=await page.evaluate(()=>{const f=document.querySelector('#attendeePreview'),r=f.contentDocument.documentElement;return {name:f.contentWindow.CONFERENCE_PACKAGE.conference.shortName,color:r.style.getPropertyValue('--brand-primary'),logo:f.contentDocument.querySelector('.conference-logo')?.getAttribute('src')};});
  expect(result).toMatchObject({name:'Newest settings',color:'#345678'});expect(result.logo).toMatch(/^blob:/);
});

test('preview reports load failure and recovers on Refresh preview',async({page})=>{
  await page.route('**/index.html?builderPreview=1*',route=>route.fulfill({contentType:'text/html',body:'<main><h1>Conference app could not start</h1></main>'}));
  await openPilotPreview(page,{expectReady:false});
  await expect(page.locator('#previewStatus')).toHaveText('Failed to load preview. Review the project and try Refresh preview.');
  await page.unroute('**/index.html?builderPreview=1*');
  await page.locator('#refreshPreview').click();
  await expect(page.locator('#previewStatus')).toHaveText('Up to date');
});

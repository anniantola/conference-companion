import {test,expect} from '@playwright/test';
import {synthetic91Csv} from '../../tools/synthetic-91-csv.js';

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

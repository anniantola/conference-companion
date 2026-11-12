import {test,expect} from '@playwright/test';
import {readFile,copyFile} from 'node:fs/promises';
import {readStoredZip} from '../../src/zip.js';
test.use({serviceWorkers:'block'});

const logo=(fill)=>`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="${fill}"/></svg>`;
async function downloadedArchive(page,path=''){
  const pending=page.waitForEvent('download');await page.locator('#exportPptxConfirm').click();
  const download=await pending;if(path)await copyFile(await download.path(),path);return readStoredZip(new Blob([await readFile(await download.path())]));
}
const xml=(archive,name)=>new TextDecoder().decode(archive.get(name)||new Uint8Array());
const slideText=archive=>[...archive.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name=>xml(archive,name)).join('\n');

test('conference branding exports use appearance, configured colors, editable profiles and logos',async({page})=>{
  await page.route('**/conference/assets/*.svg',route=>{
    const dark=route.request().url().includes('dark');return route.fulfill({status:200,contentType:'image/svg+xml',body:logo(dark?'#F5F5F5':'#123456')});
  });
  await page.goto('/');await expect(page.locator('#programList')).not.toBeEmpty();
  const eventId=await page.evaluate(async()=>{
    const conference=window.CONFERENCE_CONFIG.conference,{createUserStore}=await import('/src/user-store.js');
    const blob=await fetch('/icon-192.png').then(response=>response.blob());
    await createUserStore(conference.id).saveFriend({id:'branded-friend',name:'Branded Friend',affiliation:'Example University',avatarColor:'#C14567',privateNotes:'PRIVATE-BRANDED-NOTE',email:'private-brand@example.invalid',privatePhotos:[{id:'branded-private-photo',blob,thumbnailBlob:blob,caption:'PRIVATE-BRANDED-PHOTO'}]});
    return window.CONFERENCE_MODEL.items[0].id;
  });
  await page.reload();await expect(page.locator('#programList')).not.toBeEmpty();
  await page.locator(`#programList [data-event="${eventId}"]`).click();await page.locator('#modalNote').fill('Editable Unicode note: Åbo · ΔE');await expect(page.locator('#noteSaveStatus')).toHaveText('Saved');await page.locator('#modalClose').click();
  const date=await page.evaluate(()=>{
    const branding=window.CONFERENCE_CONFIG.branding,date=window.CONFERENCE_MODEL.items[0].date;
    Object.assign(branding,{primary:'#123456',secondary:'#267755',accent:'#A13868',brandMode:'combined',logoLight:'assets/logo-light.svg',logoDark:'assets/logo-dark.svg',logoAlignment:'right',headingFont:'space-grotesk',bodyFont:'source-sans-3',dayColors:{[date]:'#397AA5'},trackColors:{[window.CONFERENCE_MODEL.items[0].trackId]:'#957432'},locationColors:{[window.CONFERENCE_MODEL.items[0].locationId]:'#286FA3'},sponsorLogos:[{name:'Example Sponsor',light:'assets/sponsor-light.svg',dark:'assets/sponsor-dark.svg',height:48}]});return date;
  });
  await page.locator('[data-target="settings"]').click();await page.locator('#exportPptxBtn').click();
  await expect(page.locator('#exportPptxTemplate')).toHaveValue('standard');
  await expect(page.locator('#exportPptxAppearance')).toHaveValue('match');
  await expect(page.locator('#exportPptxPreview .presentation-preview-slide')).toHaveCount(2);
  await page.locator('#exportPptxFriends').check();await expect(page.locator('#exportPptxPreview .presentation-preview-slide')).toHaveCount(3);
  await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  await page.locator('#exportPptxAppearance').selectOption('dark');
  await expect(page.locator('#exportPptxPreview')).toHaveCSS('--preview-bg','#111820');
  await page.evaluate(async()=>{for(const name of ['logo-dark.svg','sponsor-dark.svg'])await fetch(`./conference/assets/${name}`);});
  const dark=await downloadedArchive(page,'/tmp/conference-branded-dark.pptx');
  const slides=slideText(dark),theme=xml(dark,'ppt/theme/theme1.xml');
  expect(theme).toContain('Space Grotesk');expect(theme).toContain('Source Sans 3');expect(theme).toContain('123456');
  expect(slides).toContain('Editable Unicode note: Åbo · ΔE');expect(slides).toContain('Branded Friend');expect(slides).toContain('C14567');
  expect(slides).toContain('397AA5');expect(slides).toContain('957432');expect(slides).toContain('286FA3');
  expect(slides).not.toContain('PRIVATE-BRANDED-NOTE');expect(slides).not.toContain('private-brand@example.invalid');
  expect([...dark.keys()].filter(name=>name.startsWith('ppt/media/brand'))).toHaveLength(2);
  expect([...dark.keys()].filter(name=>/^ppt\/media\/image\d+\.jpg$/.test(name))).toHaveLength(0);
  expect(xml(dark,'ppt/slides/_rels/slide1.xml.rels')).toContain('../media/brand1.png');
  expect(xml(dark,'[Content_Types].xml')).toContain('image/png');
  for(const [name,bytes] of dark)if(name.endsWith('.xml')||name.endsWith('.rels'))expect(new TextDecoder().decode(bytes)).not.toContain('PRIVATE-BRANDED-NOTE');
  for(const name of dark.keys())if(name.endsWith('.rels')){
    const owner=name==='_rels/.rels'?'':name.replace(/(^|\/)\_rels\/([^/]+)\.rels$/,'$1$2');
    for(const [,attributes] of xml(dark,name).matchAll(/<Relationship\b([^>]*)\/?\s*>/g)){
      const target=attributes.match(/\bTarget="([^"]+)"/)?.[1];if(!target||attributes.includes('TargetMode="External"'))continue;
      const resolved=decodeURIComponent(new URL(target,`https://ppt.invalid/${owner}`).pathname.slice(1));
      expect(dark.has(resolved),`${name} target ${target}`).toBeTruthy();
    }
  }
  await page.locator('#exportPptxBtn').click();await expect(page.locator('#exportPptxAppearance')).toHaveValue('dark');
  await page.locator('#exportPptxTemplate').selectOption('utu');await expect(page.locator('#exportPptxAppearanceRow')).toBeHidden();
  await page.locator('#exportPptxCancel').click();await page.locator('#exportPptxBtn').click();await expect(page.locator('#exportPptxTemplate')).toHaveValue('utu');
  await page.locator('#exportPptxTemplate').selectOption('standard');await expect(page.locator('#exportPptxAppearanceRow')).toBeVisible();
  await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  await page.locator('#exportPptxFriends').check();await page.locator('#exportPptxPrivate').check();
  const privateArchive=await downloadedArchive(page),privateXml=slideText(privateArchive);
  expect(privateXml).toContain('PRIVATE-BRANDED-NOTE');expect(privateXml).toContain('private-brand@example.invalid');expect(privateXml).toContain('PRIVATE-BRANDED-PHOTO');
  expect([...privateArchive.keys()].filter(name=>/^ppt\/media\/image\d+\.jpg$/.test(name))).toHaveLength(1);
  await page.locator('#exportPptxBtn').click();await expect(page.locator('#exportPptxPrivate')).not.toBeChecked();
  await page.locator('#exportPptxAppearance').selectOption('match');await page.locator('#exportPptxCancel').click();
  await page.locator('#themeSelect').selectOption('system');await page.emulateMedia({colorScheme:'dark'});
  await page.locator('#exportPptxBtn').click();
  await expect(page.locator('#exportPptxAppearance')).toHaveValue('match');
  await expect(page.locator('#exportPptxPreview')).toHaveCSS('--preview-bg','#111820');
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('presentation preview and controls stay usable at mobile width',async({page})=>{
  await page.setViewportSize({width:320,height:640});await page.goto('/');await expect(page.locator('#programList')).not.toBeEmpty();
  await page.locator('[data-target="settings"]').click();await page.locator('#exportPptxBtn').click();
  const dialog=page.locator('#exportPptxDialog');await expect(dialog).toBeVisible();
  await expect(page.locator('#exportPptxTemplate')).toBeVisible();await expect(page.locator('#exportPptxAppearance')).toBeVisible();
  await expect(page.locator('#exportPptxPreview .presentation-preview-slide')).toHaveCount(2);
  const bounds=await dialog.evaluate(element=>({width:element.getBoundingClientRect().width,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
  expect(bounds.width).toBeLessThanOrEqual(320);expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth+1);
  await page.locator('#exportPptxTemplate').selectOption('utu');await expect(page.locator('#exportPptxAppearanceRow')).toBeHidden();
  await page.locator('#exportPptxTemplate').selectOption('standard');await expect(page.locator('#exportPptxAppearanceRow')).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
});

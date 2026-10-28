import {test,expect} from '@playwright/test';

test('malicious conference query paths are rendered as text in startup errors',async({page})=>{
  await page.addInitScript(()=>{window.__conferenceInjection=false;});
  await page.route('**/conference-manifest.json',route=>route.fulfill({status:503,body:'unavailable'}));
  const payload='./<svg onload="window.__conferenceInjection=true"><script>window.__conferenceInjection=true</script></svg>';
  await page.goto('/?conference='+encodeURIComponent(payload));
  await expect(page.getByRole('heading',{name:'Conference app could not start'})).toBeVisible();
  await expect(page.locator('main code')).toHaveText(payload);
  expect(await page.evaluate(()=>window.__conferenceInjection)).toBe(false);
  await expect(page.locator('main svg, main script, main img')).toHaveCount(0);
});

test('HTML in package-loading errors stays inert and ordinary diagnostics remain readable',async({page})=>{
  await page.addInitScript(()=>{window.__conferenceInjection=false;});
  const minimumEngineVersion='999.0.0<img src=x onerror="window.__conferenceInjection=true">';
  await page.route('**/malicious-release/conference-manifest.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:1,dataVersion:1,minimumEngineVersion,files:[],checksums:{}})}));
  await page.goto('/?conference=./malicious-release');
  await expect(page.getByRole('heading',{name:'Conference app could not start'})).toBeVisible();
  await expect(page.locator('main p').first()).toContainText(minimumEngineVersion);
  expect(await page.evaluate(()=>window.__conferenceInjection)).toBe(false);
  await expect(page.locator('main img')).toHaveCount(0);

  await page.route('**/ordinary-failure/conference-manifest.json',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.goto('/?conference=./ordinary-failure');
  await expect(page.getByRole('heading',{name:'Conference app could not start'})).toBeVisible();
  await expect(page.locator('main p').first()).toContainText('conference-manifest.json: HTTP 503');
});

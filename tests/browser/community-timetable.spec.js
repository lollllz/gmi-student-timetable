import {test,expect} from '@playwright/test';import AxeBuilder from '@axe-core/playwright';
import {makeDavFixture} from '../dav-fixture.js';
test('anonymous publishing validates on the service, then switches default datasets and generated calendar export',async({page})=>{
 const endpoint='https://gmi-campus-reports.netlify.app/api/timetable';let published=false;
 const {decodeDav}=await import('../../dav-reader.js');const decoded=await decodeDav(makeDavFixture().buffer,'TT TEST_R05A_20102026.dav');
 const manifest={...decoded.manifest,communityUpload:true,sourceRevision:'2026-10-20',sourceRevisionDate:'2026-10-20',revisionCode:'R05A',sourceFilename:'TT TEST_R05A_20102026.dav'};
 await page.route('**/data/lift-service.json',route=>route.fulfill({json:{endpoint:endpoint.replace('timetable','lifts')}}));
 await page.route(/https:\/\/gmi-campus-reports\.netlify\.app\/api\/(?:publish-)?timetable.*/,route=>{
  if(route.request().method()==='POST'){published=true;return route.fulfill({status:201,json:{manifest}});}
  const url=new URL(route.request().url());if(url.searchParams.has('id'))return route.fulfill({json:decoded.datasets[url.searchParams.get('id')]});
  return route.fulfill(published?{json:manifest}:{status:404,json:{error:'none'}});
 });
 await page.goto('./?class=99178435&week=2026-10-19');await expect(page.locator('.lesson').first()).toBeVisible();
 await page.locator('#publish-button').click();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.locator('#publish-file').setInputFiles({name:'TT TEST_R05A_20102026.dav',mimeType:'application/octet-stream',buffer:Buffer.from(makeDavFixture())});
 await page.locator('#publish-form input[type=checkbox]').check();await page.getByRole('button',{name:'Validate & publish for everyone'}).click();
 await expect(page.locator('#publish-feedback')).toContainText('now the shared default');
 await page.keyboard.press('Escape');await expect(page.locator('#latest-timetable')).toContainText('R05A');await expect(page.locator('#file-source-label')).toContainText('Community-uploaded');
 await page.locator('#class-button').click();await page.locator('#class-results button').first().click();await page.locator('#week-date').fill(decoded.datasets[manifest.classes[0].id].events[0].date);await page.locator('#week-date').dispatchEvent('change');await expect(page.locator('.lesson').first()).toBeVisible();
 await page.locator('.export-trigger').first().click();await expect(page.locator('#calendar-download')).toHaveAttribute('href',/^blob:/);
 await page.reload();await expect(page.locator('#latest-timetable')).toContainText('R05A');
});

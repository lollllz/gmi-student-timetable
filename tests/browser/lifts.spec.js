import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('lift reporting stays optional, anonymous and shared with explicit unknown and error states',async({page})=>{
 const endpoint='https://gmi-lift-reports.netlify.app/api/lifts'; let posts=0; let reports=[];
 await page.route('**/data/lift-service.json',route=>route.fulfill({json:{endpoint}}));
 await page.route(endpoint,async route=>{
  if(route.request().method()==='POST'){posts++;const input=route.request().postDataJSON();expect(Object.keys(input).sort()).toEqual(['building','lift','status','website']);reports=[{...input,id:'test-report',observedAt:new Date().toISOString()}];await route.fulfill({status:201,json:{report:reports[0]}});}
  else await route.fulfill({json:{reports}});
 });
 await page.goto('./?class=99178435&week=2026-10-19'); await expect(page.locator('.lesson').first()).toBeVisible();
 await expect(page.locator('#campus-conditions')).not.toHaveAttribute('open',''); expect(posts).toBe(0);
 await page.locator('#conditions-toggle').click(); await page.locator('#lift-button').click();
 await expect(page.locator('#lift-results')).toContainText('conditions are unknown');
 await page.locator('#lift-building').fill('Block A');await page.locator('#lift-unit').fill('Lift 1');await page.locator('#lift-condition').selectOption('out-of-service');
 await page.getByRole('button',{name:'Share observation',exact:true}).click(); await expect(page.locator('#lift-feedback')).toContainText('Observation shared');expect(posts).toBe(1);
 await expect(page.locator('#lift-results')).toContainText('Reported out of service');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.route(endpoint,route=>route.fulfill({status:503,json:{error:'unavailable'}}));await page.locator('#lift-refresh').click();await expect(page.locator('#lift-results')).toContainText('Conditions are unknown');
});

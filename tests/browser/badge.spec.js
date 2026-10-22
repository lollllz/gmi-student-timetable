import {test,expect} from '@playwright/test';
test('hosting badge stays hidden and mobile export stays reachable',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await page.goto('./?class=99178435&week=2026-10-19');
 await expect(page.locator('.lesson').first()).toBeVisible();
 await page.evaluate(()=>{if(!document.querySelector('#nl-badge-frame')){const frame=document.createElement('iframe');frame.id='nl-badge-frame';frame.title='Hosting promotion';frame.style='position:fixed;bottom:0;right:0;width:202px;height:64px;z-index:99999';document.body.append(frame);}});
 await expect(page.locator('#nl-badge-frame')).toBeHidden();
 await page.locator('.mobile-export .export-trigger').click();
 await expect(page.locator('#calendar-download')).toBeVisible();
});

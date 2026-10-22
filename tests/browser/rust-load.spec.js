import{test,expect}from'@playwright/test';
test('Rust viewer defers DAV code and repeat visits reuse the community check',async({page})=>{
 let calls=0;const wasm=[];let manifestCalls=0;await page.route('**/api/timetable',route=>{calls++;return route.fulfill({status:404,json:{error:'No community timetable published.'}})});
 page.on('request',r=>{if(r.url().endsWith('/data/manifest.json'))manifestCalls++;if(r.url().includes('.wasm'))wasm.push(r.url());});
 await page.goto('./?class=99178435&week=2026-10-19');await expect(page.locator('.lesson').first()).toBeVisible();await expect.poll(()=>calls).toBe(1);
 expect(manifestCalls).toBe(1);expect(wasm.filter(url=>url.includes('/web/'))).toHaveLength(1);expect(wasm.filter(url=>url.includes('/engine/'))).toHaveLength(0);
 for(let i=0;i<3;i++){await page.reload();await expect(page.locator('.lesson').first()).toBeVisible();}
 expect(calls).toBe(1);
});

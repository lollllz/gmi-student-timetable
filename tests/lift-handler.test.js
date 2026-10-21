import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiftHandler } from '../netlify/lib/lift-handler.mjs';
const origin='https://lollllz.github.io';
const current = Date.parse('2026-10-21T04:00:00Z');
function setup() {
  const rows = new Map();
  const handler=createLiftHandler(()=>({setJSON:async(k,v)=>rows.set(k,v),get:async k=>rows.get(k),list:async function*({prefix}){yield{blobs:[...rows.keys()].filter(k=>k.startsWith(prefix)).sort().map(key=>({key}))};}}),()=>current);
  const post=(body,headers={})=>handler(new Request('https://reports.example/api/lifts',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  return {handler,post,rows};
}
test('anonymous observation is saved and shared without identity fields',async()=>{
 const {handler,post,rows}=setup(); const response=await post({building:'Block A',lift:'Lift 1',status:'out-of-service',email:'discard@example.com'});
 assert.equal(response.status,201); const report=(await response.json()).report; assert.equal(report.observedAt,new Date(current).toISOString()); assert.equal('email' in report,false);
 const read=await handler(new Request('https://reports.example/api/lifts',{headers:{origin}})); assert.equal((await read.json()).reports.length,1); assert.equal(rows.size,1);
});
test('rejects invalid conditions, script labels, honeypot, foreign origin and oversized streams',async()=>{
 const {post,rows}=setup();
 for(const body of [{building:'A',lift:'1',status:'safe'},{building:'<script>',lift:'1',status:'working'},{building:'A',lift:'1',status:'working',website:'bot'}]) assert.equal((await post(body)).status,400);
 assert.equal((await post({building:'A',lift:'1',status:'working'},{origin:'https://evil.example'})).status,403);
 assert.equal((await post({building:'x'.repeat(2000)})).status,413); assert.equal(rows.size,0);
});
test('CORS and failure states do not claim a lift condition',async()=>{
 const {handler}=setup(); const preflight=await handler(new Request('https://reports.example/api/lifts',{method:'OPTIONS',headers:{origin}})); assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const broken=createLiftHandler(()=>{throw new Error('private detail')}); const response=await broken(new Request('https://reports.example/api/lifts')); assert.equal(response.status,503); assert.equal((await response.text()).includes('private detail'),false);
});
test('short address can read and submit while unrelated origins remain blocked',async()=>{
 const {post,handler}=setup();const short='https://gmi-schedule.netlify.app';
 assert.equal((await post({building:'Block A',lift:'Lift 1',status:'working'},{origin:short})).status,201);
 const response=await handler(new Request('https://reports.example/api/lifts',{headers:{origin:short}}));assert.equal(response.headers.get('access-control-allow-origin'),short);
 assert.equal((await post({building:'Block A',lift:'Lift 1',status:'working'},{origin:'https://gmi-timetable.netlify.app'})).status,403);
});

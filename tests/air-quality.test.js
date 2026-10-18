import test from 'node:test';import assert from 'node:assert/strict';
import { normaliseAir,sourceTime,readingState,airTime,apiCategory } from '../air-quality.js';
const now=new Date('2026-10-18T14:30:00Z');
const row={STATION_ID:'CA17W',STATION_LOCATION:'Putrajaya, W.P. PUTRAJAYA',API:156,CLASS:'Unhealthy',RECORD_DT:'2026-10-18T22:00:00',OP_PHONE:'must not be published'};
test('DOE wall-clock timestamps use Malaysia time and snapshots whitelist data',()=>{
 assert.equal(sourceTime(row.RECORD_DT),'2026-10-18T14:00:00.000Z');
 assert.equal(sourceTime('2026-10-18T14:00:00Z'),'2026-10-18T14:00:00.000Z');
 assert.equal(sourceTime('2026-02-30T22:00:00'),null);
 const snapshot=normaliseAir({data:[row]},now);
 assert.equal(JSON.stringify(snapshot).includes('OP_PHONE'),false);
 assert.equal(readingState(snapshot,'CA17W',now).status,'fresh');
 assert.equal(readingState(snapshot,'CA17W',now).value,156);
 assert.equal(readingState(snapshot,'CA16W',now).status,'unavailable');
 assert.match(airTime(snapshot.stations[0].observedAt),/22:00 MYT/);
});
test('old, null, future and inconsistent readings never look current',()=>{
 const snapshot=normaliseAir({data:[row]},now);
 assert.equal(readingState(snapshot,'CA17W',new Date('2026-10-18T18:00:00Z')).status,'stale');
 assert.equal(readingState(snapshot,'CA17W',new Date('2026-10-19T15:00:00Z')).status,'unavailable');
 for(const bad of [{API:null},{API:-1},{API:'156'},{CLASS:'Good'},{RECORD_DT:'2026-10-19T22:00:00'}])assert.equal(readingState(normaliseAir({data:[{...row,...bad}]},now),'CA17W',now).status,'unavailable');
 assert.equal(readingState({schemaVersion:1,stations:{}},'CA17W',now).status,'unavailable');
 for(const [value,category] of [[0,'Good'],[50,'Good'],[51,'Moderate'],[100,'Moderate'],[101,'Unhealthy'],[200,'Unhealthy'],[201,'Very Unhealthy'],[300,'Very Unhealthy'],[301,'Hazardous']])assert.equal(apiCategory(value),category);
});

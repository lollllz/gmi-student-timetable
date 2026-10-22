import { validDate } from './core.js';
export const AIR_SOURCE = 'https://eqms.doe.gov.my/APIMS/main';
export const AIR_FEED = 'https://eqms.doe.gov.my/api3/publicportalapims/mapcaqm';
export const AIR_STATIONS = Object.freeze([{id:'CA17W',name:'Putrajaya, W.P. PUTRAJAYA'}, {id:'CA16W',name:'Cheras, W.P. KUALA LUMPUR'}]);
export function apiCategory(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1000) return null;
  return value <= 50 ? 'Good' : value <= 100 ? 'Moderate' : value <= 200 ? 'Unhealthy' : value <= 300 ? 'Very Unhealthy' : 'Hazardous';
}
export function sourceTime(value) {
  // The public map feed returns Malaysian wall-clock RECORD_DT without an offset.
  // Its own client parses this as local time; explicitly use MYT for all viewers.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  if (!validDate(value.slice(0,10))) return null;
  const date = new Date(/[Z]|[+-]\d{2}:\d{2}$/.test(value) ? value : value + '+08:00');
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function normaliseAir(payload, now = new Date()) {
  if (!Array.isArray(payload?.data)) throw new Error('Unexpected DOE station response');
  const stations = AIR_STATIONS.map(station => {
    const rows = payload.data.filter(row=>row?.STATION_ID===station.id);
    if (rows.length !== 1) return {id:station.id,name:station.name,value:null,category:null,observedAt:null};
    const row=rows[0], value=row.API, observedAt=sourceTime(row.RECORD_DT), category=apiCategory(value);
    if (!String(row.STATION_LOCATION).startsWith(station.name.split(',')[0]) || category!==row.CLASS || !observedAt || Date.parse(observedAt)>now.getTime()+15*60000) return {id:station.id,name:station.name,value:null,category:null,observedAt:null};
    return {id:station.id,name:station.name,value:category ? value : null,category,observedAt};
  });
  return {schemaVersion:1,fetchedAt:now.toISOString(),stations};
}
export function readingState(snapshot, id, now = new Date()) {
  const station=AIR_STATIONS.find(s=>s?.id===id), row=snapshot?.schemaVersion===1 && Array.isArray(snapshot.stations) && snapshot.stations.find(s=>s?.id===id);
  if (!station || !row || apiCategory(row.value)!==row.category || row.category===null) return {status:'unavailable',station};
  const time=Date.parse(row.observedAt), fetched=Date.parse(snapshot.fetchedAt), age=now.getTime()-time;
  if (!Number.isFinite(time) || !Number.isFinite(fetched) || age < -15*60000 || time > fetched+15*60000 || fetched > now.getTime()+15*60000 || age>24*3600000) return {status:'unavailable',station};
  return {status:age>3*3600000 ? 'stale' : 'fresh',station,value:row.value,category:row.category,observedAt:row.observedAt};
}
export function airTime(value) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)) + ' MYT';
}

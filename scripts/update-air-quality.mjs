import { readFile, writeFile } from 'node:fs/promises';
import { AIR_FEED, normaliseAir } from '../air-quality.js';
const target=new URL('../public/data/air-quality.json',import.meta.url);
const previousUrl='https://lollllz.github.io/gmi-student-timetable/data/air-quality.json';
async function get(url) {
 const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'Accept':'application/json'}});
 if(!r.ok)throw new Error('HTTP '+r.status);return r.json();
}
let snapshot;
try {
 snapshot=normaliseAir(await get(AIR_FEED));
 if(!snapshot.stations.some(s=>s.value!==null))throw new Error('No valid reference readings');
 console.log('Retrieved DOE readings for '+snapshot.stations.length+' reference stations.');
} catch(error) {
 console.warn('DOE refresh unavailable: '+error.message+'. Preserving last known timestamps.');
 let local=null, deployed=null;
 try{local=JSON.parse(await readFile(target,'utf8'));}catch{}
 try{deployed=await get(previousUrl);}catch{}
 snapshot=[local,deployed].filter(s=>s?.schemaVersion===1&&Array.isArray(s.stations)&&Number.isFinite(Date.parse(s.fetchedAt))).sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0] || {schemaVersion:1,fetchedAt:null,stations:[]};
}
await writeFile(target,JSON.stringify(snapshot)+'\n');

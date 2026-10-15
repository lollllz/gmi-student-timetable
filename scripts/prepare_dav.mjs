// Generate the published datasets from the same validated V30 reader used locally.
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeDav } from '../dav-reader.js';
import { classCalendar } from '../calendar.js';
import { validDate } from '../core.js';
const [filename, revisionCode, revisionDate, destination = 'public'] = process.argv.slice(2);
if (!filename || !/^[A-Z0-9]+$/.test(revisionCode || '') || !validDate(revisionDate)) throw new Error('Usage: node scripts/prepare_dav.mjs input.dav R04D YYYY-MM-DD [public-directory]');
const input = await readFile(filename);
const result = await decodeDav(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength),path.basename(filename));
const manifest = result.manifest;
const labelDate = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(revisionDate+'T12:00:00Z'));
Object.assign(manifest,{title:'GMI Student Timetable',sourceRevision:labelDate,revisionCode,sourceRevisionDate:revisionDate,sourceFilename:path.basename(filename),sourceBytes:input.byteLength});
delete manifest.filename;
const byLecturer = new Map();
for (const event of result.lecturerEvents) {
 if (!event.lecturer) continue;
 const events = byLecturer.get(event.lecturer) || []; events.push(event); byLecturer.set(event.lecturer,events);
}
const lecturerDatasets = [];
manifest.lecturers = [...byLecturer].sort(([a],[b])=>a.localeCompare(b)).map(([name,events])=>{
 events.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.subject.localeCompare(b.subject)||a.id.localeCompare(b.id));
 const days = new Map();for(const event of events){const day=days.get(event.date)||[];day.push(event);days.set(event.date,day);}
 for(const day of days.values())for(const event of day)event.overlap=day.some(other=>other.id!==event.id&&event.start<other.end&&other.start<event.end);
 const item={id:createHash('sha256').update(name).digest('hex').slice(0,16),name,eventCount:events.length,firstDate:events[0].date,lastDate:events.at(-1).date};
 lecturerDatasets.push({class:item,events});return item;
});
manifest.counts={classes:manifest.classes.length,studentEvents:result.total,allEvents:result.lecturerEvents.length,lecturerEvents:lecturerDatasets.reduce((n,d)=>n+d.events.length,0)};
// Finish decoding before replacing generated files. Do not touch unrelated assets.
for(const [folder,pattern] of [['data',/^\d+\.json$/],['calendars',/^\d+\.ics$/],['lecturers',/^[a-f0-9]+\.json$/]]){
 const directory=path.join(destination,folder);await mkdir(directory,{recursive:true});
 for(const file of await readdir(directory))if(pattern.test(file))await unlink(path.join(directory,file));
}
for(const dataset of Object.values(result.datasets)){
 await writeFile(path.join(destination,'data',dataset.class.id+'.json'),JSON.stringify(dataset));
 await writeFile(path.join(destination,'calendars',dataset.class.id+'.ics'),classCalendar(dataset.class,dataset.events,new Date(revisionDate+'T00:00:00Z')));
}
for(const dataset of lecturerDatasets)await writeFile(path.join(destination,'lecturers',dataset.class.id+'.json'),JSON.stringify(dataset));
await writeFile(path.join(destination,'data','manifest.json'),JSON.stringify(manifest));
console.log(JSON.stringify({sourceHash:manifest.sourceHash,revisionCode,revisionDate,...manifest.counts}));

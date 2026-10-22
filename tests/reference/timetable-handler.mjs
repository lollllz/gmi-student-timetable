import { createHash } from 'node:crypto';
import { decodeDav } from './dav-reader.js';
import { validDate } from './core.js';
const allowedOrigins = new Set(['https://lollllz.github.io', 'https://gmi-schedule.netlify.app']);
const baselineDate = '2026-10-15';
const maxBytes = 4 * 1024 * 1024;
export function createTimetableHandler(getStore, now = () => Date.now()) {
 return async request => {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  const suppliedOrigin=request.headers.get('origin');
  if(allowedOrigins.has(suppliedOrigin))Object.assign(headers,{'Access-Control-Allow-Origin':suppliedOrigin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Timetable-Filename'});
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(suppliedOrigin && !allowedOrigins.has(suppliedOrigin))return reply({error:'Origin not allowed.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(request.method))return reply({error:'Method not allowed.'},405);
  try {
   const store=getStore();
   if(request.method==='GET'){
    const query=new URL(request.url).searchParams;const resource=query.get('resource')||'manifest';
    if(resource==='manifest'){const data=await store.get('current',{type:'json'});return data?reply(data):reply({error:'No community timetable published.'},404);}
    const release=query.get('release'),id=query.get('id');
    if(!/^[a-f0-9]{64}$/.test(release||'')||!['class','lecturer'].includes(resource)||!/^[a-f0-9]{1,20}$/.test(id||''))return reply({error:'Invalid dataset.'},400);
    const data=await store.get(`releases/${release}/${resource}/${id}`,{type:'json'});return data?reply(data):reply({error:'Dataset unavailable.'},404);
   }
   if(!allowedOrigins.has(suppliedOrigin))return reply({error:'Submit from the timetable website.'},403);
   if(!request.headers.get('content-type')?.startsWith('application/octet-stream'))return reply({error:'DAV binary required.'},415);
   let filename;try{filename=decodeURIComponent(request.headers.get('x-timetable-filename')||'');}catch{return reply({error:'Invalid filename.'},400);}
   const match=/^[\w .()-]{1,120}_([A-Z][A-Z0-9]{1,12})_(\d{2})(\d{2})(\d{4})\.dav$/i.exec(filename);
   if(!match)return reply({error:'Use the original revision filename, ending _R04D_15102026.dav (revision and DDMMYYYY date).'},400);
   const date=`${match[4]}-${match[3]}-${match[2]}`;
   const today=new Date(now()+8*3600000).toISOString().slice(0,10);
   if(!validDate(date)||date<baselineDate||date>today)return reply({error:'The filename must contain a valid revision date, no older than the provided timetable and no later than today (MYT).'},400);
   if(Number(request.headers.get('content-length'))>maxBytes)return reply({error:'Shared DAV uploads must be 4 MB or smaller.'},413);
   const reader=request.body?.getReader();if(!reader)return reply({error:'DAV file required.'},400);
   let size=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();return reply({error:'Shared DAV uploads must be 4 MB or smaller.'},413);}chunks.push(value);}
   const bytes=Buffer.concat(chunks);const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
   let result;try{result=await decodeDav(buffer,filename);}catch{return reply({error:'Validation failed: this is not a fully decodable supported DaVinci V30 timetable.'},400);}
   if(!result.total||!result.manifest.classes.length||result.manifest.classes.length>500||result.manifest.lecturers.length>750||result.total>100000)return reply({error:'Validation failed: empty timetable.'},400);
   const current=await store.getWithMetadata('current',{type:'json'});
   const manifest=result.manifest;
   if(current?.data?.sourceHash===manifest.sourceHash)return reply({manifest:current.data,unchanged:true});
   if(current?.data?.sourceRevisionDate>date)return reply({error:'A newer dated timetable is already published.'},409);
   const byLecturer=new Map();for(const event of result.lecturerEvents){if(event.lecturer){const list=byLecturer.get(event.lecturer)||[];list.push(event);byLecturer.set(event.lecturer,list);}}
   const lecturerDatasets=[];
   manifest.lecturers=[...byLecturer].sort(([a],[b])=>a.localeCompare(b)).map(([name,events])=>{
    events.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
    const days=new Map();for(const event of events){const day=days.get(event.date)||[];day.push(event);days.set(event.date,day);}for(const day of days.values())for(const event of day)event.overlap=day.some(other=>other.id!==event.id&&event.start<other.end&&other.start<event.end);
    const item={id:createHash('sha256').update(name).digest('hex').slice(0,16),name,eventCount:events.length,firstDate:events[0]?.date,lastDate:events.at(-1)?.date};lecturerDatasets.push({class:item,events});return item;
   });
   Object.assign(manifest,{communityUpload:true,publishedAt:new Date(now()).toISOString(),sourceRevision:date,sourceRevisionDate:date,revisionCode:match[1].toUpperCase(),sourceFilename:filename,sourceBytes:size,omittedSlots:result.omitted,counts:{classes:manifest.classes.length,studentEvents:result.total,allEvents:result.lecturerEvents.length}});delete manifest.filename;
   const tasks=Object.values(result.datasets).map(data=>({key:`class/${data.class.id}`,data})).concat(lecturerDatasets.map(data=>({key:`lecturer/${data.class.id}`,data})));
   // Publish the pointer only after every dataset is durable. An ETag conflict rejects a concurrent publication.
   for(let i=0;i<tasks.length;i+=20)await Promise.all(tasks.slice(i,i+20).map(({key,data})=>store.setJSON(`releases/${manifest.sourceHash}/${key}`,data)));
   await store.set(`releases/${manifest.sourceHash}/source.dav`,bytes);
   await store.setJSON(`releases/${manifest.sourceHash}/manifest`,manifest);
   const changed=await store.setJSON('current',manifest,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
   if(!changed.modified)return reply({error:'Another timetable was published while validating. Reload before submitting again.'},409);
   return reply({manifest},201);
  }catch{return reply({error:'Shared timetable service unavailable. Refresh to check the published revision before retrying.'},503);}
 };
}

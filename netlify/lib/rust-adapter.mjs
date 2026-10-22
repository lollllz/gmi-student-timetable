// Platform I/O only. Routing, validation, timetable processing and response policy live in Rust.
import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import init, * as engine from '../../rust/pkg/engine/engine.js';
import { randomUUID } from 'node:crypto';
const ready = init({module_or_path:readFileSync(resolve(process.cwd(),'rust/pkg/engine/engine_bg.wasm'))});
const stores = new Map();
async function storage(operation,name,key,data,options) {
 const store = stores.get(name) || getStore({name,consistency:'strong'}); stores.set(name,store);
 switch(operation) {
  case 'get': return store.get(key,{type:'json'});
  case 'metadata': return store.getWithMetadata(key,{type:'json'});
  case 'set': return store.setJSON(key,data,options);
  case 'set_bytes': return store.set(key,data,options);
  case 'delete': await store.delete(key); return null;
  case 'list': return store.list(options);
  case 'list_page': { for await(const page of store.list({...options,paginate:true}))return page; return {blobs:[]}; }
  default: throw new Error('Unknown storage operation');
 }
}
export async function handle(request,context,path) {
 await ready;
 const url=new URL(request.url),limit=engine.max_body(path);
 const reader=request.body?.getReader();const chunks=[];let size=0;
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;chunks.push(value.subarray(0,Math.max(0,limit+1-(size-value.length))));if(size>limit){await reader.cancel();break;}}
 const bytes=new Uint8Array(Math.min(size,limit+1));let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const input={method:request.method,origin:request.headers.get('origin')||'',host:url.hostname,path,query:Object.fromEntries(url.searchParams),filename:request.headers.get('x-timetable-filename')||'',contentType:request.headers.get('content-type')||'',production:context.deploy.context==='production',deployId:context.deploy.id,uuid:randomUUID(),now:Date.now()};
 const output=await engine.handle(input,bytes,storage);
 return new Response(output.status===204?null:JSON.stringify(output.body),{status:output.status,headers:output.headers});
}

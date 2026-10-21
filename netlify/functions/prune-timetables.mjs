import { getStore } from '@netlify/blobs';
export default async (_request,context)=>{
 if(context.deploy.context!=='production')return new Response(null,{status:204});
 const store=getStore({name:'community-timetables',consistency:'strong'});
 const current=await store.get('current',{type:'json'});const cutoff=Date.now()-7*86400000;let removed=0;
 const {directories}=await store.list({prefix:'releases/',directories:true});
 for(const prefix of directories){
  if(prefix===`releases/${current?.sourceHash}/`)continue;
  const manifest=await store.get(prefix+'manifest',{type:'json'});
  if(!manifest || Date.parse(manifest.publishedAt)>=cutoff)continue;
  for await(const page of store.list({prefix,paginate:true}))for(const blob of page.blobs){await store.delete(blob.key);removed++;}
 }
 return Response.json({removed});
};
export const config={schedule:'30 7 * * *'};

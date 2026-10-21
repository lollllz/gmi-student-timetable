import { getStore } from '@netlify/blobs';
export default async (_request, context) => {
  if (context.deploy.context !== 'production') return new Response(null,{status:204});
  const store = getStore({name:'lift-reports',consistency:'strong'});
  const cutoff = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  let removed = 0;
  for await (const page of store.list({paginate:true})) {
    for (const blob of page.blobs) {
      if (/^\d{4}-\d{2}-\d{2}\//.test(blob.key) && blob.key.slice(0,10)<cutoff) { await store.delete(blob.key); removed++; }
    }
  }
  return Response.json({removed});
};
export const config = {schedule:'0 7 * * *'};

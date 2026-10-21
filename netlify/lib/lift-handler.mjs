import { randomUUID } from 'node:crypto';
export const statuses = ['working', 'intermittent', 'out-of-service'];
const allowedOrigin = 'https://lollllz.github.io';
export function createLiftHandler(getStore, now = () => Date.now()) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin === allowedOrigin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (origin && origin !== allowedOrigin) return reply({ error: 'Origin not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET','POST'].includes(request.method)) return reply({ error: 'Method not allowed.' },405);
    try {
      const store = getStore();
      const timestamp = now();
      if (request.method === 'POST') {
        if (origin !== allowedOrigin) return reply({ error: 'Submit from the timetable website.' },403);
        if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'JSON required.' },415);
        if (Number(request.headers.get('content-length')) > 1024) return reply({ error: 'Report too large.' },413);
        // Bound the actual stream as well as Content-Length (which can be absent).
        const reader = request.body?.getReader(); let bytes = 0; const chunks = [];
        if (!reader) return reply({ error: 'Report required.' },400);
        while (true) { const {done,value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1024) { await reader.cancel(); return reply({error:'Report too large.'},413); } chunks.push(value); }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply({error:'Invalid report.'},400); }
        const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : '';
        const building = clean(input?.building), lift = clean(input?.lift);
        const valid = value => value.length >= 1 && value.length <= 60 && /^[\p{L}\p{N} .()/#-]+$/u.test(value);
        if (!valid(building) || !valid(lift) || !statuses.includes(input?.status) || input?.website) return reply({error:'Choose a condition and enter a building and lift label (up to 60 characters each).'},400);
        const report = { id: randomUUID(), building, lift, status: input.status, observedAt: new Date(timestamp).toISOString() };
        const day = report.observedAt.slice(0,10);
        await store.setJSON(`${day}/${9999999999999-timestamp}-${report.id}`, report);
        return reply({ report },201);
      }
      const keys = [];
      for (const day of [timestamp, timestamp - 86400000].map(value => new Date(value).toISOString().slice(0,10))) {
        for await (const page of store.list({ prefix: day+'/', paginate: true })) { keys.push(...page.blobs.slice(0,100).map(blob=>blob.key)); break; }
      }
      const records = await Promise.all(keys.map(key=>store.get(key,{type:'json'})));
      const reports = records.filter(report=>report && statuses.includes(report.status) && timestamp-Date.parse(report.observedAt) >= 0 && timestamp-Date.parse(report.observedAt)<86400000).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)).slice(0,100);
      return reply({ reports, fetchedAt: new Date(timestamp).toISOString() });
    } catch { return reply({ error: 'Lift reports are temporarily unavailable. Please try again later.' },503); }
  };
}

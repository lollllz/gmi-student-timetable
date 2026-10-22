let engine;
async function load() { if (!engine) engine = import('./engine/engine.js').then(async module => { await module.default(); return module; }); return engine; }
export async function edit_source(bytes,id,note,day,period) { const module = await load(); const next = module.edit(bytes,id,note,day,period); return { bytes: next, decoded: module.decode(next,'Timetable.dav') }; }

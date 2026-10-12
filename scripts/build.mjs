import { cp, mkdir, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'core.js', 'icons.js', 'dav-reader.js', 'file-worker.js', 'calendar.js', 'class-search.js']) {
  await cp(new URL(name, root), new URL(name, dist));
}
await cp(new URL('public/', root), dist, { recursive: true });
console.log('Built static student timetable in dist/.');

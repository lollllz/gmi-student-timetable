import {mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(new URL('../',import.meta.url).pathname);
const target=resolve(process.argv[2]||'reports-release');
if(!basename(target).startsWith('rust-'))throw Error('Choose a dedicated rust-* release directory.');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
for(const folder of ['netlify/functions','rust/pkg/engine']){await mkdir(resolve(target,folder),{recursive:true});await cp(resolve(root,folder),resolve(target,folder),{recursive:true});}
await mkdir(resolve(target,'netlify/lib'),{recursive:true});await cp(resolve(root,'netlify/lib/rust-adapter.mjs'),resolve(target,'netlify/lib/rust-adapter.mjs'));
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
await writeFile(resolve(target,'package.json'),JSON.stringify({name:'gmi-rust-service',version:'1.0.0',private:true,type:'module',dependencies:{'@netlify/blobs':pkg.dependencies['@netlify/blobs']}},null,2)+'\n');
await writeFile(resolve(target,'netlify.toml'),`[build]\n  command = "node build-page.mjs"\n  publish = "reports-dist"\n[functions]\n  directory = "netlify/functions"\n  node_bundler = "esbuild"\n  included_files = ["rust/pkg/engine/*.wasm"]\n`);
await writeFile(resolve(target,'build-page.mjs'),`import{mkdir,writeFile}from'node:fs/promises';await mkdir('reports-dist',{recursive:true});await writeFile('reports-dist/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>GMI campus service</title><h1>GMI campus service</h1><p>Use the <a href="https://gmi-schedule.netlify.app/">student timetable</a> to view schedules and submit observations.</p></html>');`);
const bytes=await readFile(resolve(root,'rust/pkg/engine/engine_bg.wasm'));
await writeFile(resolve(target,'rust-build.json'),JSON.stringify({engineSha256:createHash('sha256').update(bytes).digest('hex'),cargoLockSha256:createHash('sha256').update(await readFile(resolve(root,'Cargo.lock'))).digest('hex'),wasmBindgen:'0.2.105'},null,2)+'\n');
console.log('Staged verified portable Rust service artifacts in '+target);

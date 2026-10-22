import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import binaryen from 'binaryen';
import { icon } from '../assets/icons.js';
const root = fileURLToPath(new URL('../',import.meta.url));
const cargo = existsSync(homedir()+'/.cargo/bin/cargo') ? homedir()+'/.cargo/bin/cargo' : 'cargo';
const bindgen = existsSync(homedir()+'/.cargo/bin/wasm-bindgen') ? homedir()+'/.cargo/bin/wasm-bindgen' : 'wasm-bindgen';
const run=(cmd,args)=>{const result=spawnSync(cmd,args,{cwd:root,stdio:'inherit'});if(result.status!==0)throw Error(cmd+' failed');};
run(cargo,['build','--locked','--release','--target','wasm32-unknown-unknown','-p','timetable-web','-p','timetable-engine']);
for(const [name,target]of [['web','web'],['engine','web'],['node','nodejs']]){await mkdir(root+'rust/pkg/'+name,{recursive:true});run(bindgen,['target/wasm32-unknown-unknown/release/timetable_'+(name==='node'?'engine':name)+'.wasm','--target',target,'--out-dir','rust/pkg/'+name,'--out-name',name==='node'?'engine':name]);}
await writeFile(root+'rust/pkg/node/package.json','{"type":"commonjs"}\n');
await rm(root+'dist',{recursive:true,force:true});await mkdir(root+'dist',{recursive:true});await cp(root+'public',root+'dist',{recursive:true});await cp(root+'styles.css',root+'dist/styles.css');await cp(root+'THIRD_PARTY_NOTICES.txt',root+'dist/THIRD_PARTY_NOTICES.txt');

const hashes={},binaries={};binaryen.setOptimizeLevel(2);binaryen.setShrinkLevel(2);
for(const name of ['web','engine']){const input=await readFile(root+'rust/pkg/'+name+'/'+name+'_bg.wasm');const module=binaryen.readBinary(input);module.setFeatures(binaryen.Features.MutableGlobals | binaryen.Features.NontrappingFPToInt | binaryen.Features.BulkMemory | binaryen.Features.BulkMemoryOpt | binaryen.Features.SignExt | binaryen.Features.ReferenceTypes | binaryen.Features.Multivalue);module.optimize();binaries[name]=module.emitBinary();module.dispose();hashes[name]=createHash('sha256').update(binaries[name]).digest('hex').slice(0,16);}
await mkdir(root+'dist/rust/pkg',{recursive:true});
for(const name of ['web','engine']){
 const folder=root+'dist/rust/pkg/'+name+'/';await mkdir(folder,{recursive:true});
 let glue=await readFile(root+'rust/pkg/'+name+'/'+name+'.js','utf8');glue=glue.replaceAll(name+'_bg.wasm',name+'_bg-'+hashes[name]+'.wasm');
 if(name==='web')glue=glue.replace('../engine-bridge.js','../engine-bridge-'+hashes.engine+'.js');
 await writeFile(folder+name+'-'+hashes[name]+'.js',glue);await writeFile(folder+name+'_bg-'+hashes[name]+'.wasm',binaries[name]);
}
let bridge=await readFile(root+'rust/engine-bridge.js','utf8');bridge=bridge.replace('./engine/engine.js','./engine/engine-'+hashes.engine+'.js');await writeFile(root+'dist/rust/pkg/engine-bridge-'+hashes.engine+'.js',bridge);
let html=await readFile(root+'index.html','utf8');html=html.replace(/<span data-icon="([^"]+)"><\/span>/g,(_,name)=>`<span data-icon="${name}">${icon(name)}</span>`);
html=html.replace('src="./app.js"','src="./app-'+hashes.web+'.js"');html=html.replace('<link rel="stylesheet"',`<link rel="preload" href="./rust/pkg/web/web_bg-${hashes.web}.wasm" as="fetch" type="application/wasm" crossorigin><link rel="modulepreload" href="./rust/pkg/web/web-${hashes.web}.js"><link rel="modulepreload" href="./rust/pkg/engine-bridge-${hashes.engine}.js"><link rel="stylesheet"`);await writeFile(root+'dist/index.html',html);
await writeFile(root+'dist/app-'+hashes.web+'.js',`import init,{start} from './rust/pkg/web/web-${hashes.web}.js';
try { await init(); start(); } catch(error) { console.error(error); document.querySelector('#schedule').innerHTML='<div class="state-panel"><h2>Could not start the timetable</h2><p>Refresh to retry. This browser needs WebAssembly enabled.</p></div>'; }
`);
await writeFile(root+'dist/file-worker.js',`import init,{decode} from './rust/pkg/engine/engine-${hashes.engine}.js';
const ready=init();self.onmessage=async({data})=>{try{await ready;self.postMessage({ok:true,result:JSON.parse(decode(new Uint8Array(data.buffer),data.filename))});}catch(error){self.postMessage({ok:false,error:String(error.message||error)});}};
`);
console.log('Built Rust/WebAssembly application in dist/.');

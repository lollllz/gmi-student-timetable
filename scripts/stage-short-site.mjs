import {cp,readdir,rm} from 'node:fs/promises';
const target=new URL('../hosting/short-address/public/',import.meta.url);
for(const name of await readdir(target)){if(name!=='_redirects')await rm(new URL(name,target),{recursive:true,force:true});}
await cp(new URL('../dist/',import.meta.url),target,{recursive:true});
console.log('Staged direct CDN assets for the short-address project. Only the hourly air snapshot remains proxied.');

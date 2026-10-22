import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage} from '../netlify/lib/rust-adapter.mjs';

test('Blobs clients are reused within one request and refreshed for the next request',async()=>{
 let credential='first-request';const opened=[];
 const openStore=({name})=>{const captured=credential;opened.push({name,captured});return{get:async key=>({key,credential:captured})};};
 const first=createStorage(openStore);
 assert.equal((await first('get','community-timetables','current')).credential,'first-request');
 credential='next-request';
 assert.equal((await first('get','community-timetables','another-key')).credential,'first-request');
 const second=createStorage(openStore);
 assert.equal((await second('get','community-timetables','current')).credential,'next-request');
 assert.equal(opened.length,2);
});

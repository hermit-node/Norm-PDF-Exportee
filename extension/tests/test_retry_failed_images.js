'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9sAAAAASUVORK5CYII=','base64');
const attempts=new Map();let fail=true;
const ctx={window:{},URL,Uint8Array,AbortController,DOMException,Date,setTimeout,clearTimeout,atob,btoa,
 location:{origin:'https://chatgpt.com',pathname:'/c/12345678-1234-1234-1234-123456789012'},
 document:{querySelectorAll:()=>[]},
 fetch:async (url,options)=>{
   if(url==='/api/auth/session')return {ok:true,json:async()=>({accessToken:'fixture'})};
   if(url.startsWith('/backend-api/files/download/')){
     const id=/download\/(file_[^?]+)/.exec(url)?.[1];assert(id);attempts.set(id,(attempts.get(id)||0)+1);
     if(id==='file_bad111'&&fail)return {ok:false,status:503};
     return {ok:true,json:async()=>({download_url:'https://chatgpt.com/backend-api/estuary/content?id='+id})};
   }
   if(url.startsWith('https://chatgpt.com/backend-api/estuary/content'))return {ok:true,status:200,headers:{get:()=>String(data.length)},arrayBuffer:async()=>Uint8Array.from(data).buffer};
   throw Error('Unexpected '+url);
 }};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','capture.js'),'utf8'),ctx);
const cap=ctx.window.NormLocalCapture;
const ids=['file_good111','file_bad111','file_good222'];
const snap={source:'chatgpt-api-graph',complete:true,messages:[{id:'u',role:'user',attachments:ids.map(id=>({id,kind:'image',mime:'image/png'}))}],warnings:[]};
(async()=>{
 await cap.resolveImages(snap);
 assert.equal(snap.imageCoverage.expected,3);assert.equal(snap.imageCoverage.embedded,2);assert.equal(snap.imageCoverage.failed,1);
 assert.equal(snap.imageCoverage.failures[0].id,'file_bad111');
 assert.equal(snap.imageCoverage.uploaded.embedded,2);assert.equal(snap.warnings.length,1);
 const preserved=snap.imageAssets.file_good111;
 await cap.retryFailedImages(snap);
 assert.equal(snap.imageCoverage.embedded,2);assert.equal(snap.imageCoverage.failed,1);assert.equal(snap.imageCoverage.failures.length,1);
 assert.equal(snap.warnings.length,1,'failed retry must not multiply warnings');
 assert.equal(attempts.get('file_good111'),1,'retry should not re-download successful images');
 fail=false;
 await cap.retryFailedImages(snap);
 assert.equal(snap.imageCoverage.embedded,3);assert.equal(snap.imageCoverage.failed,0);assert.equal(snap.imageCoverage.complete,true);
 assert.equal(snap.imageCoverage.failures.length,0);
 assert.equal(snap.imageCoverage.uploaded.embedded,3);
 assert.equal(snap.warnings.length,0,'stale warning removed after success');
 assert.equal(snap.imageAssets.file_good111,preserved,'original image preserved without clone');
 assert.equal(attempts.get('file_good111'),1);assert.equal(attempts.get('file_good222'),1);
 assert.equal(attempts.get('file_bad111'),3);
 await cap.retryFailedImages(snap);assert.equal(attempts.get('file_bad111'),3,'completed images not retried');
 console.log('PASS isolated image retry, no loss of 2 good assets, failed retry, warning refresh, 3/3 recovery');
})().catch(e=>{console.error(e);process.exitCode=1});

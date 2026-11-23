const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/../background.js','utf8');
const good=new Uint8Array([255,216,255,224,1,2,3,4]);
let listeners=[], requests=[];
const chrome={runtime:{onMessage:{addListener(fn){listeners.push(fn)}}}};
const ctx={chrome,URL,Uint8Array,setTimeout,clearTimeout,AbortController,btoa,
  fetch:async(url,opts)=>{requests.push({url,opts});return {
   ok:true,headers:{get:n=>n==='content-type'?'image/jpeg':n==='content-length'?'8':null},
   arrayBuffer:async()=>good.buffer
  }}};
vm.runInNewContext(code,ctx);
function message(request,sender){return new Promise((resolve,reject)=>{let done=false;const cb=x=>{done=true;resolve(x)};const active=listeners.some(fn=>fn(request,sender,cb)===true||done);if(!active)reject(Error("Unhandled request"));});}
(async()=>{
  const ok=await message({type:'norm-fetch-openai-image',url:'https://files.oaiusercontent.com/file-test'},
    {url:'https://chatgpt.com/c/fake'});
  assert(ok.ok && ok.bytes===8 && ok.dataUrl.startsWith('data:image/jpeg;base64,'));
  assert(requests.length===1 && requests[0].opts.credentials==='omit' && requests[0].opts.redirect==='error');
  const forbidden=await message({type:'norm-fetch-openai-image',url:'https://evil.example/upload?token=123'},
    {url:'https://chatgpt.com/c/fake'});
  assert(!forbidden.ok&&requests.length===1);
  const spoof=await message({type:'norm-fetch-openai-image',url:'https://files.oaiusercontent.com/file-test'},
    {url:'https://evil.example'});
  assert(!spoof.ok&&requests.length===1);
  const amazon=await message({type:'norm-fetch-openai-image',url:'https://m.media-amazon.com/images/I/test.jpg'},{url:'https://chatgpt.com/c/fake'});
  assert(amazon.ok&&requests.length===2);assert.equal(requests[1].opts.credentials,'omit');assert.equal(requests[1].opts.referrerPolicy,'no-referrer');assert.equal(requests[1].opts.redirect,'error');assert(!requests[1].opts.headers);
  for(const url of ['https://m.media-amazon.com.evil.example/images/I/test.jpg','https://m.media-amazon.com/api','https://m.media-amazon.com/images/I/test.jpg?token=abc','https://x:m@m.media-amazon.com/images/I/test.jpg']){const v=await message({type:'norm-fetch-openai-image',url},{url:'https://chatgpt.com/c/fake'});assert(!v.ok);}
  assert.equal(requests.length,2);
  console.log('PASS worker allows public Amazon image CDN, no credentials, rejects arbitrary hosts, queries, non-image paths and wrong sender');
})().catch(e=>{console.error(e);process.exit(1)});

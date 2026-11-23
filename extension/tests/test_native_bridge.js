'use strict';
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const listeners=[],nativeRequests=[];
let connected=false;
const handlers=[],disconnectHandlers=[];
const port={
 onMessage:{addListener(fn){handlers.push(fn);}},
 onDisconnect:{addListener(fn){disconnectHandlers.push(fn);}},
 postMessage(data){
  nativeRequests.push(data);
  setTimeout(()=>{
   const reply=data.type==='begin'?{ok:true,type:'ready'}:
    data.type==='chunk'?{ok:true,type:'ack',seq:data.seq}:
    {ok:true,type:'complete',path:'C:\\Users\\Test\\Downloads\\test.pdf',bytes:100, chunks:2};
   for(const h of handlers)h(reply);
  },0);
 },
 disconnect(){connected=false;for(const h of disconnectHandlers)h();}
};
const chrome={
 runtime:{
  onMessage:{addListener(fn){listeners.push(fn);}},
  connectNative(name){assert.equal(name,'com.norm.localpdf');connected=true;return port;},
  get lastError(){return undefined;}
 }
};
const ctx={chrome,fetch(){throw Error('No network expected')},setTimeout,clearTimeout,URL,Uint8Array,ArrayBuffer,String,Promise};
vm.runInNewContext(fs.readFileSync(__dirname+'/../background.js','utf8'),ctx);
async function ask(type,rest={}){
 return new Promise((resolve,reject)=>{
   let responded=false;
   const callback=value=>{if(responded)return;responded=true;resolve(value)};
   const sender={url:'https://chatgpt.com/c/test',tab:{id:17},frameId:0};
   const rv=listeners.map(fn=>fn({type,...rest},sender,callback));
   if(!rv.includes(true)&&!responded)reject(Error('No async handler: '+type));
   setTimeout(()=>{if(!responded)reject(Error('Timed out '+type))},3000);
 });
}
(async()=>{
 const start=await ask('norm-native-pdf-start',{name:'Test',template:'conversation'});
 assert.equal(start.type,'ready');
 const chunk1=await ask('norm-native-pdf-chunk',{seq:0,text:'<html>'});
 const chunk2=await ask('norm-native-pdf-chunk',{seq:1,text:'</html>'});
 assert.equal(chunk1.seq,0);assert.equal(chunk2.seq,1);
 const end=await ask('norm-native-pdf-finish');
 assert.equal(end.type,'complete');assert.equal(end.ok,true);
 assert.deepEqual(nativeRequests.map(x=>x.type),['begin','chunk','chunk','finish']);
 assert.equal(nativeRequests[1].text+nativeRequests[2].text,'<html></html>');
 console.log('PASS native extension relay: begin, two sequential chunks, finish, native result');
})().catch(e=>{console.error(e);process.exitCode=1});

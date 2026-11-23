'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
class FakeElement {
 constructor(){this.disabled=false;this.hidden=false;this.checked=false;this.style={};this.listeners={};this.children=[];this.dataset={};this.textContent='';this.value='';this.lastChild={textContent:''};}
 addEventListener(kind,fn){this.listeners[kind]=fn;}
 append(...children){this.children.push(...children);this.lastChild=children.at(-1)||this.lastChild;}
 appendChild(child){this.children.push(child);this.lastChild=child;return child;}
 replaceChildren(...children){this.children=[...children];}
 querySelector(selector){return items[selector]||null;}
 querySelectorAll(selector){return selector==='button'?exportButtons:[];}
}
const selectors=['.norm-status','.norm-result','.norm-accept','.norm-check','.norm-start','.norm-retry','.norm-cancel','.norm-exports','.norm-close','.norm-template'];
const items=Object.fromEntries(selectors.map(s=>[s,new FakeElement()]));
const exportButtons=['pdf','nativepdf','zip','html','markdown','json'].map(kind=>{const b=new FakeElement();b.dataset={kind};return b;});
items['.norm-template'].value='conversation';
const body=new FakeElement();const ctx={window:{},document:{body,getElementById:()=>null,createElement:()=>new FakeElement()},location:{href:'https://chatgpt.com/c/12345678-1234-1234-1234-123456789012'},AbortController,setTimeout,clearTimeout,URL};
ctx.window.top=ctx.window;
let snapshot;
const snap=(api)=>({title:'Test large conversation',complete:api,source:api?'chatgpt-api-graph':'chatgpt-dom',coverage:'API parent chain reached root',totalNodes:1575,messages:Array.from({length:1436},(_,i)=>({id:String(i)})),warnings:[],imageCoverage:{complete:false,expected:88,embedded:87,failed:1,bytes:10000,failures:[{id:'file_missing111',stage:'download image',reason:'HTTP 503'}],uploaded:{expected:88,embedded:87,failed:1},assistant:{expected:0,embedded:0,failed:0}}});
let downloads=0,retries=0;
ctx.window.NormLocalCapture={extract:async()=>snapshot,resolveImages:async d=>d,retryFailedImages:async d=>{retries++;d.imageCoverage={...d.imageCoverage,complete:true,embedded:88,failed:0,failures:[],uploaded:{expected:88,embedded:88,failed:0}};return d;}};
ctx.window.NormLocalRender={buildManifest:d=>({apiConfirmedComplete:d.complete&&d.source.startsWith('chatgpt-api'),visuallyComplete:!!d.imageCoverage.complete,attachmentReferences:176,imageReferences:d.imageCoverage.expected,imagesEmbedded:d.imageCoverage.embedded,imagesFailed:d.imageCoverage.failed,uploadedImages:d.imageCoverage.uploaded,assistantImages:d.imageCoverage.assistant,imageFailures:d.imageCoverage.failures}),makeAssets:()=>({html:'<html>Test</html>',markdown:'Hi',json:'{}',manifest:'{}'}),download:()=>{downloads++;},buildZip:()=>null,imageFileEntries:()=>({})};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8'),ctx);
const start=items['.norm-start'],retry=items['.norm-retry'],buttons=items['.norm-exports'],optin=items['.norm-accept'],status=items['.norm-status'],check=items['.norm-check'];
(async()=>{
 snapshot=snap(true);await start.listeners.click();
 assert.equal(buttons.hidden,false);assert.equal(exportButtons.every(b=>!b.disabled),true,'API capture must permit export despite missing image');
 assert.equal(retry.hidden,false);assert.match(retry.textContent,/Retry 1 missing image/);assert.match(status.textContent,/export now/);
 assert.equal(optin.style.display,'none','API capture does not need an invisible opt-in checkbox');
 await buttons.listeners.click({target:{dataset:{kind:'html'}}});assert.equal(downloads,1,'HTML export must work');
 await retry.listeners.click();assert.equal(retries,1);assert.equal(retry.hidden,true);assert.equal(exportButtons.every(b=>!b.disabled),true);
 assert.match(status.textContent,/all images captured/);
 snapshot=snap(false);await start.listeners.click();
 assert.equal(exportButtons.every(b=>b.disabled),true,'unverified DOM still requires explicit opt-in');
 assert.equal(optin.style.display,'flex');check.checked=true;check.listeners.change();
 assert.equal(exportButtons.every(b=>!b.disabled),true);await buttons.listeners.click({target:{dataset:{kind:'html'}}});assert.equal(downloads,2);
 console.log('PASS UI: 1436-turn API capture 87/88 allows export, missing image retry, DOM-only opt-in still required');
})().catch(e=>{console.error(e);process.exitCode=1});

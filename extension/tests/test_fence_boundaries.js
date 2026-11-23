'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{},TextEncoder,Blob,Uint8Array,ArrayBuffer,atob,Date};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','render.js'),'utf8'),ctx);
const r=ctx.window.NormLocalRender;
const broken='Reported findings...\n```\nWait no, after that there are additional user messages...';
const messages=[
 {id:'u64',role:'user',text:'Could we reach ATH?',timestamp:1775949577},
 {id:'a64',role:'assistant',text:broken,timestamp:1775949580},
 {id:'u65',role:'user',text:'Wtf was that?',timestamp:1775949581},
 {id:'a65',role:'assistant',text:'That was a glitch.',timestamp:1775949583},
 {id:'u66',role:'user',text:'Long question? '+'.'.repeat(1100),timestamp:1775949585},
 {id:'a66',role:'assistant',text:'Yes, answered.',timestamp:1775949589}
];
const data={messages,title:'SPY Test',source:'fixture',coverage:'fixture'};
const md=r.buildMarkdown(data),ht=r.buildHtml(data),man=r.buildManifest(data);
assert.equal((md.match(/^## \d+\. /gm)||[]).length,3,'three heading turns');
const f=md.match(/^```(?:[^\n]*)$/gm)||[];
assert.equal(f.length,2,'one inserted closing fence');
assert.equal(md.indexOf('```',md.indexOf('```')+3)<md.indexOf('## 2. Wtf was that?'),true,'fence closed before next turn');
assert.equal((md.match(/^\*\*You\*\* · /gm)||[]).length,3,'one user label per turn');
assert.equal((md.match(/^\*\*ChatGPT\*\* · /gm)||[]).length,3,'one assistant label per turn');
assert.equal((ht.match(/class="turn"/g)||[]).length,3);
assert.deepEqual(Array.from(man.formatAudit.suspiciousRecords,x=>x.id),['a64']);
assert.ok(man.formatAudit.longTurns.some(x=>x.turn===3),'1000+ character turn flagged');
assert.match(r.makeAssets(data).json,/Wait no, after that/,'raw JSON retained');
const valid={...data,messages:[{role:'user',text:'Code'},{role:'assistant',text:'```js\nconsole.log(1)\n```\nAfter code'}]};
assert.equal((r.buildMarkdown(valid).match(/^```/gm)||[]).length,2,'already balanced code unchanged');
const tildes={...data,messages:[{role:'user',text:'Code'},{role:'assistant',text:'~~~js\nconsole.log(1)'}]};
assert.equal((r.buildMarkdown(tildes).match(/^~~~/gm)||[]).length,2,'tilde fences balanced');
console.log('PASS: malformed fence contained to one message, real turn headings preserved, 1000-character audit, normal fences unchanged');

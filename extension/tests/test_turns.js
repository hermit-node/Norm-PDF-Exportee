const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={window:{},TextEncoder,Blob,Uint8Array,ArrayBuffer,atob,Date};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'..','render.js'),'utf8'),c);
const r=c.window.NormLocalRender;
const records=[
 {id:'u1',role:'user',text:'First question?',timestamp:1775949577},
 {id:'a1',role:'assistant',model:'gpt-thinking',text:'Starting research...',timestamp:1775949581},
 {id:'a2',role:'assistant',model:'gpt-thinking',text:''},
 {id:'a3',role:'assistant',text:'Thought for 20s',timestamp:1775949601},
 {id:'a4',role:'assistant',text:'## Result\n\nHere is the answer.',timestamp:1775949611},
 {id:'u2',role:'user',text:'Second question?',timestamp:1775949615},
 {id:'a5',role:'assistant',text:'Second response.\n\n| Col | Value |\n| --- | --- |\n| one | **two** |',timestamp:1775949616}
];
const data={title:'Transcript',source:'chatgpt-api-graph',coverage:'test',messages:records};
const html=r.buildHtml(data),md=r.buildMarkdown(data),manifest=r.buildManifest(data);
assert.equal((html.match(/<h2 class="turn-heading">/g)||[]).length,2);
assert.equal((html.match(/class="prompt-card"/g)||[]).length,2);
assert.equal((html.match(/class="assistant-card"/g)||[]).length,2);
assert.equal((md.match(/^## \d+\. /gm)||[]).length,2);
assert.match(md,/\*\*You\*\*.*2026/);
assert.match(md,/\*\*ChatGPT\*\*.*2026/);
assert.match(md,/Starting research\.\.\.[\s\S]*Thought for 20s[\s\S]*Here is the answer/);
assert.match(html,/content-subheading">Result<\/p>/);
assert.doesNotMatch(html,/<h2>Result<\/h2>/);
assert.match(html,/<table><thead>/);
assert.equal(manifest.groupedTurnCount,2);
assert.equal(manifest.emptyRecords,1);
const noTimestamp={...data,messages:[{role:'user',text:'Hello',timestamp:null},{role:'assistant',text:'Hi',timestamp:null}]};
assert.match(r.buildMarkdown(noTimestamp),/Time unavailable/);
const unknown={...data,messages:[{role:'unknown',html:'<p>one</p>'},{role:'unknown',html:'<p>two</p>'}]};
assert.equal(r.buildManifest(unknown).groupedTurnCount,2);
console.log('PASS: grouping, timestamps, preserved segments, limited headings, tables, empty count, unknown fallback');

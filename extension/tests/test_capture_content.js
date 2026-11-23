'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={window:{},document:{title:'Fixture'},location:{origin:'https://chatgpt.com'},setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','capture.js'),'utf8'),ctx);
const c=ctx.window.NormLocalCapture;
const m=(id,role,content,meta={},recipient='all',time=1775949577)=>({id,author:{role},recipient,content,metadata:meta,create_time:time});
const thought=m('a1','assistant',{content_type:'thoughts',thoughts:[
  {summary:'Finding historical data',content:'Need SPY closes and earnings dates',finished:true},
  {summary:'Checking assumptions',content:'Verify the sample period',chunks:['fallback'],finished:true}
]}, {model_slug:'gpt-thinking'});
const a=c.toMessage({message:thought,id:'node-a1'},1,'node-a1');
assert.equal(a.contentType,'thoughts');
assert.match(a.text,/> \*\*Finding historical data\*\*[\s\S]*Need SPY closes and earnings dates/);
assert.match(a.text,/> \*\*Checking assumptions\*\*[\s\S]*Verify the sample period/);
assert.equal(a.timestamp,1775949577);
assert.equal(a.internal,false);
const r=c.toMessage({message:m('a2','assistant',{content_type:'reasoning_recap',content:'Thought for 1m 26s'})},2,'a2');
assert.equal(r.text,'Thought for 1m 26s');
const tool=c.toMessage({message:m('a3','assistant',{content_type:'code',text:'print(1+1)'},{},'python')},3,'a3');
assert.equal(tool.internal,true);assert.equal(tool.recipient,'python');
const fallback=c.toMessage({message:m('a4','assistant',{content_type:'text',parts:[]},{model_dil_v2:{fallbackMarkdown:'Detailed answer in Markdown'}})},4,'a4');
assert.equal(fallback.text,'Detailed answer in Markdown');
const user=c.toMessage({message:m('u1','user',{content_type:'multimodal_text',parts:['Look at this',{content_type:'image_asset_pointer',asset_pointer:'file_abcDEF123'}]})},0,'u1');
assert.match(user.text,/Look at this/);assert.equal(user.attachments[0].id,'file_abcDEF123');
const strange=c.toMessage({message:m('a5','assistant',{content_type:'thoughts',thoughts:[{summary:{unhandled:3},content:{unhandled:4}}]})},5,'a5');
assert.equal(strange.suspectedLoss,true);
const nodes={root:{id:'root',parent:null,message:null},u1:{id:'u1',parent:'root',message:m('u1','user',{content_type:'text',parts:['Question']})},a1:{id:'a1',parent:'u1',message:thought},a2:{id:'a2',parent:'a1',message:m('a2','assistant',{content_type:'text',parts:['Final answer']})}};
const graph=c.legacyGraph({mapping:nodes,current_node:'a2',title:'Fixture'});
assert.equal(graph.messages.length,3);
assert.equal(graph.contentAudit.types.thoughts,1);
assert.equal(graph.contentAudit.recoveredThinkingRecords,1);
assert.equal(graph.contentAudit.potentiallyUnparsedRecords,0);
assert.match(graph.messages[1].text,/Finding historical data/);
console.log('PASS: reasoning summaries, recap, image, tool routing, DIL fallback, loss audit, branch traversal');

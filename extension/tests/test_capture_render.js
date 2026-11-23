'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={window:{},document:{title:'Fixture'},location:{origin:'https://chatgpt.com'},Date,setTimeout,clearTimeout,TextEncoder,Blob,Uint8Array,ArrayBuffer,atob};
for(const src of ['../capture.js','../render.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,src),'utf8'),ctx);
const cap=ctx.window.NormLocalCapture,rnd=ctx.window.NormLocalRender;
const msg=(id,role,content,recipient='all',create_time=1775949577)=>({id,author:{role},content,recipient,create_time,metadata:{model_slug:'gpt-thinking'}});
const raw={
 root:{id:'root',parent:null,message:null},
 u:{id:'u',parent:'root',message:msg('u','user',{content_type:'text',parts:['Where is the result?']})},
 t:{id:'t',parent:'u',message:msg('t','assistant',{content_type:'thoughts',thoughts:[{summary:'Checking data',content:'I am comparing dates.'}]})},
 c:{id:'c',parent:'t',message:msg('c','assistant',{content_type:'code',text:'SECRET_INTERNAL_TOOL_CALL'},'python')},
 a:{id:'a',parent:'c',message:msg('a','assistant',{content_type:'text',parts:['The verified result is here.']},'all',1775949600)}
};
const data=cap.legacyGraph({title:'Fixture',mapping:raw,current_node:'a'});
const markdown=rnd.buildMarkdown(data),html=rnd.buildHtml(data),manifest=rnd.buildManifest(data);
assert.equal(data.messages.length,4);
assert.equal(manifest.groupedTurnCount,1);
assert.equal(manifest.contentAudit.types.thoughts,1);
assert.equal(manifest.contentAudit.internalByType.code,1);
assert.equal((markdown.match(/^## \d+\. /gm)||[]).length,1);
assert.match(markdown,/Where is the result\?/);
assert.match(markdown,/Checking data[\s\S]*I am comparing dates\./);
assert.match(markdown,/verified result is here/);
assert.doesNotMatch(markdown,/SECRET_INTERNAL_TOOL_CALL/);
assert.doesNotMatch(html,/SECRET_INTERNAL_TOOL_CALL/);
assert.match(html,/reasoning-segment/);
assert.match(rnd.makeAssets(data).json,/SECRET_INTERNAL_TOOL_CALL/);
assert.equal((html.match(/<h2 class="turn-heading">/g)||[]).length,1);
console.log('PASS: real capture-to-export flow keeps reasoning + answers, hides internal commands, preserves raw JSON');

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx={window:{},document:{title:'Source fixture'},location:{origin:'https://chatgpt.com'},TextEncoder,Uint8Array,ArrayBuffer,Blob,Date,atob,setTimeout,clearTimeout};
for(const file of (process.env.NORM_CITE_TEST_STAGED?['../.norm-cite-capture.stage.js','../.norm-cite-render.stage.js']:['../capture.js','../render.js']))
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx);
const cap=ctx.window.NormLocalCapture,r=ctx.window.NormLocalRender;
const tok='citeturn12search0turn12search1',unknown='citeturn66search2';
const m=(id,role,parts,metadata={})=>({id,author:{role},recipient:'all',create_time:1770000000,content:{content_type:'text',parts},metadata});
const source=tok;
const refs=[
 {type:'grouped_webpages',matched_text:source,alt:'([Reuters](https://www.reuters.com/market/article?utm_source=chatgpt.com), [Wikipedia](https://en.wikipedia.org/wiki/Market_(economics)))'},
 {type:'sources_footnote',matched_text:' ',alt:'[Market study](https://www.cxoadvisory.com/calendar-effects/stock-returns-during-and-between-earnings-seasons/)'},
 {type:'grouped_webpages',matched_text:'not a citation',alt:'[Malicious](javascript:alert(1))'},
];
const nodes={root:{id:'root',parent:null,message:null},
 user:{id:'user',parent:'root',message:m('user','user',['What do sources say?'])},
 answer:{id:'answer',parent:'user',message:m('answer','assistant',['The market is stable '+tok+' but details vary '+unknown+'.'],{content_references:refs,model_slug:'gpt-thinking'})}};
const graph=cap.legacyGraph({title:'Sources',current_node:'answer',mapping:nodes});
assert.equal(graph.messages.length,2);
const response=graph.messages[1];assert.equal(response.citations.length,3);
assert.equal(response.text.includes(tok),true,'raw token preserved');
assert.equal(response.citations[0].matchedText,tok);
assert.equal(graph.contentAudit.citationMetadataEntries,3);
const md=r.buildMarkdown(graph),html=r.buildHtml(graph),manifest=r.buildManifest(graph);
if(process.env.NORM_CITE_HTML_OUT)fs.writeFileSync(process.env.NORM_CITE_HTML_OUT,html);
assert.match(md,/\[Reuters\]\(https:\/\/www\.reuters\.com\/market\/article\?utm_source=chatgpt\.com\)/);
assert.match(md,/\[Wikipedia\]\(https:\/\/en\.wikipedia\.org\/wiki\/Market_\(economics\)\)/);
assert.match(md,/\*\*Sources:\*\*/);
assert.match(md,/\[Market study\]\(https:\/\/www\.cxoadvisory\.com\/calendar-effects\//);
assert.doesNotMatch(md,/javascript:alert/);
assert.equal(md.includes('The market is stable '),true,'footnote did not replace space');
assert.equal(md.includes(unknown),true,'unresolved citation retained in Markdown');
assert.match(html,/<a href="https:\/\/www\.reuters\.com\/market\/article\?utm_source=chatgpt\.com"/);
assert.match(html,/<a href="https:\/\/en\.wikipedia\.org\/wiki\/Market_\(economics\)"/);
assert.match(html,/<section class="turn-sources">/);
assert.match(html,/<a href="https:\/\/www\.cxoadvisory\.com\/calendar-effects\//);
assert.doesNotMatch(html,/javascript:/);
assert.doesNotMatch(html,/citeturn12search0/);
assert.match(html,/\[source ref: 1\]/,'unresolved source visibly noted');
assert.equal(manifest.citationAudit.citationMarkers,2);
assert.equal(manifest.citationAudit.linkedMarkers,1);
assert.equal(manifest.citationAudit.unresolvedMarkers,1);
assert.equal(manifest.citationAudit.uniqueSourceUrls,3);
assert.match(r.makeAssets(graph).json,/turn12search0/);
assert.match(r.makeAssets(graph).json,/content_references|matchedText/);
console.log('PASS citation metadata, grouped refs, working HTML/Markdown links, sources footer, footnote-space safety, unresolved honesty, source audit');

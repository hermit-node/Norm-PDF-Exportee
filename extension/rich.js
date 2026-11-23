/* Original decoder of resolved response components: never evaluates code. */
(function(){
'use strict';
const str=x=>typeof x==='string'?x:'';
const list=x=>Array.isArray(x)?x:[];
const plain=x=>str(x).replace(/[\r\n]+/g,' ').trim().slice(0,240);
const key=x=>JSON.stringify(x);
const wire=(k,v)=>'\uE200'+k+'\uE202'+v+'\uE201';
function safeURL(x){try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function sources(items){
 const out=[],seen=new Set();
 for(const item of list(items)){
  const url=safeURL(item?.url||item?.source_url);
  if(url&&!seen.has(url)){seen.add(url);out.push({url,title:plain(item.title||item.attribution||item.source_label)||url});}
 }
 return out;
}
function components(meta){
 const code=str(meta?.code),constants=meta?.constants||{},out=[];
 if(!code||code.length>2000000)return out;
 // Ignore comments and strings; locate only recognized static component calls.
 for(const hit of code.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60|\/\/[^\n]*|\/\*[\s\S]*?\*\/|__dil\.jsx\s*\(\s*(AsyncImageGroup|AsyncImage|Cite|Entity|Link)\s*,\s*(?=\{)/g)){
  if(!hit[1])continue;
  let i=hit.index+hit[0].length,budget=2000;
  const ws=()=>{while(i<code.length&&/\s/.test(code[i]))i++;};
  function literal(depth=0){
   if(depth>18||--budget<0)throw Error('literal limit');
   ws();const ch=code[i];
   if(ch==='"'||ch==="'"){
    const q=ch;let val='';i++;
    while(i<code.length){const c=code[i++];if(c===q)return val;
     if(c==='\\'){const e=code[i++];if(e==='u'){const v=code.slice(i,i+4);if(!/^[\da-f]{4}$/i.test(v))throw Error('escape');val+=String.fromCharCode(parseInt(v,16));i+=4;}else val+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'})[e]??e;}
     else val+=c;
    }throw Error('string');
   }
   if(ch==='{'||ch==='['){
    const obj=ch==='{',end=obj?'}':']',v=obj?Object.create(null):[];
    i++;ws();
    while(code[i]!==end){
     if(i>=code.length)throw Error('literal');
     if(obj){let k;if(code[i]==='"'||code[i]==="'")k=literal(depth+1);else{const m=/^[\w$]+/.exec(code.slice(i));if(!m)throw Error('key');k=m[0];i+=k.length;}ws();if(code[i++]!==':')throw Error('colon');v[k]=literal(depth+1);}
     else v.push(literal(depth+1));
     ws();if(code[i]===end)break;if(code[i++]!==',')throw Error('comma');ws();
    }i++;return v;
   }
   const num=/^-?\d+(?:\.\d+)?/.exec(code.slice(i));if(num){i+=num[0].length;return Number(num[0]);}
   const name=/^[\w$]+/.exec(code.slice(i));if(!name)throw Error('expression');i+=name[0].length;
   const v=name[0];if(v==='true')return true;if(v==='false')return false;if(v==='null')return null;
   if(Object.prototype.hasOwnProperty.call(constants,v))return constants[v];
   if(v==='__dil'||v==='constants'){
    const rest=/^(?:\.constants)?(?:\[(\d+|"[^"]+"|'[^']+')\]|\.(\w+))/.exec(code.slice(i));
    if(rest){i+=rest[0].length;const k=(rest[1]||rest[2]).replace(/^['"]|['"]$/g,'');if(Object.prototype.hasOwnProperty.call(constants,k))return constants[k];}
   }throw Error('unsupported constant');
  }
  try{const props=literal();if(props&&typeof props==='object')out.push({kind:hit[1],props});}catch{}
 }
 return out;
}
function normalize(metadata,raw,index){
 const meta=metadata?.model_dil_v2;
 let text=str(meta?.fallbackMarkdown).trim()?meta.fallbackMarkdown:raw;
 const attachments=[],citations=[],audit={components:0,resolved:0,unresolved:0};
 const entries=meta?.appData?.opGenui?.componentResults||{},descriptors=components(meta);
 const groups=new Map();
 const parsedJSON=s=>{try{return JSON.parse(s);}catch{return s;}};
 const refsKey=x=>key(Array.isArray(x)?x:[x]);
 function lookup(kind,props){
  const refs=props.refs??props.ref,q=props.query;
  let matches=descriptors.filter(x=>x.kind===kind||(kind==='AsyncImage'&&x.kind==='AsyncImageGroup'));
  if(q!==undefined)matches=matches.filter(x=>key(x.props.query)===key(q));
  if(refs!==undefined)matches=matches.filter(x=>refsKey(x.props.refs??x.props.ref)===refsKey(refs));
  if(kind==='Link'&&props.url)matches=matches.filter(x=>x.props.url===props.url);
  if(kind==='Entity'&&props.value)matches=matches.filter(x=>x.props.value===props.value);
  if(matches.length===1){const x=matches[0],r=entries[x.props.__resolutionId];if(r?.status==='resolved'&&r.componentName===x.kind)return r.state;}
  const r=props.__resolutionId&&entries[props.__resolutionId];return r?.status==='resolved'&&r.componentName===kind?r.state:null;
 }
 function addImageGroup(state,label){
  const ids=[],imgs=list(state?.images);
  for(const item of imgs.length?imgs:[{}]){
   const id='rich_'+index+'_'+attachments.length;
   const candidates=[item.publicUrl,item.content_url,item.thumbnail_url].map(safeURL).filter(Boolean);
   attachments.push({id,kind:'image',mime:'image/*',name:plain(item.title)||plain(label)||'Assistant image',source:'assistant-component',candidates:[...new Set(candidates)]});ids.push(id);
  }
  return '\n\n[Norm images: '+ids.join(',')+']\n\n';
 }
 function replace(kind,props){
  audit.components++;const state=lookup(kind,props);if(state)audit.resolved++;else audit.unresolved++;
  if(kind==='AsyncImage'||kind==='AsyncImageGroup'){
   const k=key([props.query,props.refs??props.ref,props.__resolutionId]);if(groups.has(k))return groups.get(k);
   const v=addImageGroup(state,Array.isArray(props.query)?props.query.join(', '):props.query);groups.set(k,v);return v;
  }
  if(kind==='Cite'){
   const refs=props.refs??props.ref,marker=wire('cite',Array.isArray(refs)?refs.join('\uE202'):str(refs)||'unresolved');
   const items=sources(state?.items);if(items.length)citations.push({type:'grouped_webpages',matchedText:marker,items});return marker;
  }
  if(kind==='Entity')return plain(state?.value||props.value)||'';
  if(kind==='Link'){const url=safeURL(state?.url||props.url),title=plain(state?.title||state?.source_label||props.title||url).replace(/[\[\]]/g,'');return url?'['+title+']('+url+')':title||'[Link unavailable]';}
  return '';
 }
 function chunk(s){
  if(!meta&&!/<(?:AsyncImage|Cite|Entity|Link|grid)\b/.test(s))return s;
  s=s.replace(/\uE200(image_group|entity|url|cite)\uE202([^\uE201]*)\uE201/g,(all,kind,payload)=>{
   const obj=parsedJSON(payload);
   if(kind==='image_group')return replace('AsyncImage',{query:obj?.query??obj});
   if(kind==='entity'&&Array.isArray(obj))return replace('Entity',{category:obj[0],value:obj[1]});
   if(kind==='cite'){
    const refs=Array.isArray(obj)?obj:typeof obj==='string'?obj.split('\uE202'):obj?.refs??obj?.ref;
    if(!descriptors.some(x=>x.kind==='Cite'&&refsKey(x.props.refs??x.props.ref)===refsKey(refs)))return all;
    return replace('Cite',{refs});
   }
   if(kind==='url'){const url=safeURL(obj?.url??payload.slice(payload.lastIndexOf('?')+1));if(url)return replace('Link',{url});}
   return all;
  });
  s=s.replace(/<(AsyncImageGroup|AsyncImage|Cite|Entity|Link)\b([^<>]*?)\/>/g,(all,kind,attrs)=>{
   const props=Object.create(null);
   for(const a of attrs.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{(\[[^\}]*\])\})/g))props[a[1]]=a[4]?parsedJSON(a[4]):a[2]??a[3];
   return replace(kind,props);
  });
  for(const ref of list(metadata?.content_references)){
   if(!['image_group','image_v2'].includes(ref?.type)||!str(ref.matched_text).trim()||!s.includes(ref.matched_text))continue;
   const imgs=list(ref.images).length?ref.images:ref.image?[ref.image]:ref.content_url?[ref]:[];
   s=s.split(ref.matched_text).join(addImageGroup({images:imgs},ref.alt));
  }
  return s.replace(/<\/?(?:grid|grid-item|row|col|box|carousel|carousel-item|flow|flow-item|spacer|divider)\b[^<>]*>/g,'');
 }
 if(meta||/<(?:AsyncImage|Cite|Entity|Link|grid)\b/.test(text)||list(metadata?.content_references).some(r=>['image_group','image_v2'].includes(r?.type))){
  let fence='';
  text=text.split('\n').map(line=>{
   const m=/^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
   if(m){if(!fence)fence=m[1];else if(m[1][0]===fence[0]&&m[1].length>=fence.length&&!m[2].trim())fence='';return line;}
   if(fence)return line;
   return line.split(/(\x60+[^\x60]*\x60+)/g).map((x,i)=>i%2?x:chunk(x)).join('');
  }).join('\n');
 }
 return {text,attachments,citations,audit};
}
window.NormRich={normalize,sources};
})();

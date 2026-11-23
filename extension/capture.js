/* Norm Local Capture (original implementation; no third-party requests).
 * This code deliberately does not inherit the proprietary exporter bundles.
 * Network requests are limited to same-origin ChatGPT endpoints.
 */
(function () {
  'use strict';
  const uuidPath = /(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i;
  const allowedOrigins = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
  const MAX_PAGES = 1200;
  const ROLES = new Set(['user', 'assistant']);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const safeString = value => typeof value === 'string' ? value : '';
  const update = (progress, message) => { if (typeof progress === 'function') progress(message); };
  function abortIf(signal) {
    if (signal?.aborted) throw new DOMException('Capture cancelled', 'AbortError');
  }
  async function getJson(path, token, signal) {
    if (!allowedOrigins.has(location.origin)) throw new Error('Unexpected origin');
    if (!path.startsWith('/backend-api/') && path !== '/api/auth/session') {
      throw new Error('Blocked URL outside the first-party capture allowlist');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once:true});
    try {
      const headers = token ? {'Authorization': 'Bearer ' + token} : {};
      const response = await fetch(path, {headers, credentials:'same-origin', signal:controller.signal,
        redirect:'error', cache:'no-store'});
      if (!response.ok) throw new Error(path.split('?')[0] + ' HTTP ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  // ChatGPT reasoning summaries live in content.thoughts[], not content.parts[].
  function thoughtsToText(thoughts){
    if(!Array.isArray(thoughts))return '';
    return thoughts.map(thought=>{
      if(typeof thought==='string')return thought.trim();
      if(!thought||typeof thought!=='object')return '';
      const title=safeString(thought.summary)||safeString(thought.title)||safeString(thought.reasoning_title);
      const body=safeString(thought.content)||
        (Array.isArray(thought.chunks)?thought.chunks.filter(x=>typeof x==='string').join('\n'): '');
      const lines=[];
      if(title)lines.push('> **'+title.replace(/\n/g,' ').trim()+'**');
      if(body.trim()){
        if(title)lines.push('>');
        lines.push(...body.trim().split('\n').map(x=>x.trim()?'> '+x:'>'));
      }
      return lines.join('\n');
    }).filter(Boolean).join('\n\n');
  }
  function captureAudit(messages){
    const types={},emptyByType={},internalByType={};let summaries=0,missingText=0;
    for(const m of messages){
      const type=m.contentType||'unknown';types[type]=(types[type]||0)+1;
      if(m.internal)internalByType[type]=(internalByType[type]||0)+1;
      if(type==='thoughts'&&m.text?.trim())summaries++;
      if(!m.text?.trim()&&!(m.attachments||[]).length){
        emptyByType[type]=(emptyByType[type]||0)+1;
        if(m.suspectedLoss)missingText++;
      }
    }
    return {types,emptyByType,internalByType,recoveredThinkingRecords:summaries,
      citationMetadataEntries:messages.reduce((n,m)=>n+(m.citations||[]).length,0),
      potentiallyUnparsedRecords:missingText};
  }
  function extractCitationReferences(metadata){
    const refs=Array.isArray(metadata?.content_references)?metadata.content_references:[];
    return refs.filter(r=>r&&typeof r==='object').map(r=>({
      type:safeString(r.type),matchedText:safeString(r.matched_text),items:(Array.isArray(r.items)?r.items:[]).map(i=>({url:safeString(i?.url),title:safeString(i?.title||i?.attribution)})),
      alt:safeString(r.alt),title:safeString(r.title),url:safeString(r.url)
    })).filter(r=>r.matchedText||r.alt||r.url);
  }
  function toMessage(raw, index, nodeId) {
    const m = raw?.message || raw || {};
    if(!ROLES.has(m.author?.role))return null;
    const body=m.content||{},metadata=m.metadata||{};
    const parts=Array.isArray(body.parts)?body.parts:[];
    const attachments=[];
    for(const a of Array.isArray(metadata.attachments)?metadata.attachments:[]){
      if(!a||typeof a!=='object')continue;
      attachments.push({name:a.name||a.file_name||'Attachment',
        mime:a.mime_type||'',kind:'file',id:a.id||a.file_id||''});
    }
    const textParts=[];
    for(const part of parts){
      if(typeof part==='string'){textParts.push(part);continue;}
      if(!part||typeof part!=='object')continue;
      if(part.content_type==='image_asset_pointer'){
        const id=safeString(part.asset_pointer);
        attachments.push({name:'Image',kind:'image',mime:'image/*',id});
        textParts.push('[Image: '+(id||'embedded image')+']');
      }else if(typeof part.text==='string')textParts.push(part.text);
      else if(typeof part.content==='string')textParts.push(part.content);
      else if(part.content_type)textParts.push('[Content: '+part.content_type+']');
    }
    const thinking=thoughtsToText(body.thoughts);
    let text=(body.content_type==='thoughts'&&thinking)||textParts.join('\n\n')||
      safeString(body.text)||safeString(body.content)||safeString(body.result)||
      safeString(body.summary)||safeString(metadata.model_dil_v2?.fallbackMarkdown);
    if(!text&&body.content_type==='reasoning_recap'&&Number.isFinite(metadata.finished_duration_sec)){
      text='Thought for '+metadata.finished_duration_sec+' seconds';
    }
    const contentType=body.content_type||'text';
    const recipient=safeString(m.recipient)||'all';
    const mayHaveText=contentType==='thoughts'&&Array.isArray(body.thoughts)&&body.thoughts.length>0;
    const rawText=text;
    const rich=m.author.role==="assistant"&&recipient==="all"&&!metadata.is_visually_hidden_from_conversation&&contentType==="text"&&window.NormRich?window.NormRich.normalize(metadata,text,index):null;
    if(rich){text=rich.text;attachments.push(...rich.attachments);}
    return {id:m.id||nodeId||'index-'+index,nodeId:nodeId||m.id||'',role:m.author.role,
      model:metadata.model_slug||metadata.resolved_model_slug||'',
      timestamp:m.create_time??null,text,attachments,citations:[...extractCitationReferences(metadata),...(rich?.citations||[])],...(rich?{richAudit:rich.audit,originalText:rawText}:{}),contentType,position:index,
      recipient,channel:safeString(m.channel),internal:recipient!=='all',
      visuallyHidden:!!metadata.is_visually_hidden_from_conversation,
      suspectedLoss:!!(mayHaveText&&!text),
      unresolvedContentKeys:(!text&&contentType!=='text')?Object.keys(body).slice(0,12):[]};
  }
  async function getToken(signal) {
    try { return safeString((await getJson('/api/auth/session', null, signal))?.accessToken); }
    catch (_) {return '';}
  }
  function legacyGraph(data) {
    if (!data || !data.mapping || !data.current_node) throw new Error('Missing conversation mapping or current node');
    const mapping = data.mapping;
    let id = data.current_node;
    const seen = new Set();
    const path = [];
    while (id !== null && id !== undefined) {
      if (seen.has(id)) throw new Error('Conversation branch contains a cycle');
      if (!Object.prototype.hasOwnProperty.call(mapping, id)) {
        throw new Error('Conversation branch has missing parent ' + id);
      }
      if (path.length >= 100000) throw new Error('Conversation graph safety limit');
      seen.add(id);
      const node = mapping[id];
      path.push(node);
      id = node.parent;
    }
    path.reverse();
    const messages = path.map((node, i) => toMessage(node, i, node.id)).filter(Boolean);
    if (!messages.length) throw new Error('No user or assistant messages in conversation graph');
    const unique = new Set(messages.map(m=>m.id));
    if (unique.size !== messages.length) throw new Error('Conversation contains duplicate message IDs');
    const audit=captureAudit(messages);
    return {messages,contentAudit:audit, title:data.title || document.title,
      source:'chatgpt-api-graph', complete:true, coverage:'API parent chain reached root',
      totalNodes:path.length, warnings:audit.potentiallyUnparsedRecords?
        [audit.potentiallyUnparsedRecords+' structured records could not be decoded']:[]};
  }
  async function paginated(id, token, progress, signal) {
    const chunks = [];
    const seenCursors = new Set();
    let cursor = '';
    let complete = false;
    let expected = null;
    for (let n=0; n<MAX_PAGES; n++) {
      abortIf(signal);
      const path='/backend-api/conversations/'+encodeURIComponent(id)+
        '?include_has_versions=true&num_turns=100'+(cursor ? '&before='+encodeURIComponent(cursor) : '');
      const page=await getJson(path,token,signal);
      if (!Array.isArray(page.messages) || !page.page_info ||
          typeof page.page_info.has_previous_page !== 'boolean') {
        throw new Error('No reliable pagination metadata in ChatGPT response');
      }
      chunks.unshift(page.messages);
      const total = page.total_count ?? page.total_turns;
      if (Number.isSafeInteger(total) && total >= 0) expected = total;
      update(progress, 'API history: '+(n+1)+' page(s), '+chunks.reduce((x,a)=>x+a.length,0)+' records');
      if (!page.page_info.has_previous_page) {complete = true;break;}
      const next = page.page_info.start_cursor;
      if (typeof next !== 'string' || !next || seenCursors.has(next)) {
        throw new Error('Pagination stalled before reaching beginning of history');
      }
      seenCursors.add(next);cursor=next;
    }
    if (!complete) throw new Error('Pagination reached safety limit before oldest messages');
    const dedupe = new Set();
    const messages = [];
    let rawSeen=0;
    for (const pageMessages of chunks) for (const raw of pageMessages) {
      rawSeen++;
      const m = toMessage(raw, rawSeen, raw?.id);
      if (!m) continue;
      if (dedupe.has(m.id)) continue;
      dedupe.add(m.id);m.position=messages.length;messages.push(m);
    }
    if (!messages.length) throw new Error('Pagination produced zero user or assistant messages');
    // A provider's total count can include tool/system messages. Do not assume
    // it matches the filtered user/assistant count; retain it for audit only.
    const audit=captureAudit(messages);
    return {messages,contentAudit:audit,title:document.title,source:'chatgpt-api-paginated',complete:true,
      coverage:'Pagination reported no earlier page', pages:chunks.length,
      totalNodes:rawSeen, serverTotal:expected, warnings:audit.potentiallyUnparsedRecords?
        [audit.potentiallyUnparsedRecords+' structured records could not be decoded']:[]};
  }
  function numbered(el) {
    const m=(el.getAttribute('data-testid')||'').match(/^conversation-turn-(\d+)$/);
    return m ? Number(m[1]) : null;
  }
  function turnNodes(root=document) {
    return Array.from(root.querySelectorAll('[data-testid^="conversation-turn-"]'));
  }
  function snapshotTurn(el) {
    const copy = el.cloneNode(true);
    const origCanvas = el.querySelectorAll('canvas');
    const dstCanvas = copy.querySelectorAll('canvas');
    origCanvas.forEach((canvas,i)=>{
      try {const img=document.createElement('img');img.src=canvas.toDataURL('image/png');
        img.alt='Canvas capture';dstCanvas[i]?.replaceWith(img);}catch(_){/* record omitted below */}
    });
    const origImg = el.querySelectorAll('img');
    const cloneImgs = copy.querySelectorAll('img');
    origImg.forEach((img,i)=>{
      const dest=cloneImgs[i];
      if (!dest || !img.complete || img.naturalWidth<1) return;
      try { const canvas=document.createElement('canvas');
        canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        canvas.getContext('2d').drawImage(img,0,0);
        dest.setAttribute('src',canvas.toDataURL('image/png')); }
      catch(_) { dest.removeAttribute('src'); dest.alt=(img.alt||'Image')+' (not embedded)'; }
    });
    return copy.outerHTML;
  }
  function navigatorDots() {
    for(const el of document.querySelectorAll('button[data-toc-active]')) {
      const parent=el.parentElement;
      if(!parent)continue;
      const buttons=Array.from(parent.children);
      if(buttons.length >= 3 && buttons.every(x=>x.tagName==='BUTTON')) return buttons;
    }
    return [];
  }
  function findScroll() {
    const node=turnNodes()[0];
    let el=node?.parentElement;
    while (el && el!==document.body) {
      const style=getComputedStyle(el);
      if (['auto','scroll'].includes(style.overflowY) && el.scrollHeight>el.clientHeight+100) return el;
      el=el.parentElement;
    }
    return null;
  }
  function extractDOM(cache, originTotal) {
    const nums=Array.from(cache.keys()).sort((a,b)=>a-b);
    const errors=[];
    if (!nums.length) errors.push('No numbered turns found');
    if (nums.length && nums[0]!==1) errors.push('Earliest numbered turn is '+nums[0]+', not 1');
    for(let i=0;i<nums.length;i++) if(nums[i]!==i+1) {errors.push('Turn '+(i+1)+' not captured');break;}
    const max=nums[nums.length-1]||0;
    if(max<originTotal)errors.push('Highest captured turn '+max+' below observed '+originTotal);
    const messages=nums.map((n,i)=>({id:'dom-'+n,position:i,role:'unknown',
      model:'',timestamp:null,text:'',html:cache.get(n),attachments:[],contentType:'dom'}));
    return {source:'dom-virtualized',title:document.title,messages,
      complete:!errors.length,coverage:'Contiguous visible DOM turn IDs only (not server-verified)',
      warnings:errors.length?errors:['DOM-only count cannot independently prove the server history length'],
      observedHighest:originTotal};
  }
  async function harvestDOM(progress,signal) {
    const cache=new Map();let highest=0;
    function capture(){for(const el of turnNodes()){
      const n=numbered(el);if(!n||n<1||n>100000)continue;
      highest=Math.max(highest,n);
      if(!el.innerHTML.trim())continue;
      const html=snapshotTurn(el);
      if(!cache.has(n)||html.length>cache.get(n).length)cache.set(n,html);
    }}
    function missing(){const gaps=[];for(let n=1;n<=highest;n++)if(!cache.has(n))gaps.push(n);return gaps;}
    capture();
    let lastCount=cache.size;
    const dots=navigatorDots();
    const scroller=findScroll();
    const previousScroll=scroller?.scrollTop??0;
    update(progress,'DOM fallback: '+cache.size+'/'+highest+' captured');
    for(let pass=0;pass<2 && missing().length && dots.length;pass++){
      for(let i=dots.length-1;i>=0;i--){
        abortIf(signal);dots[i].click();
        for(let wait=0;wait<12;wait++){
          await pause(250);abortIf(signal);capture();
          if(cache.size>lastCount){lastCount=cache.size;break;}
        }
        update(progress,'DOM navigator: '+cache.size+'/'+highest+' captured');
        if(!missing().length)break;
      }
    }
    if(missing().length && scroller){
      scroller.scrollTop=0;await pause(400);capture();
      let idle=0;
      for(let i=0;i<650;i++) {
        abortIf(signal);
        if(!missing().length)break;
        const prior=cache.size;
        scroller.scrollTop=Math.min(scroller.scrollTop+Math.max(250,scroller.clientHeight*.65),
          scroller.scrollHeight-scroller.clientHeight);
        await pause(220);capture();
        if(cache.size===prior){idle++;if(idle>=18)break;}else{idle=0;}
        if(i%10===0)update(progress,'DOM scrolling: '+cache.size+'/'+highest+' captured');
      }
    }
    if(scroller){for(let j=0;j<6;j++){
      scroller.scrollTop=previousScroll;await pause(100);
      if(Math.abs(scroller.scrollTop-previousScroll)<2)break;
    }}
    capture();
    return extractDOM(cache,highest);
  }
  // Download image assets into volatile browser memory only. The endpoint is
  // ChatGPT's own temporary-URL resolver, NOT a third-party PDF service.
  // The Chrome background fetch is restricted to OpenAI asset hosts.
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_BYTES = 120 * 1024 * 1024;
  function imageId(ref) {
    const id=safeString(ref).replace(/^sediment:\/\//i,'').split(/[?#]/)[0];
    return /^(?:file[_-][A-Za-z0-9_-]{6,150}|rich_\d+_\d+)$/.test(id) ? id : '';
  }
  function isImage(a) {
    return !!a && (a.kind === 'image' || safeString(a.mime).toLowerCase().startsWith('image/'));
  }
  function validateAssetUrl(raw,allowPublic=false) {
    if(typeof raw !== 'string') throw new Error('Missing image URL');
    const url=new URL(raw,location.origin);
    if(url.protocol !== 'https:') throw new Error('Image URL must use HTTPS');
    const host=url.hostname.toLowerCase();
    if(url.username||url.password||url.port)throw new Error('Unsupported image URL credentials or port');
    if(allowPublic&&["m.media-amazon.com","images-na.ssl-images-amazon.com","images-eu.ssl-images-amazon.com","images-fe.ssl-images-amazon.com"].includes(host)&&url.pathname.startsWith('/images/')&&!url.search)return url;
    if (!['chatgpt.com','chat.openai.com','images.openai.com'].includes(host) &&
        !host.endsWith('.oaiusercontent.com') && host !== 'oaiusercontent.com') {
      throw new Error('Image host not permitted: '+host);
    }
    return url;
  }
  function sniffImageMime(b){
    if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
    if(b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'image/png';
    if(b.length>=12&&String.fromCharCode(...b.subarray(0,4))==='RIFF'&&
      String.fromCharCode(...b.subarray(8,12))==='WEBP')return 'image/webp';
    if(b.length>=6&&['GIF87a','GIF89a'].includes(String.fromCharCode(...b.subarray(0,6))))return 'image/gif';
    return '';
  }
  async function imageDataFromResponse(resp,signal) {
    abortIf(signal);
    if(!resp.ok)throw new Error('Image HTTP '+resp.status);
    const size=Number(resp.headers.get('content-length')||0);
    if(size>MAX_IMAGE_BYTES)throw new Error('Image exceeds 15 MiB limit');
    const buf=await resp.arrayBuffer();
    if(buf.byteLength>MAX_IMAGE_BYTES)throw new Error('Image exceeds 15 MiB limit');
    const bytes=new Uint8Array(buf);
    const contentType=sniffImageMime(bytes);
    if(!contentType)throw new Error('Unsupported or invalid image bytes');
    let binary='';
    for(let start=0;start<bytes.length;start+=16384){
      binary+=String.fromCharCode(...bytes.subarray(start,start+16384));
    }
    return {mime:contentType,bytes:bytes.length,dataUrl:'data:'+contentType+';base64,'+btoa(binary)};
  }
  async function fetchImageData(assetUrl,signal,token) {
    abortIf(signal);
    if(assetUrl.origin===location.origin){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),45000);
      const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      try {
        return await imageDataFromResponse(await fetch(assetUrl.href,{
          headers:assetUrl.pathname==='/backend-api/estuary/content'&&token?{Authorization:'Bearer '+token}:{},credentials:'same-origin',redirect:'error',signal:controller.signal,cache:'no-store'}),signal);
      } finally {clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
    }
    if(typeof chrome==='undefined'||!chrome.runtime?.sendMessage) {
      throw new Error('Extension background fetch is unavailable');
    }
    return await new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage({type:'norm-fetch-openai-image',url:assetUrl.href},response=>{
        if(signal?.aborted)return reject(new DOMException('Capture cancelled','AbortError'));
        const lastError=chrome.runtime.lastError;
        if(lastError)return reject(new Error('Local image transfer: '+lastError.message));
        if(!response?.ok)return reject(new Error(response?.error||'No image response from local extension worker'));
        resolve({mime:response.mime,bytes:response.bytes,dataUrl:response.dataUrl});
      });
    });
  }
  // Map already-rendered assistant images only within their own message.
  // A positional fallback is valid only when the number of substantive images
  // agrees exactly and no known URL contradicts that order.
  function renderedImageMap(messages){
    const found=new Map();
    if(typeof document==='undefined'||!document.querySelectorAll)return found;
    const nodes=[...document.querySelectorAll('[data-message-id], [data-turn-id]')];
    for(const m of messages||[]){
      if(m.role!=='assistant'||m.internal||m.visuallyHidden)continue;
      const rich=(m.attachments||[]).filter(a=>String(a.id).startsWith('rich_'));
      if(!rich.length)continue;
      let roots=nodes.filter(n=>n.getAttribute('data-message-id')===m.id);
      if(!roots.length)roots=nodes.filter(n=>n.getAttribute('data-turn-id')===(m.nodeId||m.id));
      if(!roots.length){for(const a of rich)found.set(a.id,{reason:'Assistant message not mounted in browser'});continue;}
      const imgs=[...new Set(roots.flatMap(n=>[...n.querySelectorAll('img')]))].filter(i=>{
        const src=i.currentSrc||i.src||'';
        return i.complete&&Math.max(i.naturalWidth,i.naturalHeight)>=96&&Math.min(i.naturalWidth,i.naturalHeight)>=24&&/^(https:|blob:|data:image\/)/i.test(src)&&
          !i.closest?.('[aria-hidden="true"],button[aria-label*="profile" i]');
      });
      const assigned=new Set();
      for(const a of rich){
        const matches=imgs.filter(i=>(a.candidates||[]).includes(i.currentSrc||i.src));
        if(matches.length===1&&!assigned.has(matches[0])){found.set(a.id,{img:matches[0],method:'exact URL'});assigned.add(matches[0]);}
      }
      const consistent=rich.every((a,k)=>!found.get(a.id)?.img||found.get(a.id).img===imgs[k]);
      if(imgs.length===rich.length&&consistent){
        for(let k=0;k<rich.length;k++)if(!found.get(rich[k].id)?.img){
          found.set(rich[k].id,{img:imgs[k],method:'message image order'});
        }
      }
      for(const a of rich)if(!found.get(a.id)?.img)found.set(a.id,{reason:'Message has '+imgs.length+' loaded substantive images for '+rich.length+' components; association ambiguous'});
    }
    return found;
  }
  async function copyRenderedImage(img,signal,token){
    abortIf(signal);
    const src=img.currentSrc||img.src||'';let downloadError='';
    // Download observed first-party or supported public image URLs without credentials.
    if(/^(blob:|data:image\/)/i.test(src)){
      try{return await imageDataFromResponse(await fetch(src,{signal}),signal);}catch(e){if(signal?.aborted)throw e;}
    }else{
      try{return await fetchImageData(validateAssetUrl(src,true),signal,token);}catch(e){if(signal?.aborted)throw e;downloadError=String(e?.message||e);}
    }
    if(img.naturalWidth*img.naturalHeight>16000000)throw Error('Rendered image too large');
    try{
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
      canvas.getContext('2d').drawImage(img,0,0);
      const dataUrl=canvas.toDataURL('image/png'),bytes=atob(dataUrl.split(',')[1]).length;
      return {mime:'image/png',bytes,dataUrl};
    }catch{throw Error('Rendered image bytes inaccessible'+(downloadError?' — '+downloadError:''));}
  }
  async function resolveImages(result,{onProgress,signal}={}) {
    abortIf(signal);
    const expected=new Map();
    for(const m of result.messages||[]) for(const a of m.attachments||[]){
      if(!isImage(a))continue;
      const id=imageId(a.id);
      if(id&&!expected.has(id))expected.set(id,a);
    }
    const domImages=renderedImageMap(result.messages);
    const ids=[...expected.keys()];
    const coverage={expected:ids.length,embedded:0,failed:0,bytes:0,
      failures:[],method:'chatgpt-first-party-image-urls',complete:false,
      uploaded:{expected:ids.filter(id=>!id.startsWith('rich_')).length,embedded:0,failed:0},
      assistant:{expected:ids.filter(id=>id.startsWith('rich_')).length,embedded:0,failed:0,fromDOM:0}};
    result.imageAssets={};
    result.imageCoverage=coverage;
    if(!ids.length){coverage.complete=true;return result;}
    if(!result.source.startsWith('chatgpt-api')){
      coverage.failed=ids.length;
      coverage.failures.push('API image references unavailable in DOM fallback');
      return result;
    }
    const match=location.pathname.match(uuidPath);
    if(!match){coverage.failed=ids.length;coverage.failures.push('No conversation ID');return result;}
    const conversationId=match[1];
    const token=await getToken(signal);
    let next=0,used=0;
    async function worker(){
      while(next<ids.length){
        abortIf(signal);
        const id=ids[next++],category=id.startsWith("rich_")?coverage.assistant:coverage.uploaded;let stage="rich image download";
        try {
          const attachment=expected.get(id);let asset;
          if(id.startsWith('rich_')){
            let reason='No resolved image URL';
            // First-party storage and supported public image CDNs only; no external credentials.
            for(const candidate of attachment.candidates||[]){
              try{const url=validateAssetUrl(candidate,true);asset=await fetchImageData(url,signal,token);break;}
              catch(e){if(signal?.aborted)throw e;reason=String(e?.message||e);}
            }
            if(!asset){
              const match=domImages.get(id);
              if(match?.img){stage='rendered image download';try{asset=await copyRenderedImage(match.img,signal,token);asset.fromDOM=true;}catch(e){if(signal?.aborted)throw e;reason=String(e?.message||e);}}
              else if(match?.reason)reason=match.reason;
            }
            if(!asset)throw Error(reason);
          }else{
            stage='resolve URL';const info=await getJson('/backend-api/files/download/'+encodeURIComponent(id)+'?conversation_id='+encodeURIComponent(conversationId),token,signal);
            stage='validate URL';const url=validateAssetUrl(info?.download_url||info?.url);
            stage='download image';asset=await fetchImageData(url,signal,token);
          }
          stage='validate image';
          if(!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(asset.dataUrl) ||
             !Number.isSafeInteger(asset.bytes) || asset.bytes<=0 || asset.bytes>MAX_IMAGE_BYTES){
            throw new Error('Invalid embedded image response');
          }
          if(used+asset.bytes>MAX_TOTAL_IMAGE_BYTES)throw new Error('Total image budget 120 MiB reached');
          used+=asset.bytes;
          result.imageAssets[id]=asset;
          coverage.embedded++;category.embedded++;if(asset.fromDOM&&category===coverage.assistant)category.fromDOM++;coverage.bytes=used;
        }catch(e){
          if(signal?.aborted)throw e;
          coverage.failed++;category.failed++;
          coverage.failures.push({id,stage,reason:String(e?.message||e).replace(/https?:\/\/[^\s]+/gi,"[URL omitted]").slice(0,170)});
        }
        update(onProgress,'Embedding ChatGPT images locally: '+
          (coverage.embedded+coverage.failed)+'/'+ids.length+
          ' ('+coverage.embedded+' embedded, '+coverage.failed+' failed)');
      }
    }
    // Concurrency bounded to avoid generating dozens of outstanding signed URLs.
    await Promise.all(Array.from({length:Math.min(3,ids.length)},()=>worker()));
    coverage.complete=coverage.failed===0 && coverage.embedded===coverage.expected;
    if(!coverage.complete){
      result.warnings=result.warnings||[];
      result.warnings.push(coverage.failed+' of '+coverage.expected+' images could not be embedded. PDF/HTML visual fidelity is incomplete.');
    }
    return result;
  }
  // Retry only failed image references, retaining successfully downloaded assets.
  async function retryFailedImages(result,{onProgress,signal}={}) {
    abortIf(signal);
    if(!result?.source?.startsWith('chatgpt-api')||!result.imageCoverage)
      throw new Error('Retry requires an API-confirmed image capture');
    const previous=result.imageCoverage;
    const retryIds=new Set((previous.failures||[]).map(f=>imageId(f?.id)).filter(Boolean));
    if(!retryIds.size)return result;
    const partial={...result,messages:(result.messages||[]).map(m=>({...m,
      attachments:(m.attachments||[]).filter(a=>retryIds.has(imageId(a.id)))
    })).filter(m=>m.attachments.length),imageAssets:{},warnings:[]};
    const attempted=await resolveImages(partial,{onProgress,signal});
    let used=Number(previous.bytes)||0;
    let newSuccess=0,uploadedSuccess=0,assistantSuccess=0,domSuccess=0;
    const overflow=[];
    result.imageAssets=result.imageAssets||{};
    for(const [id,asset] of Object.entries(attempted.imageAssets||{})){
      if(result.imageAssets[id])continue;
      if(used+asset.bytes>MAX_TOTAL_IMAGE_BYTES){
        overflow.push({id,stage:'validate image',reason:'Total image budget 120 MiB reached'});
        continue;
      }
      used+=asset.bytes;result.imageAssets[id]=asset;newSuccess++;
      if(id.startsWith('rich_')){assistantSuccess++;if(asset.fromDOM)domSuccess++;}
      else uploadedSuccess++;
    }
    previous.bytes=used;
    previous.embedded+=newSuccess;
    previous.failed=Math.max(0,previous.expected-previous.embedded);
    if(previous.uploaded){previous.uploaded.embedded+=uploadedSuccess;previous.uploaded.failed=Math.max(0,previous.uploaded.expected-previous.uploaded.embedded);}
    if(previous.assistant){previous.assistant.embedded+=assistantSuccess;previous.assistant.failed=Math.max(0,previous.assistant.expected-previous.assistant.embedded);previous.assistant.fromDOM=(previous.assistant.fromDOM||0)+domSuccess;}
    const remaining=[...(attempted.imageCoverage?.failures||[]),...overflow];
    const replaced=(previous.failures||[]).filter(f=>!retryIds.has(imageId(f?.id)));
    previous.failures=[...replaced,...remaining.filter(f=>!result.imageAssets[f.id])];
    previous.complete=previous.failed===0&&previous.embedded===previous.expected;
    result.warnings=(result.warnings||[]).filter(w=>!/^\d+ of \d+ images could not be embedded\./.test(String(w)));
    if(!previous.complete)result.warnings.push(previous.failed+' of '+previous.expected+' images could not be embedded. PDF/HTML visual fidelity is incomplete.');
    return result;
  }
  async function extract({onProgress,signal,allowDOM=true}={}) {
    if(!allowedOrigins.has(location.origin))throw new Error('Must run on ChatGPT');
    const errs=[];const match=location.pathname.match(uuidPath);
    if(match){
      const id=match[1];update(onProgress,'Reading first-party session (not stored)...');
      const token=await getToken(signal);
      abortIf(signal);
      try {
        update(onProgress,'Retrieving complete selected conversation branch...');
        const result=legacyGraph(await getJson('/backend-api/conversation/'+encodeURIComponent(id),token,signal));
        result.url=location.href;return result;
      } catch(e){if(signal?.aborted)throw e;errs.push('Graph: '+e.message);}
      try {
        update(onProgress,'Trying paginated ChatGPT history...');
        const result=await paginated(id,token,onProgress,signal);
        result.url=location.href;result.warnings.push('Graph unavailable; paginated endpoint used');return result;
      }catch(e){if(signal?.aborted)throw e;errs.push('Pages: '+e.message);}
    } else errs.push('No conversation ID in URL; e.g. a shared or new chat page');
    if(!allowDOM)throw new Error('First-party API extraction failed: '+errs.join('; '));
    update(onProgress,'First-party APIs unavailable; harvesting rendered conversation...');
    const result=await harvestDOM(onProgress,signal);
    result.warnings.push(...errs);
    result.url=location.href;
    // Even a DOM with contiguous turns lacks server evidence. The UI distinguishes
    // this from an API-confirmed full branch and asks for explicit user acceptance.
    return result;
  }
  window.NormLocalCapture={extract,legacyGraph,extractDOM,paginated,toMessage,resolveImages,retryFailedImages,imageId};
})();

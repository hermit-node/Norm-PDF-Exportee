/* All serialization is performed inside the browser; no external scripts or renderers. */
(function(){
  'use strict';
  const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeText = s=>String(s??'').replace(/\r\n/g,'\n');
  function inline(text){
    // Wholly escaped input; formatting replacements cannot inject HTML.
    const codeSpans=[];let x=escapeHTML(text);
    x=x.replace(/cite([^]+)/g,(_,ids)=>{
      const refs=ids.split('').filter(Boolean);
      const original=refs.map(id=>escapeHTML(id)).join(', ');
      return '<span class="citation-unresolved" title="'+original+'">[source ref'+(refs.length===1?'':'s')+': '+refs.length+']</span>';
    });
    x=x.replace(/`([^`\n]+)`/g,(_,body)=>{const id=codeSpans.push('<code>'+body+'</code>')-1;return '\uE000'+id+'\uE001';});
    x=x.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
    x=x.replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
    x=x.replace(citationLink,(_,label,url)=>validSourceUrl(url)?'<a href="'+url+'" rel="noopener noreferrer">'+label+'</a>':label);
    x=x.replace(/\uE000(\d+)\uE001/g,(_,id)=>codeSpans[Number(id)]||'');
    return x;
  }
  // Citation substitution is a rendering step: normalized JSON retains the exact source tokens.
  // ChatGPT supplies each literal glyph and its human-readable URL alternative in content_references.
  const citationMarker=/\uE200cite\uE202[^\uE201]*\uE201/g;
  const citationLink=/\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^()\s]*\))+)\)/g;
  const validSourceUrl=s=>/^https?:\/\/[^\s<>"'\u0000-\u001f]+$/i.test(s||'');
  function refLinks(ref){
    const links=[];
    const alt=String(ref.alt||'');
    for(const match of alt.matchAll(citationLink)){
      if(validSourceUrl(match[2]))links.push({title:match[1].replace(/\s+/g,' ').slice(0,180),url:match[2]});
    }
    if(!links.length && validSourceUrl(ref.url))
      links.push({title:String(ref.title||ref.url).slice(0,180),url:ref.url});
    for(const i of ref.items||[]){if(validSourceUrl(i.url)&&!links.some(x=>x.url===i.url))links.push({title:String(i.title||i.url).slice(0,180),url:i.url});}
    return links;
  }
  function citationReplacement(ref){
    const alt=String(ref.alt||'');
    if([...alt.matchAll(citationLink)].some(link=>validSourceUrl(link[2])))return alt;
    if(validSourceUrl(ref.url)){
      const title=String(ref.title||ref.url).replace(/[\[\]\n]/g,' ').trim();
      return '['+title+']('+ref.url+')';
    }
    return refLinks(ref).map(i=>'['+i.title.replace(/[\[\]\n]/g,' ')+']('+i.url+')').join(', ');
  }
  function resolvedCitationText(m){
    let text=safeText(m?.text);
    for(const ref of m?.citations||[]){
      const matched=String(ref.matchedText||ref.matched_text||'');
      // Some source footnotes claim to match a plain space. Never replace those.
      if(!matched.includes('\uE200')||!matched.includes('\uE201')||!text.includes(matched))continue;
      const replacement=citationReplacement(ref);
      if(replacement)text=text.split(matched).join(replacement);
    }
    return text;
  }
  function turnSources(messages){
    const all=[],seen=new Set();
    for(const m of messages){
      const text=String(m.text||'');
      for(const ref of m.citations||[]){
        const matched=String(ref.matchedText||'');
        if(!(matched.includes('\uE200')&&text.includes(matched))&&ref.type!=='sources_footnote')continue;
        for(const item of refLinks(ref)){
          if(!seen.has(item.url)){seen.add(item.url);all.push(item);}
        }
      }
    }
    return all;
  }
  function sourcesHTML(messages){
    const links=turnSources(messages);
    return links.length?'<section class="turn-sources"><strong>Sources</strong><ul>'+
      links.map(x=>'<li><a href="'+escapeHTML(x.url)+'" rel="noopener noreferrer">'+
        escapeHTML(x.title)+'</a></li>').join('')+'</ul></section>':'';
  }
  function sourcesMarkdown(messages){
    const links=turnSources(messages);
    return links.length?'\n\n**Sources:**\n'+
      links.map(x=>'- ['+x.title.replace(/[\[\]]/g,'')+']('+x.url+')').join('\n'):'';
  }
  function citationAudit(messages){
    let markerCount=0,resolvedCount=0;const urls=new Set();
    for(const m of messages){
      const text=String(m.text||'');
      markerCount+=(text.match(citationMarker)||[]).length;
      for(const ref of m.citations||[]){
        const token=String(ref.matchedText||'');
        if(token.includes('\uE200')&&text.includes(token)&&citationReplacement(ref))
          resolvedCount+=text.split(token).length-1;
      }
      for(const item of turnSources([m]))urls.add(item.url);
    }
    return {citationMarkers:markerCount,linkedMarkers:resolvedCount,
      unresolvedMarkers:Math.max(0,markerCount-resolvedCount),uniqueSourceUrls:urls.size};
  }
  function markdown(text){
    const lines=safeText(text).split('\n');let html=[],code=[],inCode=false,list=null;
    function closeList(){if(list){html.push('</'+list+'>');list=null;}}
    function flushCode(){html.push('<pre><code>'+escapeHTML(code.join('\n'))+'</code></pre>');code=[];}
    for(let i=0;i<lines.length;i++){const line=lines[i];
      if(/^\s*```/.test(line)){closeList();if(inCode)flushCode();inCode=!inCode;continue;}
      if(inCode){code.push(line);continue;}
      const cells=v=>v.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
      if(line.includes('|')&&lines[i+1]?.includes('|')&&cells(line).length===cells(lines[i+1]).length&&
          cells(line).length>1&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
        closeList();const headers=cells(line);i++;
        let table='<table><thead><tr>'+headers.map(h=>'<th>'+inline(h)+'</th>').join('')+'</tr></thead><tbody>';
        while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){
          i++;const row=cells(lines[i]);
          table+='<tr>'+headers.map((_,j)=>'<td>'+inline(row[j]||'')+'</td>').join('')+'</tr>';
        }
        html.push(table+'</tbody></table>');continue;
      }
      if(!line.trim()){closeList();html.push('<div class="gap"></div>');continue;}
      if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){closeList();html.push('<hr>');continue;}
      const check=line.match(/^\s*[-*+] \[([ xX])\] (.*)/);
      if(check){if(list!=='ul'){closeList();html.push('<ul>');list='ul';}
        html.push('<li>'+(check[1].toLowerCase()==='x'?'☑':'☐')+' '+inline(check[2])+'</li>');continue;}
      const heading=line.match(/^(#{1,5})\s+(.*)/);
      if(heading){closeList();const n=heading[1].length;html.push('<h'+n+'>'+inline(heading[2])+'</h'+n+'>');continue;}
      const bullet=line.match(/^\s*([-*+] |\d+\. )(.*)/);
      if(bullet){const next=/^\d/.test(bullet[1])?'ol':'ul';if(list!==next){closeList();html.push('<'+next+'>');list=next;}
        html.push('<li>'+inline(bullet[2])+'</li>');continue;}
      closeList();
      const quote=line.match(/^ {0,3}>[ \t]?(.*)$/);
      if(quote){
        const paragraphs=[];let current=[];
        const flush=()=>{if(current.length){paragraphs.push('<p>'+current.map(inline).join(' ')+'</p>');current=[];}};
        let j=i;
        while(j<lines.length){
          const item=lines[j].match(/^ {0,3}>[ \t]?(.*)$/);
          if(!item)break;
          if(!item[1].trim())flush();else current.push(item[1]);
          j++;
        }
        flush();html.push('<blockquote class="norm-quote">'+paragraphs.join('')+'</blockquote>');
        i=j-1;continue;
      }
      html.push('<p>'+inline(line)+'</p>');
    }
    closeList();if(inCode)flushCode();return html.join('\n');
  }
  function sanitizedHTML(fragment){
    const parsed=new DOMParser().parseFromString('<main>'+fragment+'</main>','text/html');
    const root=parsed.querySelector('main');
    for(const bad of root.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,link,meta,base,video,audio,source'))bad.remove();
    for(const el of root.querySelectorAll('*')){
      for(const attr of [...el.attributes]){
        const key=attr.name.toLowerCase();const val=attr.value;
        if(key.startsWith('on')||key==='style'||key==='srcset'||key==='formaction'||key==='srcdoc')el.removeAttribute(attr.name);
        else if(['href','src','xlink:href'].includes(key)){
          if(key==='src' && el.tagName==='IMG' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(val))continue;
          if(key==='href' && el.tagName==='A' && val.startsWith('https://'))continue;
          el.removeAttribute(attr.name);
        }
      }
    }
    return root.innerHTML;
  }
  function imageId(ref) {
    const id=String(ref||'').replace(/^sediment:\/\//i,'').split(/[?#]/)[0];
    return /^(?:file[_-][A-Za-z0-9_-]{6,150}|rich_\d+_\d+)$/.test(id)?id:'';
  }
  function messageImages(m,data){
    const used=new Set(),images=[];
    for(const a of m.attachments||[]){
      if(a.kind!=='image' && !String(a.mime||'').startsWith('image/'))continue;
      const id=imageId(a.id);
      if(!id||used.has(id))continue;
      used.add(id);
      images.push({id,alt:String(a.name||'ChatGPT image'),asset:data.imageAssets?.[id]||null});
    }
    return images;
  }
  function stripEmbeddedImageTokens(text,images){
    const embedded=new Set(images.filter(a=>a.asset?.dataUrl).map(a=>a.id));
    return String(text||'').replace(/\[Image:\s*(?:sediment:\/\/)?(file_[A-Za-z0-9_-]{6,150})\s*\]/gi,
      (token,id)=>embedded.has(id)?'':token);
  }
  function imageMarkup(images,rich=false){
    if(!images.length)return '';
    return '<div class="norm-image-gallery'+(rich?' norm-rich-gallery':'')+'">'+images.map(({id,alt,asset})=>{
      if(!asset || !/^data:image\/(jpeg|png|webp|gif);base64,/i.test(asset.dataUrl||'')){
        return '<p class="missing-image">Image not embedded: '+escapeHTML(alt)+' ('+escapeHTML(id)+')</p>';
      }
      return '<figure><img src="'+escapeHTML(asset.dataUrl)+'" alt="'+escapeHTML(alt)+
        '" loading="eager"><figcaption>'+escapeHTML(alt)+'</figcaption></figure>';
    }).join('')+'</div>';
  }
  function groupTurns(messages){
    const records=messages||[],turns=[];
    if(!records.some(m=>m.role==='user')) {
      return records.map(m=>({user:null,responses:[m],unclassified:true}));
    }
    for(const m of records){
      if(m.role==='user')turns.push({user:m,responses:[],unclassified:false});
      else {
        if(!turns.length)turns.push({user:null,responses:[],unclassified:true});
        turns[turns.length-1].responses.push(m);
      }
    }
    return turns;
  }
  function timestampLabel(value){
    if(value===null||value===undefined||value==='')return 'Time unavailable';
    const n=(typeof value==='number'||/^\d+(?:\.\d+)?$/.test(String(value)))?Number(value):NaN;
    const d=Number.isFinite(n)?new Date(n<1e11?n*1000:n):new Date(value);
    if(!Number.isFinite(d.getTime()))return 'Time unavailable';
    return d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  }
  function promptTitle(m){
    const first=String(m?.text||'').replace(/\[Image:\s*(?:sediment:\/\/)?file_[^\]\r\n]+\]/gi,'').split('\n').map(s=>s.trim()).find(Boolean)||((m?.attachments||[]).some(a=>a.kind==='image')?'Image attachment':'Untitled prompt');
    const clean=first.replace(/^[#>*\-\s]+/,'').replace(/\s+/g,' ').trim();
    return clean.length>76?clean.slice(0,73)+'…':clean||'Untitled prompt';
  }
  function meaningful(m){
    if(!m || m.internal)return false;
    if(m.visuallyHidden && !['thoughts','reasoning_recap'].includes(m.contentType))return false;
    return !!(String(m.text||'').trim()||m.html||(m.attachments||[]).length);
  }
  function preserveInnerHeadings(fragment){
    // Document outline belongs to the turn, not to nested message markdown headings.
    return fragment.replace(/<h[1-6](?:\s[^>]*)?>/gi,'<p class="content-subheading">')
      .replace(/<\/h[1-6]>/gi,'</p>');
  }
  function contentHTML(m,data){
    const images=messageImages(m,data);
    const clean=stripEmbeddedImageTokens(resolvedCitationText(m),images);
    let html=preserveInnerHeadings(m.html?sanitizedHTML(m.html):(clean.trim()?markdown(clean):''));
    const placed=new Set();
    html=html.replace(/<p>\[Norm images: (rich_\d+_\d+(?:,rich_\d+_\d+)*)\]<\/p>/g,(_,ids)=>{const group=images.filter(i=>ids.split(",").includes(i.id));group.forEach(i=>placed.add(i.id));return imageMarkup(group,true);});
    const files=(m.attachments||[]).filter(a=>a.kind!=='image'&&!String(a.mime||'').toLowerCase().startsWith('image/'));
    const fileHtml=files.map(a=>'<div class="attachment">Attachment: '+escapeHTML(a.name||a.id||'Untitled')+'</div>').join('');
    return html+imageMarkup(images.filter(i=>!placed.has(i.id)))+fileHtml;
  }
  // Markdown code fences must never escape a single captured message.
  // Preserve malformed source content, but add a matching closing fence
  // before the next assistant segment, user prompt, or conversation turn.
  function openCodeFence(source){
    let opened='';
    for(const line of safeText(source).split('\n')){
      const found=/^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
      if(!found)continue;
      const marker=found[1];
      if(!opened){opened=marker;continue;}
      if(marker[0]===opened[0]&&marker.length>=opened.length&&!found[2].trim())opened='';
    }
    return opened;
  }
  function closeMessageFences(source){
    const opened=openCodeFence(source);
    return opened?source+'\n'+opened:source;
  }
  function formatAudit(messages,turns){
    const leakedRoleLabel=/^\s*\*\*(You|ChatGPT)\*\*\s*[·:]/m;
    const suspiciousRecords=messages.flatMap((m,i)=>{
      const badFence=openCodeFence(m.text||'');
      const duplicateRole=leakedRoleLabel.test(m.text||'');
      return badFence||duplicateRole?[{record:i+1,id:m.id||'',codeFence:!!badFence,embeddedRoleLabel:duplicateRole}]:[];
    });
    const longTurns=turns.map((t,i)=>{
      const all=[t.user,...t.responses].filter(Boolean);
      const chars=all.reduce((n,m)=>n+String(m.text||'').replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/g,'').length,0);
      return {turn:i+1,characters:chars};
    }).filter(t=>t.characters>1000);
    return {longTurnThreshold:1000,turnsOverThreshold:longTurns.length,
      maxTurnCharacters:Math.max(0,...longTurns.map(x=>x.characters)),
      suspiciousRecords, longTurns};
  }
  function contentMarkdown(m,data){
    const images=messageImages(m,data);
    const raw=stripEmbeddedImageTokens(resolvedCitationText(m),images);
    let code=false;
    const body=safeText(raw).split('\n').map(line=>{
      if(/^\s*```/.test(line)){code=!code;return line;}
      if(!code&&/^#{1,6}\s+/.test(line))return '**'+line.replace(/^#{1,6}\s+/,'')+'**';
      return line;
    }).join('\n') || (m.html?'[Rendered HTML content — see HTML export]':'');
    const placed=new Set();
    const balancedBody=closeMessageFences(body).replace(/^\[Norm images: (rich_\d+_\d+(?:,rich_\d+_\d+)*)\]$/gm,(_,ids)=>images.filter(i=>ids.split(",").includes(i.id)).map(i=>{placed.add(i.id);return i.asset?.dataUrl?"!["+i.alt.replace(/[\[\]]/g,"")+"]("+i.asset.dataUrl+")":"[Image not embedded: "+i.alt+"]";}).join("\n\n"));
    const imagesMd=images.filter(i=>!placed.has(i.id)).map(({id,alt,asset})=>asset?.dataUrl?'\n!['+String(alt).replace(/[\[\]]/g,'')+']('+asset.dataUrl+')\n':'\n[Image not embedded: '+id+']\n').join('');
    const files=(m.attachments||[]).filter(a=>a.kind!=='image'&&!String(a.mime||'').toLowerCase().startsWith('image/'));
    return balancedBody+imagesMd+files.map(a=>'\nAttachment: '+(a.name||a.id||'')).join('');
  }
  function buildHtml(data){
    const original=data.messages||[];
    const title=escapeHTML(data.title||'ChatGPT conversation');
    const stamp=new Date().toISOString();
    const turns=groupTurns(original);
    const omitted=original.filter(m=>!meaningful(m)).length;
    const sections=turns.map((turn,i)=>{
      const titleText=turn.user?promptTitle(turn.user):'Unclassified conversation record';
      const imageCount=turn.user?messageImages(turn.user,data).length:0;
      const promptWords=String(turn.user?.text||'').replace(/\[Image:[^\]]+\]/g,'').trim();
      const singleImage=imageCount===1&&promptWords.length<350;
      const prompt=turn.user?'<div class="prompt-card"><div class="message-meta"><strong>You</strong><time>'+escapeHTML(timestampLabel(turn.user.timestamp))+'</time></div>'+contentHTML(turn.user,data)+'</div>':'';
      const visible=turn.responses.filter(meaningful);
      const first=visible.find(m=>m.timestamp)||turn.responses.find(m=>m.timestamp);
      const models=[...new Set(turn.responses.map(m=>m.model).filter(Boolean))].join(' · ');
      const segments=visible.map((m,j)=>'<div class="assistant-segment'+(m.contentType==='thoughts'?' reasoning-segment':'')+'">'+
        (j>0&&m.timestamp?'<div class="segment-time">'+escapeHTML(timestampLabel(m.timestamp))+'</div>':'')+
        contentHTML(m,data)+'</div>').join('');
      const answer='<div class="assistant-card"><div class="message-meta"><strong>ChatGPT</strong><span class="model-label">'+escapeHTML(models)+'</span><time>'+escapeHTML(timestampLabel(first?.timestamp))+'</time></div>'+
        (segments||'<p class="missing-response">No assistant response text captured in this export.</p>')+sourcesHTML(visible)+'</div>';
      return '<section class="turn'+(singleImage?' single-image-turn':'')+'" id="turn-'+(i+1)+'"><h2 class="turn-heading">'+(i+1)+'. '+escapeHTML(titleText)+'</h2>'+prompt+answer+'</section>';
    }).join('\n');
    const css=`
      /* Page geometry belongs to the selected PDF template (or browser Print settings). */
      html,body { background:#fff;color:#202124;margin:0; }
      body {font:12px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:18px;max-width:900px;margin:auto;}
      *,*:before,*:after {box-sizing:border-box;} h1,h2,h3,h4 {break-after:avoid;line-height:1.25;}
      header {border-bottom:2px solid #ddd;margin-bottom:20px;padding-bottom:12px;}
      h1 {font-size:22px; margin:0 0 8px;} .meta{color:#555;font-size:10px;}
      .turn{border-bottom:1px solid #e5e7eb;padding:10px 0 14px;margin-bottom:12px;break-inside:auto;}
      .who{font-weight:700;color:#344054;margin:0 0 9px;font-size:11px;break-after:avoid;}
      .turn:has(.who:first-child) {overflow-wrap:anywhere;}
      p{margin:.35em 0 .65em;white-space:pre-wrap;} .gap{height:7px;}
      .files{font-size:10px;color:#555;background:#f4f4f5;border-radius:5px;padding:7px 9px;}
      pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f6f7;padding:10px 12px;
        border:1px solid #ddd;border-radius:6px;font:10.5px/1.45 Consolas,monospace;}
      code{font:10.5px Consolas,monospace;} :not(pre)>code{background:#f3f3f4;padding:1px 3px;}
      img,svg,canvas{max-width:100%!important;height:auto!important;}
      .norm-image-gallery figure{margin:11px 0 15px;padding:7px;border:1px solid #e1e4e8;
        border-radius:7px;break-inside:avoid-page;}
      .norm-image-gallery img{display:block;margin:auto;object-fit:contain;max-height:100mm;}
      .norm-rich-gallery figure{display:inline-block;vertical-align:top;width:47%;margin:4px 1%;padding:4px;}
      .norm-rich-gallery img{max-height:48mm!important;}
      .norm-image-gallery figcaption{margin-top:5px;color:#666;font-size:9px;}
      .missing-image{border:1px dashed #b75d5d;padding:7px;color:#922e2e;}
      ul,ol{padding-left:1.6em;margin:6px 0 8px;}li{margin:4px 0;}
      table{border-collapse:collapse;width:100%;font-size:10px;}td,th{border:1px solid #bbb;padding:4px;}
      blockquote{border-left:3px solid #bbb;margin:8px 0;padding-left:12px;}
      a{color:#234e9f;overflow-wrap:anywhere;}
      .turn{border-bottom:0;margin:0 0 30px;padding:0 0 20px;overflow-wrap:anywhere;}
      .turn-heading{font:700 15px/1.4 system-ui,sans-serif;color:#243044;border-bottom:1px solid #cdd5df;padding:0 0 8px;margin:0 0 13px;break-after:avoid;}
      .prompt-card{background:#f1f4f8;border-left:4px solid #64748b;border-radius:5px;padding:12px 15px;margin:0 0 16px;break-inside:auto;}
      .single-image-turn .prompt-card{break-inside:avoid-page;}
      .assistant-card{padding:4px 6px 4px 16px;border-left:2px solid #d6dce6;}
      .message-meta{display:flex;align-items:baseline;gap:12px;justify-content:space-between;font-size:10px;color:#596779;margin-bottom:12px;}
      .message-meta strong{font-size:11px;color:#1f2937;letter-spacing:.04em;text-transform:uppercase;}
      .message-meta time{font-variant-numeric:tabular-nums;white-space:nowrap;}
      .model-label{margin-right:auto;font-size:9px;}
      .assistant-segment+.assistant-segment{margin-top:10px;}
      .segment-time{font-size:9px;color:#68778c;margin-bottom:4px;}
      .reasoning-segment{background:#f6f8fa;border-left:2px solid #d0d8e2;padding:7px 10px;margin:8px 0 12px;}
      .reasoning-segment blockquote{border:0;margin:0 0 7px;padding-left:0;color:#536271;}
      .reasoning-segment .norm-quote p{margin:0 0 5px;white-space:normal;}
      .norm-image-gallery{max-width:100%;}
      .single-image-turn .norm-image-gallery figure{margin:6px 0 4px;}
      .citation-unresolved{font-size:9px;color:#64748b;letter-spacing:0;}
      .turn-sources{margin:12px 0 5px;padding:7px 10px;border-top:1px solid #dfe3ea;font-size:10px;color:#475569;}
      .turn-sources ul{margin:4px 0;padding-left:17px;}
      .turn-sources li{margin:2px 0;overflow-wrap:anywhere;}
      .content-subheading{font-weight:700;font-size:13px;margin:12px 0 5px;break-after:avoid;}
      .missing-response{color:#8a4141;font-style:italic;}
      .attachment{font-size:10px;color:#536274;background:#f0f2f5;padding:6px;margin:4px 0;}
      @media print {body{max-width:none;padding:0;}a{color:inherit;} .turn-heading,.message-meta{break-after:avoid;}}
    `;
    // Explicitly forbid all networking from the print frame. Inlined image data is allowed.
    const csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; " +
      "script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'";
    const plain=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHTML(csp)}"><title>${title}</title><style>${css}</style></head><body>`+
      `<header><h1>${title}</h1><div class="meta">${turns.length} prompt-led turns · ${original.length} raw records · ${omitted} non-displayed records · ${escapeHTML(data.source)} · `+
      `${escapeHTML(data.coverage)} · ${stamp}</div></header>${sections}</body></html>`;
    return plain;
  }
  function buildMarkdown(data){
    const original=data.messages||[],turns=groupTurns(original);
    const omitted=original.filter(m=>!meaningful(m)).length;
    const header='# '+(data.title||'ChatGPT conversation')+'\n\n'+
      'Source: '+(data.url||'')+'\nCapture method: '+data.source+'\nCoverage: '+data.coverage+'\n'+
      'Conversation turns: '+turns.length+'\nRaw records: '+original.length+'\nNon-displayed records: '+omitted+'\n'+
      'Images embedded: '+(data.imageCoverage?.embedded??'unverified')+' / '+(data.imageCoverage?.expected??'unknown')+'\n\n';
    const sections=turns.map((turn,i)=>{
      const heading='## '+(i+1)+'. '+(turn.user?promptTitle(turn.user):'Unclassified conversation record');
      const prompt=turn.user?'**You** · '+timestampLabel(turn.user.timestamp)+'\n\n'+contentMarkdown(turn.user,data):'';
      const visible=turn.responses.filter(meaningful);
      const first=visible.find(m=>m.timestamp)||turn.responses.find(m=>m.timestamp);
      const models=[...new Set(turn.responses.map(m=>m.model).filter(Boolean))].join(', ');
      const responseHeader='**ChatGPT**'+(models?' · '+models:'')+' · '+timestampLabel(first?.timestamp);
      const responseBody=visible.map((m,j)=>{
        const stamp=j>0&&m.timestamp?'*'+timestampLabel(m.timestamp)+'*\n\n':'';
        return stamp+contentMarkdown(m,data);
      }).join('\n\n')||'*No assistant response text captured in this export.*';
      return '---\n\n'+heading+'\n\n'+prompt+(prompt?'\n\n':'')+responseHeader+'\n\n'+responseBody+sourcesMarkdown(visible);
    });
    return header+sections.join('\n\n');
  }
  function buildManifest(data){return {
    generator:'Norm Hybrid Local Exporter 0.4.11',generatedAt:new Date().toISOString(),
    conversationURL:data.url,title:data.title,source:data.source,coverage:data.coverage,
    apiConfirmedComplete:data.complete&&data.source.startsWith('chatgpt-api'),
    visibleDOMContinuous:data.complete&&data.source==='dom-virtualized',
    messageCount:data.messages.length, groupedTurnCount:groupTurns(data.messages).length, nonDisplayedRecords:data.messages.filter(m=>!meaningful(m)).length, emptyRecords:data.messages.filter(m=>!String(m.text||'').trim()&&!m.html&&!(m.attachments||[]).length).length, contentAudit:data.contentAudit||null, citationAudit:citationAudit(data.messages), formatAudit:formatAudit(data.messages,groupTurns(data.messages)), warnings:data.warnings||[],
    attachmentReferences:data.messages.reduce((n,m)=>n+(m.attachments?.length||0),0),
    imageReferences:data.imageCoverage?.expected??null,
    uploadedImages:data.imageCoverage?.uploaded??null,assistantImages:data.imageCoverage?.assistant??null,
    richComponents:data.messages.reduce((a,m)=>({components:a.components+(m.richAudit?.components||0),resolved:a.resolved+(m.richAudit?.resolved||0),unresolved:a.unresolved+(m.richAudit?.unresolved||0)}),{components:0,resolved:0,unresolved:0}),
    imagesEmbedded:data.imageCoverage?.embedded??null,
    imagesFailed:data.imageCoverage?.failed??null,
    imageBytes:data.imageCoverage?.bytes??null,
    imageFailures:data.imageCoverage?.failures||[],
    visuallyComplete:!!(data.source.startsWith('chatgpt-api') && data.imageCoverage?.complete),
    note:'Historical message coverage and image fidelity are separate. All included image bytes were fetched from ChatGPT/OpenAI and composed locally. Other non-image attachments are references only.'
  };}
  function download(filename,data,type='text/plain'){
    const url=URL.createObjectURL(new Blob([data],{type}));
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  // Original, self-contained ZIP writer. ZIP STORE (no compression), UTF-8 names.
  function buildZip(contents){
    const enc=new TextEncoder();const lookup=new Uint32Array(256);
    for(let n=0;n<256;n++){let x=n;for(let j=0;j<8;j++)x=(x&1)?(0xedb88320^(x>>>1)):(x>>>1);lookup[n]=x>>>0;}
    function crc32(buf){let c=0xffffffff;for(const b of buf)c=lookup[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
    const chunks=[],cent=[];let offset=0;
    for(const [name,value] of Object.entries(contents)){
      const fname=enc.encode(name);
      const bytes= typeof value==='string'?enc.encode(value):
        value instanceof Uint8Array?value:
        value instanceof ArrayBuffer?new Uint8Array(value):null;
      if(!bytes)throw new Error('Invalid ZIP value for '+name);
      const crc=crc32(bytes);
      const header=new ArrayBuffer(30);const d=new DataView(header);
      d.setUint32(0,0x04034b50,true);d.setUint16(4,20,true);d.setUint16(6,0x0800,true);
      d.setUint16(8,0,true);d.setUint32(14,crc,true);d.setUint32(18,bytes.length,true);
      d.setUint32(22,bytes.length,true);d.setUint16(26,fname.length,true);
      chunks.push(header,fname,bytes);
      const central=new ArrayBuffer(46),c=new DataView(central);
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);
      c.setUint16(8,0x0800,true);c.setUint32(16,crc,true);
      c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);
      c.setUint16(28,fname.length,true);c.setUint32(42,offset,true);
      cent.push(central,fname);offset+=30+fname.length+bytes.length;
    }
    const end=new ArrayBuffer(22),d=new DataView(end);
    d.setUint32(0,0x06054b50,true);d.setUint16(8,Object.keys(contents).length,true);
    d.setUint16(10,Object.keys(contents).length,true);
    const centralSize=cent.reduce((n,x)=>n+x.byteLength,0);
    d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);
    return new Blob([...chunks,...cent,end],{type:'application/zip'});
  }
  function makeAssets(data){const h=buildHtml(data),md=buildMarkdown(data),manifest=buildManifest(data);
    return {html:h,markdown:md,json:JSON.stringify({manifest,messages:data.messages.map(m=>({...m,attachments:(m.attachments||[]).map(({candidates,...a})=>a)})),
      imageAssets:data.imageAssets||{}},null,2),manifest:JSON.stringify(manifest,null,2)};}
  function imageFileEntries(data){
    const entries={};
    for(const [id,asset] of Object.entries(data.imageAssets||{})){
      const match=/^data:image\/(jpeg|png|webp|gif);base64,(.*)$/is.exec(asset.dataUrl||'');
      if(!match || !/^(?:file[_-][A-Za-z0-9_-]{6,150}|rich_\d+_\d+)$/.test(id))continue;
      const ext=match[1]==='jpeg'?'jpg':match[1];
      const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      entries['images/'+id+'.'+ext]=bytes;
    }
    return entries;
  }
  window.NormLocalRender={buildHtml,buildMarkdown,buildManifest,download,buildZip,makeAssets,
    imageFileEntries,escapeHTML};
})();

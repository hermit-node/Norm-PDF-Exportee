(function(){
  'use strict';
  if(window.top!==window || document.getElementById('norm-local-launch'))return;
  let active=null,ctrl=null,result=null,busy=false;
  const btn=document.createElement('button');btn.id='norm-local-launch';
  btn.textContent='Norm · Export';btn.type='button';
  btn.title='Export this ChatGPT conversation using only your browser';
  document.body.appendChild(btn);
  const mask=document.createElement('div');mask.id='norm-local-ui';mask.hidden=true;
  mask.innerHTML=`<div class="norm-shell" role="dialog" aria-modal="true" aria-label="Norm local conversation exporter">
    <div class="norm-head"><strong>Norm Local Export</strong><button type="button" class="norm-close" aria-label="Close">×</button></div>
    <div class="norm-main">
      <p class="norm-small">ChatGPT API first · historical DOM capture fallback · <strong>no vendor uploads</strong>.</p>
      <div class="norm-status" aria-live="polite">Ready to capture this conversation.</div>
      <div class="norm-result"></div>
      <label class="norm-accept" style="display:none"><input type="checkbox" class="norm-check">
        I understand this is not API-confirmed complete, and I want to export the captured portion.</label>
      <div class="norm-buttons">
        <button type="button" class="norm-start">Capture conversation</button>
        <button type="button" class="norm-retry" hidden>Retry missing images</button>
        <button type="button" class="norm-cancel" disabled>Cancel</button>
      </div>
      <div class="norm-exports" hidden>
        <button type="button" data-kind="pdf">PDF preview / Print</button>
        <button type="button" data-kind="nativepdf">Enhanced PDF (NormPDF)</button>
        <label class="norm-template-label">Template <select class="norm-template"><option value="conversation">Conversation</option><option value="compact">Compact</option><option value="report">Report</option></select></label>
        <button type="button" data-kind="zip">ZIP bundle</button>
        <button type="button" data-kind="html">HTML</button>
        <button type="button" data-kind="markdown">Markdown</button>
        <button type="button" data-kind="json">JSON</button>
      </div>
      <p class="norm-small norm-note">Images are fetched from ChatGPT and embedded locally in the PDF, HTML and ZIP.
        Non-image attachments remain references. Export progress does not mean a PDF was saved.</p>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const $=q=>mask.querySelector(q);
  const status=$('.norm-status'),report=$('.norm-result'),optin=$('.norm-accept'),
    check=$('.norm-check'),start=$('.norm-start'),retry=$('.norm-retry'),cancel=$('.norm-cancel'),buttons=$('.norm-exports');
  function show(){mask.hidden=false;}
  function close(){mask.hidden=true;}
  btn.addEventListener('click',show);
  $('.norm-close').addEventListener('click',close);
  mask.addEventListener('click',e=>{if(e.target===mask)close();});
  cancel.addEventListener('click',()=>{ctrl?.abort();cancel.disabled=true;status.textContent='Cancelling...';});
  function refreshButtons(){
    const confirmed=!!result?.complete && result.source.startsWith('chatgpt-api');
    const enabled=!!result && !busy && (confirmed || check.checked);
    for(const b of buttons.querySelectorAll('button'))b.disabled=!enabled;
    retry.disabled=busy;
  }
  check.addEventListener('change',refreshButtons);
  function presentResult(){
  const manifest=window.NormLocalRender.buildManifest(result);
  const api=manifest.apiConfirmedComplete;
  const summary=document.createElement('div');
  summary.className='norm-summary';
  const header=document.createElement('div');
  header.textContent=(api?'API-CONFIRMED BRANCH':'DOM-ONLY / NOT SERVER VERIFIED')+
    ' · '+result.messages.length+' user/assistant turns';
  header.style.fontWeight='700';summary.append(header);
  const sub=document.createElement('div');sub.textContent='Source: '+result.source+' | '+result.coverage;
  summary.append(sub);
  if(result.totalNodes!=null){const x=document.createElement('div');
    x.textContent='Raw branch/page records: '+result.totalNodes;summary.append(x);}
  if(manifest.attachmentReferences){const x=document.createElement('div');
    x.textContent='Attachment references: '+manifest.attachmentReferences;summary.append(x);}
  {const x=document.createElement('div');
    x.textContent='Images embedded locally: '+(manifest.imagesEmbedded??'unverified')+' / '+
      (manifest.imageReferences??'unknown')+
      (manifest.imagesFailed?' — '+manifest.imagesFailed+' failed':'');summary.append(x);}
  for(const [label,count] of [['Uploaded images',manifest.uploadedImages],['Assistant-displayed images',manifest.assistantImages]])if(count){const p=document.createElement('div');p.textContent=label+': '+count.embedded+' / '+count.expected+(count.fromDOM?' ('+count.fromDOM+' from rendered page)':'');summary.append(p);}
  if(manifest.imageFailures?.length){const d=document.createElement('details');d.open=true;const s=document.createElement('summary');s.textContent='Image download failures';d.append(s);const counts=new Map();for(const f of manifest.imageFailures){const reason=typeof f==='string'?f:[f.stage,f.reason].filter(Boolean).join(': ');counts.set(reason,(counts.get(reason)||0)+1);}for(const [reason,n] of counts){const p=document.createElement('p');p.textContent=n+' × '+reason;d.append(p);}summary.append(d);}
  if(result.warnings?.length){const details=document.createElement('details');
    const title=document.createElement('summary');title.textContent='Capture warnings ('+result.warnings.length+')';
    details.append(title);for(const w of result.warnings){const p=document.createElement('p');p.textContent=w;details.append(p);}
    summary.append(details);}
  report.replaceChildren(summary);
  const visual=manifest.visuallyComplete;
  if(!api){
    optin.style.display='flex';
    $('.norm-accept').lastChild.textContent= api ?
      ' Some ChatGPT images could not be embedded. Export anyway with missing images.' :
      ' DOM-only data is not API-confirmed. Export the unverified capture anyway.';
  }
  const failed=Number(result.imageCoverage?.failed)||0;
  retry.hidden=!(api&&failed>0&&(result.imageCoverage?.failures||[]).some(f=>f?.id));
  retry.textContent='Retry '+failed+' missing image'+(failed===1?'':'s');
  buttons.hidden=false;refreshButtons();
  status.textContent=api ?
    (failed ? 'Captured '+result.messages.length+' records with '+result.imageCoverage.embedded+' of '+result.imageCoverage.expected+' images. You can export now or retry the '+failed+' missing image'+(failed===1?'':'s')+'.' :
      'Selected conversation branch and all images captured; ready to export.'):
    'DOM-only capture is not server verified. Check the box below if you want to export the captured portion.';
  }
  start.addEventListener('click',async()=>{
    if(busy)return;busy=true;
    if(ctrl)ctrl.abort();ctrl=new AbortController();result=null;active=null;retry.hidden=true;
    start.disabled=true;cancel.disabled=false;buttons.hidden=true;optin.style.display='none';
    check.checked=false;report.replaceChildren();
    const url=location.href;
    try{
      result=await window.NormLocalCapture.extract({signal:ctrl.signal,
        onProgress:t=>{status.textContent=t;}});
      if(url!==location.href)throw new Error('Conversation changed during capture; discarded the snapshot');
      if(result.source.startsWith('chatgpt-api')) {
        result=await window.NormLocalCapture.resolveImages(result,{signal:ctrl.signal,
          onProgress:t=>{status.textContent=t;}});
      } else {
        result.imageCoverage={expected:null,embedded:null,failed:null,bytes:0,
          method:'unverified-DOM',complete:false,failures:[]};
      }
      if(url!==location.href)throw new Error('Conversation changed during image capture; discarded the snapshot');
      presentResult();
    }catch(e){status.textContent=ctrl.signal.aborted?'Capture cancelled.':'Capture failed: '+String(e.message||e);}
    finally{busy=false;start.disabled=false;cancel.disabled=true;ctrl=null;refreshButtons();}
  });
  retry.addEventListener('click',async()=>{
    if(!result||busy||retry.hidden)return;
    busy=true;ctrl=new AbortController();start.disabled=true;cancel.disabled=false;refreshButtons();
    const url=location.href;
    try{
      status.textContent='Retrying only missing images; previously embedded images are preserved...';
      result=await window.NormLocalCapture.retryFailedImages(result,{signal:ctrl.signal,
        onProgress:t=>{status.textContent=t;}});
      if(url!==location.href)throw Error('Conversation changed during image retry');
      presentResult();
    }catch(e){status.textContent=ctrl.signal.aborted?'Image retry cancelled. Existing images are preserved.':'Image retry failed: '+String(e?.message||e);}
    finally{busy=false;start.disabled=false;cancel.disabled=true;ctrl=null;refreshButtons();}
  });
  let preview=null;
  function openPreview(html){
    preview?.remove();
    const overlay=document.createElement('div');overlay.className='norm-print-overlay';
    overlay.innerHTML='<div class="norm-print-bar"><strong>Local PDF preview</strong><span>Content is isolated; network blocked.</span><button type="button" class="norm-print">Print / Save as PDF</button><button type="button" class="norm-print-close">Close preview</button></div>';
    const frame=document.createElement('iframe');frame.title='Norm local PDF document';
    frame.sandbox='allow-same-origin allow-modals';
    frame.srcdoc=html;overlay.append(frame);document.body.append(overlay);preview=overlay;
    overlay.querySelector('.norm-print-close').onclick=()=>{overlay.remove();preview=null;};
    overlay.querySelector('.norm-print').onclick=()=>{
      try{frame.contentWindow.focus();frame.contentWindow.print();}
      catch(e){alert('Browser print failed: '+e.message);}
    };
  }
  const safeFilename=()=>((result.title||'ChatGPT Conversation').replace(/[\\/:*?"<>|\x00-\x1f]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,110)||'ChatGPT Conversation');
  function nativeRequest(payload){
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage(payload,response=>{
        const error=chrome.runtime.lastError?.message;
        if(error)return reject(new Error(error));
        if(!response?.ok)return reject(new Error(response?.error||'NormPDF host did not respond.'));
        resolve(response);
      });
    });
  }
  async function exportEnhancedPDF(html,name){
    const template=$('.norm-template').value;
    status.textContent='Connecting to portable NormPDF...';
    await nativeRequest({type:'norm-native-pdf-start',name,template});
    const max=120000;let position=0,seq=0;
    while(position<html.length){
      let end=Math.min(html.length,position+max);
      if(end<html.length){const code=html.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end--;}
      const text=html.slice(position,end);
      await nativeRequest({type:'norm-native-pdf-chunk',seq:seq++,text});
      position=end;
      status.textContent='Sending to NormPDF: '+Math.round(100*position/html.length)+'%';
    }
    status.textContent='Rendering enhanced PDF locally...';
    const response=await nativeRequest({type:'norm-native-pdf-finish'});
    status.textContent='PDF saved: '+response.path;
    return response;
  }
  buttons.addEventListener('click',async e=>{
    const kind=e.target.dataset?.kind;
    if(!kind||!result)return;
    const api=result.complete&&result.source.startsWith('chatgpt-api');
    if(busy||(!api&&!check.checked))return;
    // Never promote a user-accepted partial capture into a claimed full export.
    const doc={...result, complete:api};
    const renderer=window.NormLocalRender;
    const assets=renderer.makeAssets(doc),base=safeFilename();
    if(kind==='pdf')openPreview(assets.html);
    else if(kind==='nativepdf'){
      const button=e.target;button.disabled=true;
      try{await exportEnhancedPDF(assets.html,base);}
      catch(error){status.textContent='Local PDF failed: '+String(error.message||error)+'. Browser Print remains available.';}
      finally{refreshButtons();}
    }
    else if(kind==='html')renderer.download(base+'.html',assets.html,'text/html;charset=utf-8');
    else if(kind==='markdown')renderer.download(base+'.md',assets.markdown,'text/markdown;charset=utf-8');
    else if(kind==='json')renderer.download(base+'.json',assets.json,'application/json;charset=utf-8');
    else if(kind==='zip'){
      const zip=renderer.buildZip({
        'conversation.html':assets.html,'conversation.md':assets.markdown,
        'conversation.json':assets.json,'verification.json':assets.manifest,
        ...renderer.imageFileEntries(doc)});
      const url=URL.createObjectURL(zip),a=document.createElement('a');
      a.href=url;a.download=base+'.zip';document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }
  });
})();

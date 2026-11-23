/* Local image transfer. OpenAI asset URLs and explicit public image CDN hosts only.
 * Credential-free GET, no redirects or uploads. */
'use strict';
const MAX_BYTES=15*1024*1024;
function safeUrl(value){
  try{
    const url=new URL(value);
    const h=url.hostname.toLowerCase();
    if(url.username||url.password||url.port)return null;
    if(url.protocol==='https:'&&["m.media-amazon.com","images-na.ssl-images-amazon.com","images-eu.ssl-images-amazon.com","images-fe.ssl-images-amazon.com"].includes(h)&&url.pathname.startsWith('/images/')&&!url.search)return url;
    if(url.protocol!=='https:' || !(
      h==='images.openai.com' || h==='chatgpt.com' || h==='chat.openai.com' ||
      h==='oaiusercontent.com' || h.endsWith('.oaiusercontent.com'))) return null;
    return url;
  }catch(_){return null;}
}
function sniffImageMime(b){
  if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'image/png';
  if(b.length>=12&&String.fromCharCode(...b.subarray(0,4))==='RIFF'&&
    String.fromCharCode(...b.subarray(8,12))==='WEBP')return 'image/webp';
  if(b.length>=6&&['GIF87a','GIF89a'].includes(String.fromCharCode(...b.subarray(0,6))))return 'image/gif';
  return '';
}
function asDataUrl(bytes,mime){
  let raw='';
  for(let i=0;i<bytes.length;i+=16384){
    raw+=String.fromCharCode(...bytes.subarray(i,i+16384));
  }
  return 'data:'+mime+';base64,'+btoa(raw);
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(request?.type!=='norm-fetch-openai-image')return false;
  const pageUrl=sender?.url||'';
  if(!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(pageUrl)){
    respond({ok:false,error:'Image request was not sent from ChatGPT'});return false;
  }
  const url=safeUrl(request.url);
  if(!url){respond({ok:false,error:'Blocked image URL host'});return false;}
  (async()=>{
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),45000);
    try{
      const resp=await fetch(url.href,{credentials:'omit',redirect:'error',
        referrerPolicy:'no-referrer',cache:'no-store',signal:ctrl.signal});
      if(!resp.ok)throw new Error('Asset HTTP '+resp.status);
      if(Number(resp.headers.get('content-length')||0)>MAX_BYTES)
        throw new Error('Asset exceeds 15 MiB');
      const bytes=new Uint8Array(await resp.arrayBuffer());
      if(bytes.byteLength===0 || bytes.byteLength>MAX_BYTES)
        throw new Error('Empty or oversized asset');
      const mime=sniffImageMime(bytes);
      if(!mime)throw new Error('Asset was not a supported image');
      respond({ok:true,bytes:bytes.length,mime,dataUrl:asDataUrl(bytes,mime)});
    }catch(e){respond({ok:false,error:String(e?.message||e).slice(0,180)});}
    finally{clearTimeout(timer);}
  })();
  return true;
});

/* Optional portable NormPDF host. No HTTP listener; Chrome launches it on demand. */
const normPdfSessions = new Map();
function normPdfSenderKey(sender) {
  return String(sender?.tab?.id ?? 'none') + ':' + String(sender?.frameId ?? 0);
}
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (!['norm-native-pdf-start','norm-native-pdf-chunk','norm-native-pdf-finish'].includes(request?.type)) return false;
  if (!/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//.test(sender?.url || '')) {
    respond({ok:false,error:'This PDF request must originate from a ChatGPT tab.'});return false;
  }
  const key = normPdfSenderKey(sender);
  let sess = normPdfSessions.get(key);
  if (request.type === 'norm-native-pdf-start') {
    if (sess) { sess.port.disconnect(); normPdfSessions.delete(key); }
    try {
      const port = chrome.runtime.connectNative('com.norm.localpdf');
      sess = {port, pending:respond};
      normPdfSessions.set(key, sess);
      port.onMessage.addListener(message => {
        if (sess.pending) {
          const callback = sess.pending;
          sess.pending = null;
          callback(message);
        }
        if (message.type === 'complete' || message.type === 'error') {
          normPdfSessions.delete(key);port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || 'NormPDF host disconnected.';
        if (sess.pending) {
          const callback = sess.pending;sess.pending = null;
          callback({ok:false,error});
        }
        normPdfSessions.delete(key);
      });
      port.postMessage({type:'begin',name:request.name,template:request.template});
      return true;
    } catch (error) {
      normPdfSessions.delete(key);
      respond({ok:false,error:String(error.message||error)});return false;
    }
  }
  if (!sess) {respond({ok:false,error:'NormPDF session not started.'});return false;}
  if (sess.pending) {respond({ok:false,error:'NormPDF is still handling the previous chunk.'});return false;}
  sess.pending = respond;
  try {
    if (request.type === 'norm-native-pdf-chunk') {
      sess.port.postMessage({type:'chunk',seq:request.seq,text:request.text});
    } else {
      sess.port.postMessage({type:'finish'});
    }
    return true;
  } catch (error) {
    sess.pending = null;respond({ok:false,error:String(error.message||error)});
    sess.port.disconnect();normPdfSessions.delete(key);return false;
  }
});

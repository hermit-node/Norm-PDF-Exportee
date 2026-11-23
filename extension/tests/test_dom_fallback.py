from playwright.sync_api import sync_playwright
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]
COUNT=24
html='<!doctype html><html><body><div id="rail"></div><main>'+''.join(
  f'<section data-testid="conversation-turn-{i}" data-turn-id="m{i}">'+
  (f'<div data-message-author-role="assistant">Turn {i}</div>' if i in (1,COUNT) else '')+
  '</section>' for i in range(1,COUNT+1))+'</main></body></html>'
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page();page.set_content(html)
 page.evaluate('''() => {const rail=document.getElementById('rail');
 for(let i=1;i<=24;i++){const btn=document.createElement('button');btn.dataset.tocActive=i===24?'true':'false';
 btn.textContent=i;btn.addEventListener('click',()=>{const el=document.querySelector('[data-testid="conversation-turn-'+i+'"]');
 if(!el.innerHTML.trim())el.innerHTML='<div data-message-author-role="assistant">Turn '+i+'</div>';});
 rail.append(btn);}}''')
 page.expose_function('mock_json',lambda p:{'status':404,'body':{}})
 page.evaluate('''() => {window.__mockFetch=async path=>{const d=await window.mock_json(path);
 return new Response(JSON.stringify(d.body),{status:d.status});};}''')
 source=(BASE/'capture.js').read_text().replace("new Set(['https://chatgpt.com', 'https://chat.openai.com'])","new Set(['null'])")
 source=source.replace('const match=location.pathname.match(uuidPath);',"const match=['','11111111-1111-4111-8111-111111111111'];")
 source=source.replace('await fetch(path, {headers,','await window.__mockFetch(path, {headers,')
 page.add_script_tag(content=source)
 r=page.evaluate('async () => await NormLocalCapture.extract()')
 assert r['source']=='dom-virtualized'
 assert len(r['messages'])==24,len(r['messages'])
 assert r['complete'] and r['messages'][0]['id']=='dom-1' and r['messages'][-1]['id']=='dom-24'
 assert 'not server-verified' in r['coverage']
 print('PASS: DOM navigator materialized 24 virtual turns; all contiguous; not server-verified')
 b.close()

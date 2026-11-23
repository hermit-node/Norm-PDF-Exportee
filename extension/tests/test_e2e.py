import json, pathlib, re, zipfile
from playwright.sync_api import sync_playwright
import fitz

BASE=pathlib.Path(__file__).resolve().parents[1]
CHAT='http://localhost:8769/c/11111111-1111-4111-8111-111111111111'
messages=[{'id':f'm{i:03}', 'author':{'role':'user' if i%2 else 'assistant'},
           'create_time':1700000000+i, 'content':{'content_type':'text','parts':[f'UNIQUE-SENTINEL-{i:03} message number {i}']},
           'metadata':{}} for i in range(1,351)]

def legacy_data(corrupt=False):
    mapping={'root':{'id':'root','parent':None,'message':None}}
    prev='root'
    for m in messages:
        mapping[m['id']]={'id':m['id'],'parent':prev,'message':m}
        prev=m['id']
    if corrupt: mapping['m175']['parent']='nonexistent-parent'
    return {'title':'350 conversation turns synthetic test','mapping':mapping,'current_node':prev}

html='<!doctype html><html><head><meta charset="utf-8"><title>Mock ChatGPT conversation</title></head>' + \
     '<body><main><section data-testid="conversation-turn-349">recent message</section>' + \
     '<section data-testid="conversation-turn-350">final message</section></main></body></html>'

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                               args=['--no-sandbox','--disable-background-networking'])
    context=browser.new_context(accept_downloads=True)
    calls=[]
    mode={'value':'graph'}
    def mock_json(path):
        calls.append(path)
        if path == '/api/auth/session':
            return {'status':200,'body':{'accessToken':'test-only-do-not-store'}}
        if '/backend-api/conversation/' in path:
            if mode['value']=='graph':return {'status':200,'body':legacy_data()}
            if mode['value']=='fallback':return {'status':200,'body':legacy_data(corrupt=True)}
            return {'status':404,'body':{}}
        if '/backend-api/conversations/' in path and mode['value']=='fallback':
            from urllib.parse import parse_qs, urlparse
            cursor=parse_qs(urlparse(path).query).get('before',[''])[0]
            mapping={'':(251,350,True,'c250'),'c250':(151,250,True,'c150'),
                     'c150':(51,150,True,'c50'),'c50':(1,50,False,'')}
            first,last,prev,nextc=mapping[cursor]
            return {'status':200,'body':{'messages':messages[first-1:last],
              'page_info':{'has_previous_page':prev,'start_cursor':nextc}}}
        return {'status':404,'body':{}}
    page=context.new_page()
    page.set_content(html)
    page.expose_function('mock_json',mock_json)
    page.evaluate("""window.__mockFetch = async (path, config) => {
        const data = await window.mock_json(path);
        return new Response(JSON.stringify(data.body), {status:data.status,
          headers:{'content-type':'application/json'}});
    }; undefined;""")
    for name in ['capture.js','render.js','content.js']:
        content=(BASE/name).read_text()
        if name=='capture.js':
            content=content.replace("new Set(['https://chatgpt.com', 'https://chat.openai.com'])","new Set(['null'])")
            content=content.replace('const match=location.pathname.match(uuidPath);',
              "const match=['','11111111-1111-4111-8111-111111111111'];")
            content=content.replace('await fetch(path, {headers,','await window.__mockFetch(path, {headers,')
        page.add_script_tag(content=content)

    graph=page.evaluate('async () => await NormLocalCapture.extract({allowDOM:false})')
    assert graph['complete'] and graph['source']=='chatgpt-api-graph'
    assert len(graph['messages'])==350
    assert graph['messages'][0]['text'].startswith('UNIQUE-SENTINEL-001')
    assert graph['messages'][-1]['text'].startswith('UNIQUE-SENTINEL-350')
    assert graph['totalNodes']==351
    assert all(u=='/api/auth/session' or u.startswith('/backend-api/') for u in calls)
    print('PASS: 350 legacy API turns, all sentinels, root reached, no outside requests')

    page.locator('#norm-local-launch').click()
    page.locator('.norm-start').click()
    page.wait_for_function("document.querySelector('.norm-exports')?.hidden === false",timeout=30000)
    assert 'API-CONFIRMED BRANCH' in page.locator('.norm-result').inner_text()
    page.locator('[data-kind="pdf"]').click()
    assert page.locator('.norm-print-overlay').is_visible()
    frame=page.frame_locator('.norm-print-overlay iframe')
    assert frame.locator('body').inner_text().count('UNIQUE-SENTINEL-')==350
    print('PASS: extension UI -> local print preview -> 350 turn document')
    data=page.locator('.norm-print-overlay iframe').evaluate('(el)=>el.srcdoc')
    assert "connect-src" in data and "script-src" in data and "default-src" in data
    pdfpage=context.new_page()
    pdfpage.route('**/*',lambda r:r.abort())
    pdfpage.goto('about:blank')
    pdfpage.set_content(data,wait_until='domcontentloaded')
    pdfpath=BASE/'tests'/'synthetic-350.pdf'
    pdfpage.pdf(path=str(pdfpath),format='Letter',print_background=True)
    with fitz.open(pdfpath) as doc:
        text='\n'.join(pg.get_text() for pg in doc)
        assert len(doc)>1, len(doc)
        for i in [1,2,100,175,260,349,350]:
            assert f'UNIQUE-SENTINEL-{i:03}' in text, f'Missing PDF sentinel {i}'
        print('PASS: Chromium local PDF pages=',len(doc),'bytes=',pdfpath.stat().st_size)
    pdfpage.close()

    # Verify ZIP structure and integrity through browser-generated Blob, not remote zip.
    page.locator('.norm-print-close').click()
    with page.expect_download() as dl:
        page.locator('[data-kind="zip"]').click()
    download=dl.value
    zpath=BASE/'tests'/'synthetic-350.zip';download.save_as(zpath)
    with zipfile.ZipFile(zpath) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist())=={'conversation.html','conversation.md','conversation.json','verification.json'}
        payload=json.loads(archive.read('conversation.json'))
        assert len(payload['messages'])==350
        assert payload['manifest']['apiConfirmedComplete'] is True
    print('PASS: ZIP contains 350 turns + verification manifest, CRC clean')

    mode['value']='fallback'
    pages=page.evaluate('async () => await NormLocalCapture.extract({allowDOM:false})')
    assert pages['source']=='chatgpt-api-paginated' and pages['complete'] and len(pages['messages'])==350
    assert pages['messages'][0]['id']=='m001' and pages['messages'][-1]['id']=='m350'
    assert pages['pages']==4
    print('PASS: 350 paginated turns in correct order; legacy graph corruption refused')

    # Both first party endpoints fail: reject as API-confirmed, but permit explicit DOM only.
    mode['value']='broken'
    dom=page.evaluate('async () => await NormLocalCapture.extract({allowDOM:true})')
    assert dom['source']=='dom-virtualized' and not dom['complete']
    assert len(dom['messages'])==2 and dom['warnings']
    print('PASS: API outage yields unverified DOM-only capture (not marked complete)')

    context.close();browser.close()
print('ALL E2E TESTS PASSED')

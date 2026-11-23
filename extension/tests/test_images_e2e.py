"""Simulated authenticated ChatGPT image resolution. No external requests allowed.
Print/ZIP are generated in Chromium from image bytes fetched from mocked ChatGPT endpoints.
"""
from __future__ import annotations
import base64, io, json, pathlib, zipfile
from urllib.parse import urlsplit,parse_qs
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
import pymupdf

BASE=pathlib.Path(__file__).resolve().parents[1]
CONVO='11111111-1111-4111-8111-111111111111'
ROOT='http://localhost:8769'
USER_POSITIONS=[0,4,18,25,47,120,158,165,172,176,183,248,264,278,300,318,334,
                341,351,365,382,392,405,414,426,439,448,455,463,477,487,498,510,520,529]
assert len(USER_POSITIONS)==35
idlist=[f'file_IMAGE{i:04d}xxxxxxxxxxxxxxxxxxxxxxxx' for i in range(38)]
# 35 messages; 3 have two JPEG images, 32 have one = 38 distinct images.
placements={p:[] for p in USER_POSITIONS};k=0
for j,p in enumerate(USER_POSITIONS):
    for n in range(2 if j<3 else 1):
        placements[p].append(idlist[k]);k+=1
assert k==38

def img_data(k):
    image=Image.new('RGB',(180,110),((k*41)%255,(k*67)%255,(k*101)%255))
    d=ImageDraw.Draw(image);d.text((12,44),f'IMG {k:02}',fill=(255,255,255))
    f=io.BytesIO();image.save(f,format='JPEG',quality=92);return f.getvalue()
images={s:img_data(i) for i,s in enumerate(idlist)}
msgs=[];mapping={'root':{'id':'root','parent':None,'message':None}}
prev='root'
for i in range(531):
    ids=placements.get(i,[])
    attach=[{'id':id,'name':'Screenshot','mime_type':'image/jpeg'} for id in ids]
    parts=[f'SYNTHETIC-SENTINEL-{i:03d} long conversation message']
    parts.extend({'content_type':'image_asset_pointer','asset_pointer':'sediment://'+id} for id in ids)
    m={'id':'m'+str(i).zfill(4),'author':{'role':'user' if i in placements or i%4==0 else 'assistant'},
       'content':{'content_type':'multimodal_text' if ids else 'text','parts':parts},
       'metadata':{'attachments':attach},'create_time':1700000000+i}
    msgs.append(m)
    mapping[m['id']]={'id':m['id'],'parent':prev,'message':m};prev=m['id']
legacy={'title':'Test 531 messages and 38 JPEG images','mapping':mapping,'current_node':prev}
HTML='<!doctype html><html><head><title>Synthetic conversation</title></head><body><main>Mock</main></body></html>'

def run(success=True):
    routes=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
            args=['--no-sandbox','--disable-background-networking'])
        context=browser.new_context(accept_downloads=True)
        page=context.new_page()
        page.set_content(HTML)
        # Browser tests are fully offline: an injectable first-party fixture replaces
        # network fetch, while the production capture and render logic stays intact.
        def mock_fetch(url):
            parsed=urlsplit(url);path=parsed.path
            routes.append((path,parsed.netloc))
            if path=='/api/auth/session':return {'status':200,'body':json.dumps({'accessToken':'mock-only'}),'mime':'application/json'}
            if path==f'/backend-api/conversation/{CONVO}':return {'status':200,'body':json.dumps(legacy),'mime':'application/json'}
            if path.startswith('/backend-api/files/download/'):
                id=path.rsplit('/',1)[-1]
                if id not in images:return {'status':404,'body':'','mime':'text/plain'}
                if parse_qs(parsed.query).get('conversation_id')!=[CONVO]:return {'status':400,'body':'','mime':'text/plain'}
                if not success and id==idlist[10]:return {'status':404,'body':'','mime':'text/plain'}
                return {'status':200,'body':json.dumps({'download_url':'https://chatgpt.com/mock-images/'+id}),
                        'mime':'application/json'}
            if path.startswith('/mock-images/'):
                id=path.rsplit('/',1)[-1]
                return {'status':200,'body':base64.b64encode(images[id]).decode(),'mime':'image/jpeg','encoded':True}
            raise AssertionError(f'Unexpected path: {url}')
        page.expose_function('test_response',mock_fetch)
        page.evaluate("""window.__mockFetch=async(url,settings)=>{
          const response=await window.test_response(url);
          const body=response.encoded?Uint8Array.from(atob(response.body),c=>c.charCodeAt(0)):response.body;
          return new Response(body,{status:response.status,headers:{'content-type':response.mime}});
        }; undefined;""")
        for file in ['capture.js','render.js','content.js']:
            code=(BASE/file).read_text()
            if file=='capture.js':
                code=code.replace("new Set(['https://chatgpt.com', 'https://chat.openai.com'])","new Set(['null'])")
                code=code.replace('const match=location.pathname.match(uuidPath);',
                  f"const match=['','{CONVO}'];")
                code=code.replace('await fetch(path, {headers,','await window.__mockFetch(path, {headers,')
                code=code.replace('new URL(raw,location.origin)','new URL(raw,\'https://chatgpt.com\')')
                code=code.replace('assetUrl.origin===location.origin','assetUrl.hostname===\'chatgpt.com\'')
                code=code.replace('await fetch(assetUrl.href,{','await window.__mockFetch(assetUrl.href,{')
            page.add_script_tag(content=code)
        page.locator('#norm-local-launch').click()
        page.locator('.norm-start').click()
        page.wait_for_function("document.querySelector('.norm-exports')?.hidden === false",timeout=120000)
        summary=page.locator('.norm-result').inner_text()
        assert '531 user/assistant turns' in summary, summary
        if success:
            assert 'Images embedded locally: 38 / 38' in summary,summary
        else:
            assert 'Images embedded locally: 37 / 38' in summary,summary
            assert '1 failed' in summary,summary
            assert page.locator('[data-kind="pdf"]').is_disabled()
            page.locator('.norm-check').check()
        page.locator('[data-kind="pdf"]').click()
        frame=page.frame_locator('.norm-print-overlay iframe')
        assert frame.locator('img').count()==(38 if success else 37)
        assert frame.locator('body').inner_text().count('SYNTHETIC-SENTINEL-')==531
        html=page.locator('.norm-print-overlay iframe').evaluate('(e)=>e.srcdoc')
        assert html.count('data:image/jpeg;base64,')==(38 if success else 37)
        printpage=context.new_page()
        printpage.set_content(html,wait_until='load',timeout=120000)
        pdfpath=BASE/'tests'/('images-531-complete.pdf' if success else 'images-531-partial.pdf')
        printpage.pdf(path=str(pdfpath),format='Letter',print_background=True)
        with pymupdf.open(pdfpath) as pdf:
            text='\n'.join(p.get_text() for p in pdf)
            assert 'SYNTHETIC-SENTINEL-000' in text
            assert 'SYNTHETIC-SENTINEL-530' in text
            unique_image_xrefs={x[0] for p in pdf for x in p.get_images(full=True)}
            assert len(unique_image_xrefs)==(38 if success else 37),(len(unique_image_xrefs),success)
            print('PASS PDF',len(pdf),'pages',len(unique_image_xrefs),'distinct images',pdfpath.stat().st_size,'bytes')
        printpage.close()
        page.locator('.norm-print-close').click()
        with page.expect_download(timeout=30000) as d:
            page.locator('[data-kind="zip"]').click()
        zpath=BASE/'tests'/('images-531-complete.zip' if success else 'images-531-partial.zip')
        d.value.save_as(zpath)
        with zipfile.ZipFile(zpath) as z:
            assert z.testzip() is None
            names=z.namelist()
            assets=[x for x in names if x.startswith('images/')]
            assert len(assets)==(38 if success else 37)
            v=json.loads(z.read('verification.json'))
            assert v['messageCount']==531
            assert v['imageReferences']==38
            assert v['imagesEmbedded']==(38 if success else 37)
            assert v['visuallyComplete']==success
            assert len(v['imageFailures'])==(0 if success else 1)
            for file in assets: assert z.read(file).startswith(b'\xff\xd8\xff')
            assert len(json.loads(z.read('conversation.json'))['imageAssets'])==(38 if success else 37)
            assert z.read('conversation.html').count(b'data:image/jpeg;base64,')==(38 if success else 37)
            assert z.read('conversation.md').count(b'data:image/jpeg;base64,')==(38 if success else 37)
            print('PASS ZIP',len(assets),'embedded image files, verified JSON+HTML+MD',zpath.stat().st_size,'bytes')
        assert all(host=='' or host=='chatgpt.com' for _,host in routes)
        assert len([x for x in routes if x[0].startswith('/mock-images/')])==(38 if success else 37)
        print('PASS privacy: only mocked ChatGPT endpoints,',len(routes),'requests; partial image case:',not success)
        context.close();browser.close()

run(True)
run(False)
print('ALL IMAGE E2E TESTS PASSED')

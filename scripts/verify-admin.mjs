import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from '../server/node_modules/sharp/lib/index.js'

const out=path.resolve('.superpowers/verification')
const base=process.env.VERIFY_ADMIN_URL||'http://127.0.0.1:8085'
const galleryOnly=process.argv.includes('--gallery-only')
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
await mkdir(out,{recursive:true})
const fixture=path.join(out,'verification-upload.png')
await sharp({create:{width:1000,height:700,channels:3,background:'#95a686'}}).png().toFile(fixture)
const browser=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=9240',
  '--enable-unsafe-swiftshader',`--user-data-dir=${path.join(out,'admin-profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'})
let ws,id=0
const pending=new Map()
const report={base,checks:{}}
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))})
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<300;i++){if(await evaluate(expression))return;await sleep(100)}throw Error(`Timeout: ${expression}`)}
async function click(selector){
  if(await evaluate(`document.querySelector('.topbarInner')?.dataset.toolbar==='collapsed'`)){
    const r=await evaluate(`document.querySelector('.topbarInner').getBoundingClientRect().toJSON()`)
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2})
    await until(`document.querySelector('.topbarInner').dataset.toolbar==='expanded' && !document.querySelector('.topbarInner').getAnimations().length`)
  }
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})
}
const photos=async()=>(await(await fetch(`${base}/api/photos`)).json()).photos
let uploadedId
try{
  let tab
  for(let i=0;i<100;i++){try{tab=(await(await fetch('http://127.0.0.1:9240/json')).json()).find(t=>t.type==='page');if(tab)break}catch{}await sleep(100)}
  ws=new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise(r=>ws.addEventListener('open',r,{once:true}))
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}else if(m.method==='Page.javascriptDialogOpening')void send('Page.handleJavaScriptDialog',{accept:true})})
  await send('Page.enable');await send('DOM.enable')
  await send('Network.setCacheDisabled',{cacheDisabled:true})
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  if(galleryOnly){
    const states=execFileSync('docker',['inspect','--format','{{.State.Status}}','photogallery-gallery-1','gallery-revert-admin-gallery-1'],{encoding:'utf8'}).trim().split(/\r?\n/)
    assert.deepEqual(states,['exited','exited'])
    const dev=process.env.VERIFY_DEV_URL||'http://127.0.0.1:5173'
    report.base=dev
    await send('Page.navigate',{url:dev})
    await until(`document.querySelectorAll('.tile').length===44`)
    await until(`[...document.querySelectorAll('.tile img')].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(i=>i.complete&&i.naturalWidth>0&&getComputedStyle(i).opacity==='1')`)
    const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    await writeFile(path.join(out,'dev-without-docker.png'),Buffer.from(image.data,'base64'))
    report.checks.development={url:dev,photos:44,visibleImagesLoaded:true,dockerStates:states}
    report.status='passed'
    console.log('PASS development without Docker: both gallery containers exited; 44 tiles; visible images loaded')
  }else{
  await send('Page.navigate',{url:`${base}/#/admin`})
  await until(`!!document.querySelector('input[type=password]')`)
  await evaluate(`document.querySelector('input[type=password]').value='wrong-password'`)
  await click('.adminLogin button')
  await until(`document.querySelector('.adminFeedback').textContent==='密码错误'`)
  report.checks.rejectedWrongPassword=true
  await evaluate(`document.querySelector('input[type=password]').value='gallery-verification-only'`)
  await click('.adminLogin button')
  await until(`!!document.querySelector('input[type=file]')`)
  const before=await photos()
  const doc=await send('DOM.getDocument')
  const node=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'})
  await send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[fixture]})
  await click('.adminUpload button')
  await until(`document.querySelector('.adminFeedback').textContent==='已上传'`)
  const after=await photos()
  const uploaded=after.find(p=>!before.some(b=>b.id===p.id))
  assert.ok(uploaded)
  uploadedId=uploaded.id
  assert.equal(uploaded.width,1000);assert.equal(uploaded.height,700)
  assert.equal(uploaded.derived.thumb,true);assert.equal(uploaded.derived.web,true)
  const selector=`article[data-photo-id="${uploadedId}"]`
  const title='验收：中文标题'
  const description='保留中文描述与照片原尺寸。'
  await evaluate(`(()=>{const row=document.querySelector(${JSON.stringify(selector)});row.querySelector('input').value=${JSON.stringify(title)};row.querySelector('textarea').value=${JSON.stringify(description)}})()`)
  await click(`${selector} button[type=submit]`)
  await until(`document.querySelector('.adminFeedback').textContent==='已保存'`)
  let saved=(await photos()).find(p=>p.id===uploadedId)
  assert.equal(saved.title,title);assert.equal(saved.description,description)
  await send('Page.reload')
  await until(`document.querySelector(${JSON.stringify(selector+' input')})?.value===${JSON.stringify(title)}`)
  const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  await writeFile(path.join(out,'admin.png'),Buffer.from(image.data,'base64'))
  await click(`${selector} button[type=button]`)
  await until(`document.querySelector('.adminFeedback').textContent==='已删除'`)
  assert.equal((await photos()).some(p=>p.id===uploadedId),false)
  for(const dir of ['originals','thumbs','web']){
    const response=await fetch(`${base}/media/${dir}/${encodeURIComponent(uploadedId)}`)
    assert.equal(response.status,404)
    await assert.rejects(access(path.join(out,'library',dir,uploadedId)))
  }
  report.checks.management={before:before.length,after:(await photos()).length,upload:true,derived:true,unicodeEdit:true,persistedAfterReload:true,deleteOriginalAndDerived:true}
  await click('.topbarInner .actions button')
  await until(`!!document.querySelector('input[type=password]')`)
  await send('Page.reload')
  await until(`!!document.querySelector('input[type=password]')`)
  report.checks.logout=true
  if(process.env.VERIFY_DEV_URL){
    const dev=process.env.VERIFY_DEV_URL
    await send('Page.navigate',{url:dev})
    await until(`document.querySelectorAll('.tile').length===44`)
    await until(`[...document.querySelectorAll('.tile img')].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(i=>i.naturalWidth>0)`)
    report.checks.development={url:dev,photos:44,visibleImagesLoaded:true}
  }
  report.status='passed'
  console.log('PASS admin: wrong-password rejection; login; upload; Chinese edit/reload; delete all renditions; logout')
  if(report.checks.development)console.log('PASS development: local Node API + Vite direct media; 44 tiles; visible images loaded')
  }
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;console.error(e.stack)}
finally{const name=galleryOnly?'dev-without-docker-results.json':'admin-results.json';await writeFile(path.join(out,name),JSON.stringify(report,null,2));ws?.close();browser.kill();console.log(`Evidence: ${path.join(out,name)}`)}

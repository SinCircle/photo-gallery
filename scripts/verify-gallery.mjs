// No browser/testing dependencies: Chrome DevTools Protocol and Node built-ins.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import sharp from '../server/node_modules/sharp/lib/index.js'
import path from 'node:path'
import assert from 'node:assert/strict'

const repo = process.cwd()
const out = path.join(repo, '.superpowers/verification')
const base = process.env.VERIFY_URL || 'http://127.0.0.1'
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir(out, { recursive: true })
const report = { base, cliScreenshotBudget: 45000, checks: {}, screenshots: [], errors: [] }
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9237', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  `--user-data-dir=${path.join(out, 'cdp-profile')}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' })
let socket
let referenceServer
let sequence = 0
let loads = 0
const pending = new Map()
const listeners = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
function on(method, listener) {
  listeners.set(method, listener)
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
async function until(expression, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timeout: ${expression}`)
}
async function navigate(url, width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const previous = loads
  const result = await send('Page.navigate', { url })
  if (result.loaderId) {
    const end = Date.now() + 60000
    while (loads === previous && Date.now() < end) await sleep(50)
    assert.ok(loads > previous, 'Document did not finish navigation')
  }
  const match = new URL(url).hash.match(/^#\/photo\/(.+)$/)
  if (match) await until(`document.querySelector('.photoImgHigh')?.src.endsWith(${JSON.stringify('/'+encodeURIComponent(decodeURIComponent(match[1])))})`)
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64'))
  report.screenshots.push(`${name}.png`)
}
async function wakeDock() {
  const r = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').getAnimations().length`)
}
async function click(selector) {
  if (await evaluate(`document.querySelector('.dockInner')?.dataset.toolbar==='collapsed'`)) await wakeDock()
  const p = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
  await sleep(350)
}
async function key(key) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key })
}
const geometry = `JSON.stringify([...document.querySelectorAll('.tileMedia')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y+scrollY,r.width,r.height]}))`
const visibleReady = `[...document.querySelectorAll('.tileMedia img')].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(i=>i.complete&&i.naturalWidth>0&&getComputedStyle(i).opacity==='1')`

try {
  let tabs
  for (let i = 0; i < 100; i++) {
    try { tabs = await (await fetch('http://127.0.0.1:9237/json')).json(); if (tabs.some(t=>t.type==='page')) break } catch {}
    await sleep(100)
  }
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  socket.addEventListener('message', e => {
    const data = JSON.parse(e.data)
    if (data.id) {
      const p = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) p?.reject(new Error(JSON.stringify(data.error))); else p?.resolve(data.result)
    } else {
      Promise.resolve(listeners.get(data.method)?.(data.params)).catch(e => report.errors.push(e.message))
    }
  })
  await send('Page.enable')
  on('Page.loadEventFired', () => { loads++ })
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  on('Runtime.exceptionThrown', p => report.errors.push(p.exceptionDetails.text))
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__probe={cls:0,shifts:[],requested:0,executed:0,active:new Set(),gl:[]};
    new PerformanceObserver(list=>{for(const e of list.getEntries()){if(!e.hadRecentInput)__probe.cls+=e.value;__probe.shifts.push({value:e.value,recent:e.hadRecentInput})}}).observe({type:'layout-shift',buffered:true});
    const raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=f=>{__probe.requested++;let id=raf(t=>{__probe.active.delete(id);__probe.executed++;f(t)});__probe.active.add(id);return id};
    window.cancelAnimationFrame=id=>{__probe.active.delete(id);cancel(id)};
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){const c=context.call(this,type,...args);if(c&&type==='webgl'){const item={draws:0};__probe.gl.push(item);const draw=c.drawArrays.bind(c);c.drawArrays=(...a)=>{item.draws++;return draw(...a)}}return c};
  ` })

  // Hold every thumbnail request: measure all reserved boxes before any pixels.
  const held = []
  let hold = true
  on('Fetch.requestPaused', async p => {
    if (hold) held.push(p.requestId)
    else await send('Fetch.continueRequest', { requestId: p.requestId })
  })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*media/thumbs/*', resourceType: 'Image' }] })
  await navigate(`${base}/`, 1440, 1400)
  const photos = (await (await fetch(`${base}/api/photos`)).json()).photos
  // Expected ordering is copied from 68e64de^:src/photos.ts, not API order.
  photos.sort((a,b)=>(b.id.startsWith('!')?b.id.slice(1):b.id).localeCompare(a.id.startsWith('!')?a.id.slice(1):a.id,undefined,{numeric:true}))
  await until(`document.querySelectorAll('.tileMedia').length===${photos.length}`)
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.tile')].map(t=>t.dataset.photoId)`),photos.map(p=>p.id))
  await sleep(1200)
  const before = await evaluate(geometry)
  const unloaded = await evaluate(`document.querySelector('.tileMedia img').naturalWidth===0`)
  assert.equal(unloaded, true)
  hold = false
  for (const requestId of held.splice(0)) await send('Fetch.continueRequest', { requestId })
  await until(visibleReady)
  await sleep(700)
  assert.equal(await evaluate(geometry), before, 'Reserved rectangles moved after images loaded')
  assert.equal(await evaluate('__probe.cls'), 0)
  await shot('gallery-first')
  const fullHeight = await evaluate('document.documentElement.scrollHeight')
  let scrollChecks = 0
  for (let y = 0; y < fullHeight; y += 850) {
    await evaluate(`window.scrollTo(0,${y})`)
    await until(visibleReady)
    scrollChecks++
  }
  await evaluate(`window.scrollTo(0,${fullHeight / 2})`)
  await until(visibleReady)
  await shot('gallery-middle')
  await sleep(500)
  const galleryCLS = await evaluate('__probe.cls')
  assert.equal(galleryCLS, 0)
  assert.equal(await evaluate(geometry), before)
  report.checks.gallery = { photos: photos.length, heldImages: true, rectanglesIdentical: true,
    cls: galleryCLS, scrollChecks, visibleBlankTiles: 0 }
  console.log('PASS gallery: CLS=0; rectangles unchanged; full scroll has 0 unloaded visible tiles')
  await send('Fetch.disable')

  // HTTP failure cannot remove or collapse a tile.
  on('Fetch.requestPaused', p => send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 503 }))
  await send('Fetch.enable', { patterns: [{ urlPattern: `*media/thumbs/${encodeURIComponent(photos[0].id)}`, resourceType: 'Image' }] })
  await navigate(`${base}/`)
  await until(`document.querySelectorAll('.tileMedia').length===${photos.length}`)
  await sleep(1500)
  report.checks.failure = await evaluate(`({count:document.querySelectorAll('.tile').length,height:document.querySelector('.tileMedia').getBoundingClientRect().height,cls:__probe.cls})`)
  assert.equal(report.checks.failure.count, photos.length)
  assert.ok(report.checks.failure.height > 0)
  assert.equal(report.checks.failure.cls, 0)
  await send('Fetch.disable')

  // Explicit mixed known dimensions, independent of the real corpus.
  const dims = [[400,300],[300,500],[1000,180],[200,900]]
  const fixture = Array.from({ length: 24 }, (_, i) => ({ ...photos[0], id: `fixture-${i}.svg`, width: dims[i%4][0], height: dims[i%4][1] }))
  on('Fetch.requestPaused', async p => {
    const api = p.request.url.endsWith('/api/photos')
    const i = Number(p.request.url.match(/fixture-(\d+)/)?.[1] || 0)
    const body = api ? JSON.stringify({ photos: fixture }) : `<svg xmlns="http://www.w3.org/2000/svg" width="${fixture[i].width}" height="${fixture[i].height}"><rect width="100%" height="100%" fill="#8c9d82"/></svg>`
    await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: api ? 'application/json' : 'image/svg+xml' }], body: Buffer.from(body).toString('base64') })
  })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api/photos' }, { urlPattern: '*fixture-*' }] })
  report.checks.fixtures = []
  for (const width of [390,700,1400]) {
    await navigate(`${base}/`, width, 900)
    await until('document.querySelectorAll(".tile").length===24')
    const height = await evaluate('document.documentElement.scrollHeight')
    for (let y = 0; y < height; y += 700) {
      await evaluate(`window.scrollTo(0,${y})`)
      await until(visibleReady)
    }
    const cls = await evaluate('__probe.cls')
    assert.equal(cls, 0)
    report.checks.fixtures.push({ width, tiles: 24, cls, blankTiles: 0 })
  }
  await send('Fetch.disable')
  console.log('PASS fixtures: 390/700/1400px; 24 known ratios; CLS=0; 0 blank tiles')

  // Observe the original two-layer crossfade while the web image is withheld.
  const targetId = '!IMG_20260103_160706.jpg'
  const photoURL = `${base}/#/photo/${encodeURIComponent(targetId)}`
  let highRequest
  on('Fetch.requestPaused', p => { highRequest = p.requestId })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*media/web/*', resourceType: 'Image' }] })
  await navigate(photoURL)
  await until(`document.querySelector('.photoImgLow')?.naturalWidth>0`)
  await until(`!!document.querySelector('.photoImgHigh')?.getAttribute('src')`)
  assert.ok(highRequest)
  report.checks.fade = await evaluate(`({lowVisible:getComputedStyle(document.querySelector('.photoImgLow')).opacity,highOpacity:getComputedStyle(document.querySelector('.photoImgHigh')).opacity,background:document.querySelector('.photoBg').style.backgroundImage})`)
  assert.equal(report.checks.fade.lowVisible, '1')
  assert.equal(report.checks.fade.highOpacity, '0')
  await evaluate(`window.__fade=[];new MutationObserver(()=>__fade.push({class:document.querySelector('.photoStage').className,opacity:getComputedStyle(document.querySelector('.photoImgHigh')).opacity})).observe(document.querySelector('.photoStage'),{attributes:true,attributeFilter:['class']})`)
  await send('Fetch.continueRequest', { requestId: highRequest })
  await send('Fetch.disable')
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  await wakeDock()
  await until(`document.querySelector('.dockInner')?.dataset.glass==='webgl'`, 120000)
  await sleep(1500)
  report.checks.fade.stages = await evaluate('__fade')
  report.checks.fade.highFinal = await evaluate(`getComputedStyle(document.querySelector('.photoImgHigh')).opacity`)
  assert.equal(report.checks.fade.highFinal, '1')
  assert.ok(report.checks.fade.stages.some(p => p.class.includes('hiReady')))
  await shot('photo')
  const idle = await evaluate('({requested:__probe.requested,executed:__probe.executed})')
  await sleep(5000)
  report.checks.glass = await evaluate(`({path:document.querySelector('.dockInner').dataset.glass,config:JSON.parse(document.querySelector('.dockInner').dataset.config),requested:__probe.requested-${idle.requested},executed:__probe.executed-${idle.executed},active:__probe.active.size,webglDraws:__probe.gl.reduce((s,c)=>s+c.draws,0)})`)
  assert.equal(report.checks.glass.requested, 0)
  assert.equal(report.checks.glass.executed, 0)
  assert.equal(report.checks.glass.active, 0)
  report.checks.glass.snapshotWidth = await evaluate(`(async()=>{const image=new Image();image.src=getComputedStyle(document.querySelector('.dockInner')).backgroundImage.slice(5,-2);await image.decode();return image.naturalWidth})()`)
  assert.ok(report.checks.glass.snapshotWidth > 0)
  console.log('PASS glass snapshot lifecycle: idle 5s requested=0 executed=0 active=0; refraction separately checked by verify-glass.mjs')

  const labels = [await evaluate(`document.querySelector('.dockLeft button:nth-child(2)').textContent`)]
  for (let i = 0; i < 3; i++) {
    await click('.dockLeft button:nth-child(2)')
    labels.push(await evaluate(`document.querySelector('.dockLeft button:nth-child(2)').textContent`))
  }
  assert.equal(labels.at(-1), '比例：适应')
  report.checks.fit = { landscape: labels, note: 'Legacy skips the mode redundant under contain' }
  const initialZoom = await evaluate(`document.querySelector('.photoZoom').style.transform`)
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: -700 })
  await sleep(350)
  const wheelZoom = await evaluate(`document.querySelector('.photoZoom').style.transform`)
  assert.notEqual(wheelZoom, initialZoom)
  const panBefore = await evaluate(`document.querySelector('.photoPan').style.transform`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 450, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 500, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 500, button: 'left', clickCount: 1 })
  const panAfter = await evaluate(`document.querySelector('.photoPan').style.transform`)
  assert.notEqual(panBefore, panAfter)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const pinchBefore = await evaluate(`document.querySelector('.photoZoom').style.transform`)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y: 450, id: 1 }, { x: 800, y: 450, id: 2 }] })
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 400, y: 450, id: 1 }, { x: 900, y: 450, id: 2 }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(350)
  const pinchAfter = await evaluate(`document.querySelector('.photoZoom').style.transform`)
  assert.notEqual(pinchBefore, pinchAfter)
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  report.checks.gestures = { wheel: [initialZoom, wheelZoom], drag: [panBefore,panAfter], pinch: [pinchBefore,pinchAfter] }

  const index = photos.findIndex(p => p.id === targetId)
  await key('ArrowRight')
  await until(`location.hash==='#/photo/${encodeURIComponent(photos[index+1].id)}'&&document.querySelector('.photoImgHigh')?.src.endsWith('/${encodeURIComponent(photos[index+1].id)}')&&document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  await key('ArrowLeft')
  await until(`location.hash==='#/photo/${encodeURIComponent(targetId)}'&&document.querySelector('.photoImgHigh')?.src.endsWith('/${encodeURIComponent(targetId)}')&&document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  await key('Escape')
  await until(`location.hash==='#/'&&document.querySelectorAll('.tile').length===${photos.length}`)
  report.checks.keyboard = { right: true, left: true, escape: true }
  console.log('PASS photo: low/high fade; legacy fit cycle; wheel; drag; two-finger pinch; arrows; Esc')

  const wide = photos.find(p=>p.width/p.height>2)
  await navigate(`${base}/#/photo/${encodeURIComponent(wide.id)}`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const wideLabels = [await evaluate(`document.querySelector('.dockLeft button:nth-child(2)').textContent`)]
  for (let i=0;i<3;i++) {
    await click('.dockLeft button:nth-child(2)')
    wideLabels.push(await evaluate(`document.querySelector('.dockLeft button:nth-child(2)').textContent`))
  }
  assert.equal(wideLabels.at(-1),'比例：适应')
  report.checks.fit.wide = wideLabels
  assert.equal(new Set([...labels,...wideLabels]).size,4)

  await navigate(photoURL)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const downloads = path.join(out, 'downloads')
  await mkdir(downloads,{recursive:true})
  const existing = new Set(await readdir(downloads))
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await click('.dockRight button')
  let download
  for(let i=0;i<200;i++) {
    download=(await readdir(downloads)).find(f=>!existing.has(f)&&f.endsWith('.jpg'))
    if(download)break
    await sleep(100)
  }
  assert.ok(download,'Desktop did not download a JPEG')
  const meta=await sharp(path.join(downloads,download)).metadata()
  const target=photos.find(p=>p.id===targetId)
  assert.equal(meta.width,target.width+192)
  assert.equal(meta.height,target.height+192)
  const stamp=await sharp(path.join(downloads,download)).extract({left:meta.width/2-400,top:meta.height-70,width:800,height:40}).raw().toBuffer()
  let dark=0
  for(let i=0;i<stamp.length;i+=3)if(stamp[i]<150&&stamp[i+1]<150&&stamp[i+2]<150)dark++
  assert.ok(dark>100,'No dark stamp glyphs found in the light border')
  report.checks.download={file:download,width:meta.width,height:meta.height,originalWidth:target.width,originalHeight:target.height,border:96,stampPixels:dark}

  // Emulated mobile verifies the fallback and File passed to Web Share.
  // Headless Chrome cannot verify the operating system's album/share sheet.
  await send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36'})
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
  await navigate(photoURL,390,844)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  await evaluate(`Object.defineProperty(navigator,'share',{configurable:true,value:undefined})`)
  await click('.dockRight button')
  await until(`document.querySelector('.saveOverlayImg')?.naturalWidth>0`)
  report.checks.mobileFallback=await evaluate(`({width:document.querySelector('.saveOverlayImg').naturalWidth,height:document.querySelector('.saveOverlayImg').naturalHeight,hint:document.querySelector('.saveOverlayHint').textContent})`)
  assert.equal(report.checks.mobileFallback.width,meta.width)
  await shot('mobile-save-fallback')
  await key('Escape')
  await until(`!document.querySelector('.saveOverlay')`)
  assert.equal(await evaluate('location.hash'), `#/photo/${encodeURIComponent(targetId)}`)
  report.checks.mobileFallback.escapeClosesWithoutNavigating = true
  await evaluate(`Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.__shared={count:files.length,type:files[0].type,size:files[0].size,name:files[0].name}}})`)
  await click('.dockRight button')
  await until(`!!window.__shared`)
  report.checks.webShare={...(await evaluate('__shared')),mode:'emulated navigator.share; OS album not tested'}
  assert.equal(report.checks.webShare.count,1)
  assert.equal(report.checks.webShare.type,'image/jpeg')
  await send('Emulation.setTouchEmulationEnabled',{enabled:false})
  await send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36'})
  console.log('PASS download: original-resolution JPEG + 96px matte + stamp; mobile fallback; Web Share File (emulated)')

  // CSS fallback, including preference changes during an existing route.
  await navigate(photoURL)
  await wakeDock()
  await until(`document.querySelector('.dockInner')?.dataset.glass==='webgl'`, 120000)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await until(`document.querySelector('.dockInner')?.dataset.glass==='css'&&document.querySelectorAll('.dockInner canvas').length===0`)
  report.checks.reducedMotion = await evaluate(`({path:document.querySelector('.dockInner').dataset.glass,transition:getComputedStyle(document.querySelector('.photoImgHigh')).transitionDuration})`)
  await shot('photo-reduced-motion')
  assert.equal(report.checks.reducedMotion.transition, '0s')
  await send('Emulation.setEmulatedMedia', { features: [] })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:get.call(this,type,...args)}` })
  await navigate(`${base}/?verify-no-webgl=1#/photo/${encodeURIComponent(targetId)}`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  report.checks.noWebGL = await evaluate(`({path:document.querySelector('.dockInner').dataset.glass,backdrop:getComputedStyle(document.querySelector('.dockInner')).backdropFilter,buttons:document.querySelectorAll('.dockInner button').length})`)
  assert.equal(report.checks.noWebGL.path, 'css')
  assert.equal(report.checks.noWebGL.buttons, 3)
  console.log('PASS fallback: reduced motion removes renderer; unavailable WebGL retains CSS controls')

  // Exact legacy source was built before old dependencies were removed.
  referenceServer = createServer(async (req, res) => {
    try {
      const uri = decodeURIComponent((req.url || '/').split('?')[0])
      let file = path.join(out, 'reference/dist', uri === '/' ? 'index.html' : uri)
      if (uri.startsWith('/images/')) {
        const rel = uri.slice('/images/'.length)
        file = path.join(out, 'library', rel.startsWith('thumbs/') ? rel : `originals/${rel}`)
      }
      const bytes = await readFile(file)
      const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.jpg':'image/jpeg' }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
      res.end(bytes)
    } catch { res.statusCode = 404; res.end() }
  })
  await new Promise(resolve => referenceServer.listen(5174, '127.0.0.1', resolve))
  await navigate('http://127.0.0.1:5174/', 1440, 1400)
  await until(`document.querySelectorAll('.tile').length===${photos.length}`)
  const referenceHeight = await evaluate('document.documentElement.scrollHeight')
  // Old layout changes as loading proceeds: revisit until every tile is ready.
  for (let pass=0;pass<3;pass++) {
    for (let y=0;y<referenceHeight+10000;y+=900) { await evaluate(`scrollTo(0,${y})`); await sleep(100) }
    if (await evaluate(`[...document.querySelectorAll('.tile')].every(t=>t.classList.contains('isReady'))`)) break
  }
  await until(`[...document.querySelectorAll('.tile')].every(t=>t.classList.contains('isReady'))`)
  await evaluate('scrollTo(0,0)')
  await sleep(500)
  await shot('reference-gallery-first')
  await evaluate('scrollTo(0,document.documentElement.scrollHeight/2)')
  await sleep(300)
  await shot('reference-gallery-middle')
  await navigate(`http://127.0.0.1:5174/#/photo/${encodeURIComponent(targetId)}`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  await sleep(700)
  await shot('reference-photo')

  assert.deepEqual(report.errors, [], 'Unexpected browser exceptions')
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = error.stack
  console.error(error.stack)
  process.exitCode = 1
} finally {
  await writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2))
  socket?.close()
  referenceServer?.close()
  browser.kill()
  console.log(`Evidence: ${path.join(out, 'results.json')}`)
}

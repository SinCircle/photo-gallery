import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('performance-sweep/details', 9334)
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const id = 'IMG_20260815_153938.jpg'
const report = { errors: b.errors }
let mode = 'allow', held = []
b.on('Fetch.requestPaused', event => {
  const original = event.request.url.includes('/media/originals/')
  if (mode === 'hold' && original) held.push(event.requestId)
  else if (mode === 'fail-all' || mode === 'fail-web' && !original) {
    void b.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 503, body: '' })
  } else void b.send('Fetch.continueRequest', { requestId: event.requestId })
})
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.fboAllocations=0;
  const allocate=WebGLRenderingContext.prototype.createFramebuffer;
  WebGLRenderingContext.prototype.createFramebuffer=function(){fboAllocations++;return allocate.call(this)};
` })
const ready = () => b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockBar').hasAttribute('data-loading') && !document.querySelector('.dockInner')?.dataset.moving`)
try {
  await b.send('Fetch.enable', { patterns: [{urlPattern:'*/media/web/*',requestStage:'Request'},{urlPattern:'*/media/originals/*',requestStage:'Request'}] })
  mode = 'hold'
  await b.navigate(base + '/?quality=normal#/photo/' + id)
  await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
  report.initial = await b.evaluate(`({src:document.querySelector('.photoImgHigh').currentSrc,width:document.querySelector('.photoImgHigh').naturalWidth,loading:document.querySelector('.dockBar').hasAttribute('data-loading'),downloadBusy:document.querySelector('.dockDownload').hasAttribute('aria-busy'),originals:performance.getEntriesByType('resource').filter(r=>r.name.includes('/media/originals/')).length,fboAllocations})`)
  assert.ok(report.initial.src.includes('/media/web/'))
  assert.equal(report.initial.originals, 0)
  assert.equal(report.initial.loading, true)
  assert.equal(report.initial.downloadBusy, true)
  assert.ok(report.initial.fboAllocations <= 9, 'Capsule morph must reuse its framebuffer surfaces')

  for (let i=0; i<30 && !held.length; i++) await sleep(100)
  assert.ok(held.length, 'The original must start automatically after the preview')
  await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:720, y:450, deltaX:0, deltaY:-650 })
  await b.until(`document.querySelector('.dockFit').textContent==='比例：自由'`)
  for (let i=0; i<30 && !held.length; i++) await sleep(100)
  assert.ok(held.length, 'Zoom must request original pixels')
  assert.ok((await b.evaluate(`document.querySelector('.photoImgHigh').currentSrc`)).includes('/media/web/'), 'Keep display image while original is pending')
  for (const requestId of held) await b.send('Fetch.continueRequest', { requestId })
  held=[]; mode='allow'
  await b.until(`document.querySelector('.photoImgHigh').currentSrc.includes('/media/originals/')`)
  await ready()
  report.zoom = await b.evaluate(`({width:document.querySelector('.photoImgHigh').naturalWidth,src:document.querySelector('.photoImgHigh').currentSrc})`)
  assert.ok(report.zoom.width > report.initial.width)

  // A missing derivative recovers through the original; a complete failure
  // releases controls, retains the thumbnail, and offers a working retry.
  mode = 'fail-web'
  await b.navigate(base + '/?quality=fallback#/photo/' + id)
  await ready()
  report.derivativeFallback = await b.evaluate(`document.querySelector('.photoImgHigh').currentSrc`)
  assert.ok(report.derivativeFallback.includes('/media/originals/'))
  mode = 'fail-all'
  await b.navigate(base + '/?quality=failed#/photo/' + id)
  await b.until(`document.querySelector('.photoStatus')?.hidden===false && !document.querySelector('.dockBar').hasAttribute('data-loading')`)
  report.failed = await b.evaluate(`({preview:document.querySelector('.photoImgLow').naturalWidth,previewVisible:getComputedStyle(document.querySelector('.photoImgLow')).visibility,high:document.querySelector('.photoImgHigh').currentSrc,notice:document.querySelector('.photoStatus').textContent})`)
  assert.ok(report.failed.preview > 0)
  assert.equal(report.failed.previewVisible, 'visible')
  mode='allow'
  await b.evaluate(`document.querySelector('.photoStatus button').click()`)
  await ready()
  assert.equal(await b.evaluate(`document.querySelector('.photoStatus').hidden`), true)
  report.retry = true
  await b.shot('recovered')

  // Settled scenes sleep; transforms and cancelled transitions wake/settle them.
  await b.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:20,y:20})
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').dataset.moving`)
  await sleep(200)
  await b.evaluate(`window.beforeIdle={raf:__metrics.executed,draws:__metrics.draws};window.inkUpdates=0;document.addEventListener('dockink',()=>inkUpdates++)`)
  await sleep(700)
  report.idle = await b.evaluate(`({raf:__metrics.executed-beforeIdle.raf,draws:__metrics.draws-beforeIdle.draws})`)
  assert.deepEqual(report.idle, {raf:0,draws:0})
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:450,deltaX:0,deltaY:-200})
  await b.until(`inkUpdates>1`)
  await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:720,y:450,button:'left',clickCount:1})
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:750,y:460,buttons:1})
  await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:750,y:460,button:'left',clickCount:1})
  await sleep(1700)
  await b.evaluate(`beforeIdle={raf:__metrics.executed,draws:__metrics.draws}`)
  await sleep(700)
  report.afterInteraction = await b.evaluate(`({raf:__metrics.executed-beforeIdle.raf,draws:__metrics.draws-beforeIdle.draws,inkUpdates})`)
  assert.equal(report.afterInteraction.raf, 0)

  // Twenty route cycles include pending image aborts. Garbage-collect both
  // measurements so detached views are not confused with reclaimable objects.
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await b.evaluate(`location.hash='#/'`)
  await b.until(`document.querySelector('.tile') && !document.querySelector('.photoShell')`)
  await sleep(500)
  await b.send('HeapProfiler.collectGarbage')
  report.beforeCycles = await b.send('Memory.getDOMCounters')
  for(let i=0;i<20;i++) {
    await b.evaluate(`[...document.querySelectorAll('.tile')].find(t=>t.dataset.photoId===${JSON.stringify(id)}).click()`)
    await b.until(`document.querySelector('.photoShell') && !document.querySelector('.photoShell').hasAttribute('data-entering')`)
    if (i%5===0) await ready()
    await b.evaluate(`location.hash='#/'`)
    await b.until(`document.querySelector('.tile') && !document.querySelector('.photoShell')`)
  }
  await sleep(500)
  await b.send('HeapProfiler.collectGarbage')
  report.afterCycles = await b.send('Memory.getDOMCounters')
  report.cleanup = await b.evaluate(`({canvases:document.querySelectorAll('[data-glass-scene],[data-glass-output]').length,animations:document.getAnimations().length,transition:document.documentElement.dataset.photoTransition,raf:__metrics.active.size})`)
  assert.equal(report.cleanup.canvases,0)
  assert.equal(report.cleanup.animations,0)
  assert.equal(report.cleanup.raf,0)
  assert.ok(report.afterCycles.jsEventListeners <= report.beforeCycles.jsEventListeners + 8, 'Route handlers must not accumulate')
  assert.ok(report.afterCycles.nodes <= report.beforeCycles.nodes + 30, 'Detached photo nodes must be released')
  assert.deepEqual(b.errors,[])
  report.status='passed'
  console.log(JSON.stringify(report))
} catch(error) { report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error) }
finally { await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close() }

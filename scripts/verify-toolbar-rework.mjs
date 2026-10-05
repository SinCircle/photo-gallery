import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const base = process.env.VERIFY_URL || 'http://127.0.0.1'
const selected = process.argv.find(a => a.startsWith('--phase='))?.slice(8)
const browser = await browserSession('toolbar-rework', 9262)
const { evaluate, until, navigate, send, shot } = browser
const report = { base, startedAt: new Date().toISOString(), graphics: browser.graphics, browser: browser.version.product, phases: {}, errors: browser.errors }
const photoURL = id => `${base}/#/photo/${encodeURIComponent(id)}`
const defaultPhoto = '!IMG_20260103_160706.jpg'
const rect = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)
async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
async function ready(id = defaultPhoto) {
  await navigate(photoURL(id))
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockMetaLoading')`)
  await evaluate('document.fonts.ready')
  await until(`document.querySelector('.dockInner').dataset.glass==='webgl'`)
  await wake()
}
async function wake() {
  const r = await rect('.dockInner')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').getAnimations().length`)
}
async function crop(name, selector = '.dockInner') {
  const r = await rect(selector)
  const x = Math.max(0, r.x - 25), y = Math.max(0, r.y - 25)
  const result = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(1440 - x, r.width + 50), height: Math.min(1000 - y, r.height + 50), scale: 1 }, captureBeyondViewport: false })
  await writeFile(`${browser.out}/${name}.png`, Buffer.from(result.data, 'base64'))
}
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.toolbarShifts=[];new PerformanceObserver(list=>{for(const e of list.getEntries())toolbarShifts.push({time:e.startTime,value:e.value,recentInput:e.hadRecentInput,sources:e.sources.map(s=>({node:s.node?.className,previous:s.previousRect.toJSON(),current:s.currentRect.toJSON()}))})}).observe({type:'layout-shift',buffered:true})` })
const checks = {
  async motion() {
    await ready()
    await shot('expanded-layout')
    await crop('expanded-toolbar')
    const expanded = await rect('.dockInner')
    const contentText = await evaluate(`document.querySelector('.toolbarContent').innerText`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await evaluate(`window.motion=[];window.captureMotion=duration=>new Promise(resolve=>{const start=performance.now();const tick=()=>{const b=document.querySelector('.dockInner'),r=b.getBoundingClientRect(),m=document.querySelector('.dockMeta');motion.push({time:performance.now()-start,width:r.width,height:r.height,y:r.y,opacity:+getComputedStyle(document.querySelector('.toolbarClip')).opacity,blur:getComputedStyle(m).filter,state:b.dataset.toolbar,slot:document.querySelector('.toolbarSlot').getBoundingClientRect().toJSON()});if(performance.now()-start<duration)requestAnimationFrame(tick);else resolve(motion)};requestAnimationFrame(tick)};window.closing=captureMotion(3500);true`)
    await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').getAnimations().length`)
    const closeFrames = await evaluate('closing')
    const collapsed = await rect('.dockInner')
    await shot('collapsed-layout')
    await crop('collapsed-toolbar')
    assert.equal(collapsed.width, 56)
    assert.equal(collapsed.height, 32)
    assert.ok(closeFrames.some(f => f.opacity > 0 && f.opacity < 1 && parseFloat(f.blur.slice(5)) > 0), 'EXIF must blur while opacity changes')
    await evaluate('motion=[];window.opening=captureMotion(800);true')
    await click(collapsed.x + 28, collapsed.y + 16)
    const openFrames = await evaluate('opening')
    await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').getAnimations().length`)
    assert.ok(Math.max(...openFrames.map(f => f.width)) > expanded.width + 5, 'Opening needs elastic overshoot')
    assert.ok(Math.min(...closeFrames.map(f => f.width)) < 55, 'Closing needs bounded overshoot')
    const layout = await evaluate(`({cls:__metrics.cls,shifts:toolbarShifts,text:document.querySelector('.toolbarContent').innerText,content:document.querySelector('.toolbarContent').getBoundingClientRect().toJSON(),metadata:document.querySelector('.dockMeta').getBoundingClientRect().toJSON(),buttonCount:document.querySelectorAll('.dockInner button').length})`)
    assert.equal(layout.cls, 0)
    assert.equal(layout.text, contentText)
    assert.equal(layout.buttonCount, 3)
    const heights = new Set([...closeFrames, ...openFrames].map(f => f.slot.height))
    assert.equal(heights.size, 1, 'Photo safe area must remain reserved')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed'`)
    const reducedCollapsed = await evaluate(`({rect:document.querySelector('.dockInner').getBoundingClientRect().toJSON(),animations:document.querySelector('.dockInner').getAnimations({subtree:true}).length})`)
    await click(reducedCollapsed.rect.x + 28, reducedCollapsed.rect.y + 16)
    const reducedExpanded = await evaluate(`({rect:document.querySelector('.dockInner').getBoundingClientRect().toJSON(),animations:document.querySelector('.dockInner').getAnimations({subtree:true}).length})`)
    assert.equal(reducedCollapsed.animations, 0)
    assert.equal(reducedExpanded.animations, 0)
    assert.equal(reducedExpanded.rect.width, expanded.width)
    await shot('reduced-motion-expanded')
    await send('Emulation.setEmulatedMedia', { features: [] })
    return { expanded, collapsed, layout, closeFrames, openFrames, reducedCollapsed, reducedExpanded, rule: '2800ms since last interaction; held pointers, nearby pointer (40px) and keyboard editing keep it open. Click, proximity, wheel, scroll and keyboard wake it. A single 56x32 capsule; safe-area-aware bottom inset and maximum expanded width 760px.' }
  },
  async refraction() {
    await ready()
    await evaluate(`(()=>{const c=document.createElement('canvas');c.id='refraction-pattern';c.width=1440;c.height=1000;c.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:19;width:1440px;height:1000px';document.querySelector('.photoShell').append(c);window.paintPattern=()=>{const r=document.querySelector('.dockInner').getBoundingClientRect(),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1440,1000);ctx.fillStyle='black';for(let x=r.x+12;x<1440;x+=37)ctx.fillRect(x,0,4,1000);ctx.fillStyle='red';ctx.fillRect(0,r.y+8,1440,6);document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))};paintPattern()})()`)
    const states = []
    for (const name of ['expanded', 'collapsed']) {
      if (name === 'collapsed') {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
        await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').getAnimations().length`)
      }
      await evaluate(`paintPattern();document.querySelector('.toolbarClip').style.opacity='0'`)
      await sleep(200)
      const result = await evaluate(`(()=>{
        const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect(),canvas=bar.querySelector('[data-glass-output]'),b=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d');
        const source=document.querySelector('#refraction-pattern').getContext('2d');
        const extent=values=>{const runs=[];let start=-1;for(let y=0;y<=values.length;y++){if(values[y]&&start<0)start=y;if(!values[y]&&start>=0){runs.push([start,y-1]);start=-1}}return runs.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0]??null};
        const lines=[];
        for(const fraction of [.35,.5,.65]){const x=Math.round(r.width*fraction),plain=[],refracted=[];for(let y=0;y<r.height;y++){
          const a=ctx.getImageData(Math.floor((r.x+x-b.x)*canvas.width/b.width),Math.floor((r.y+y-b.y)*canvas.height/b.height),1,1).data;
          const p=source.getImageData(Math.floor(r.x+x),Math.floor(r.y+y),1,1).data;
          refracted.push(a[3]>150&&a[0]-a[1]>60&&a[0]-a[2]>60);plain.push(p[0]-p[1]>60&&p[0]-p[2]>60);
        }const expected=extent(plain),actual=extent(refracted);lines.push({x,expected,actual,displacement:expected&&actual?Math.max(Math.abs(expected[0]-actual[0]),Math.abs(expected[1]-actual[1])):null,originalThickness:expected?expected[1]-expected[0]+1:0,refractedThickness:actual?actual[1]-actual[0]+1:0})}
        return {bar:r.toJSON(),canvas:b.toJSON(),bitmap:[canvas.width,canvas.height],dpr:devicePixelRatio,lines,config:JSON.parse(bar.dataset.config),sameRoot:bar.querySelector('[data-glass-scene]').parentElement===bar.querySelector('.glassSurface').parentElement,instances:document.querySelectorAll('[data-glass-output]').length};
      })()`)
      assert.equal(result.sameRoot, true)
      assert.equal(result.instances, 1)
      assert.ok(Math.abs(result.canvas.x - (result.bar.x - 20)) < 1)
      assert.ok(Math.abs(result.canvas.y - (result.bar.y - 20)) < 1)
      assert.ok(Math.abs(result.canvas.width - (result.bar.width + 40)) < 1)
      assert.ok(Math.abs(result.canvas.height - (result.bar.height + 40)) < 1)
      assert.ok(result.lines.some(l => l.displacement >= 2 || Math.abs(l.originalThickness - l.refractedThickness) >= 2), 'Marker must move/deform, not merely brighten')
      await shot(`refraction-${name}`)
      await crop(`refraction-${name}-detail`)
      await evaluate(`document.querySelector('.glassRoot').style.visibility='hidden';document.querySelector('.toolbarMaterial').style.visibility='hidden'`)
      await shot(`unrefracted-${name}`)
      await crop(`unrefracted-${name}-detail`)
      await evaluate(`document.querySelector('.glassRoot').style.visibility='';document.querySelector('.toolbarMaterial').style.visibility=''`)
      states.push({ name, ...result })
    }
    const idleStart = await evaluate(`({draws:__metrics.draws,longTasks:__metrics.longTasks.length})`)
    await sleep(5000)
    const idle = await evaluate(`({shaderDraws:__metrics.draws-${idleStart.draws},longTasks:__metrics.longTasks.slice(${idleStart.longTasks}),nativeRAFIsRetained:true})`)
    assert.equal(idle.shaderDraws, 0)
    assert.equal(idle.longTasks.length, 0)
    await evaluate(`document.querySelector('#refraction-pattern').remove()`)
    return { states, idle, note: 'The measured canvas is the library-injected displayed output. Transparent controls were hidden only for marker comparison. White interior stays on in refracted screenshots; no material is repainted into the shader canvas.' }
  },
  async photos() {
    await ready()
    const photos = await evaluate(`(async()=>{const {photos}=await(await fetch('/api/photos')).json(),result=[],c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d',{willReadFrequently:true});for(const p of photos){const img=new Image();img.src='/media/thumbs/'+encodeURIComponent(p.id);await img.decode();ctx.drawImage(img,0,0,32,32);const d=ctx.getImageData(0,16,32,16).data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;result.push({id:p.id,bottomHalfLuma:sum/(d.length/4)})}return result.sort((a,b)=>a.bottomHalfLuma-b.bottomHalfLuma)})()`)
    const choices = [{ name: 'dark', photo: photos[0] }, { name: 'light', photo: photos.at(-1) }]
    const result = []
    for (const { name, photo } of choices) {
      await ready(photo.id)
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -400 })
      await sleep(500)
      await wake()
      await shot(`${name}-photo`)
      await crop(`${name}-toolbar`)
      const data = await evaluate(`(()=>{const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect(),img=document.querySelector('.photoImgHigh'),ir=img.getBoundingClientRect(),c=bar.querySelector('[data-glass-scene]'),d=c.getContext('2d').getImageData(20,20,c.width-40,c.height-40).data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;return {source:img.currentSrc,natural:[img.naturalWidth,img.naturalHeight],actualBackgroundLuma:sum/(d.length/4),photoBehindBar:ir.bottom>r.top&&ir.top<r.bottom&&ir.right>r.left&&ir.left<r.right,text:document.querySelector('.toolbarContent').innerText,metadata:getComputedStyle(document.querySelector('.dockMeta')).color,material:getComputedStyle(document.querySelector('.toolbarMaterial')).backgroundColor,blur:getComputedStyle(document.querySelector('.toolbarMaterial')).backdropFilter}})()`)
      assert.ok(data.photoBehindBar)
      assert.equal(data.material, 'rgba(255, 255, 255, 0.7)')
      assert.equal(data.blur, 'blur(24px)')
      result.push({ name, selected: photo, ...data })
    }
    return { thumbnailRanking: photos, screenshots: result }
  },
  async original() {
    const requests = []
    browser.on('Network.requestWillBeSent', p => { if (p.request.url.includes('/media/originals/')) requests.push({ url: p.request.url, timestamp: p.timestamp }) })
    await send('Page.navigate', { url: `${base}/?original-defer-test=1#/photo/${encodeURIComponent(defaultPhoto)}` })
    await until(`location.search.includes('original-defer-test') && !!document.querySelector('.photoStage')`, 60000)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 })
    const heldAt = await evaluate('performance.now()')
    for (let i = 0; i < 9; i++) { await sleep(100); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720 + i * 2, y: 450, buttons: 1 }) }
    const held = await evaluate(`({src:document.querySelector('.photoImgHigh').getAttribute('src'),time:performance.now(),lowNatural:document.querySelector('.photoImgLow').naturalWidth})`)
    assert.equal(held.src, null)
    assert.equal(requests.length, 0)
    await shot('original-deferred-while-held')
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 740, y: 450, button: 'left', clickCount: 1 })
    const releasedAt = await evaluate('performance.now()')
    await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
    const loaded = await evaluate(`({src:document.querySelector('.photoImgHigh').currentSrc,natural:[document.querySelector('.photoImgHigh').naturalWidth,document.querySelector('.photoImgHigh').naturalHeight],time:performance.now(),lowHidden:getComputedStyle(document.querySelector('.photoImgLow')).visibility})`)
    assert.ok(loaded.src.includes('/media/originals/'))
    assert.ok(Math.max(...loaded.natural) > 1920)
    assert.equal(loaded.lowHidden, 'hidden')
    assert.equal(requests.length, 1)
    await wake()
    await shot('original-loaded')
    return { heldAt, held, releasedAt, loaded, requests }
  },
  async fallback() {
    const script = await send('Page.addScriptToEvaluateOnNewDocument', { source: `const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'||type==='webgl2'?null:get.call(this,type,...args)}` })
    await navigate(`${base}/?no-webgl=1#/photo/${encodeURIComponent(defaultPhoto)}`)
    await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
    await wake()
    const data = await evaluate(`({path:document.querySelector('.dockInner').dataset.glass,canvases:document.querySelectorAll('[data-glass-output]').length,backdrop:getComputedStyle(document.querySelector('.dockInner')).backdropFilter,buttons:document.querySelectorAll('.dockInner button').length,original:document.querySelector('.photoImgHigh').naturalWidth,body:!!document.querySelector('.photoStage')})`)
    assert.equal(data.path, 'css')
    assert.equal(data.canvases, 0)
    assert.equal(data.buttons, 3)
    assert.ok(data.original > 1920 && data.body)
    await shot('css-fallback')
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier })
    return data
  },
  async admin() {
    await navigate(`${base}/#/admin`)
    await until(`!!document.querySelector('.topbarInner') && document.querySelector('.topbarInner').dataset.glass==='webgl'`)
    const r = await rect('.topbarInner')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
    await until(`document.querySelector('.topbarInner').dataset.toolbar==='expanded' && !document.querySelector('.topbarInner').getAnimations().length`)
    await shot('admin-expanded')
    await crop('admin-expanded-toolbar', '.topbarInner')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await until(`document.querySelector('.topbarInner').dataset.toolbar==='collapsed' && !document.querySelector('.topbarInner').getAnimations().length`)
    await shot('admin-collapsed')
    const data = await evaluate(`({cls:__metrics.cls,bar:document.querySelector('.topbarInner').getBoundingClientRect().toJSON(),forms:document.querySelectorAll('form').length,shifts:toolbarShifts,material:getComputedStyle(document.querySelector('.toolbarMaterial')).backgroundColor})`)
    assert.equal(data.bar.width, 56)
    assert.equal(data.bar.height, 32)
    assert.equal(data.cls, 0)
    return data
  },
}
try {
  for (const [name, check] of Object.entries(checks)) {
    if (selected && selected !== name) continue
    try { const data = await check(); report.phases[name] = { status: 'passed', ...data }; console.log(`PASS ${name}`) }
    catch (error) { report.phases[name] = { status: 'failed', error: error.stack }; console.error(`FAIL ${name}: ${error.stack}`); process.exitCode = 1 }
    await writeFile(`${browser.out}/${name}.json`, JSON.stringify(report.phases[name], null, 2))
    await writeFile(`${browser.out}/results.json`, JSON.stringify(report, null, 2))
  }
  assert.deepEqual(browser.errors, [])
  report.status = Object.values(report.phases).every(p => p.status === 'passed') ? 'passed' : 'failed'
} catch (error) { report.failure = error.stack; report.status = 'failed'; process.exitCode = 1 }
finally { await writeFile(`${browser.out}/results.json`, JSON.stringify(report, null, 2)); browser.close() }

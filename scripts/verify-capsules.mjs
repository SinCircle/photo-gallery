import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const base = process.env.VERIFY_URL || 'http://127.0.0.1:5176'
const selected = process.argv.find(a => a.startsWith('--phase='))?.slice(8)
const b = await browserSession('capsules', 9274)
const { evaluate, send, navigate, until, shot } = b
const report = { base, startedAt: new Date().toISOString(), browser: b.version.product, graphics: b.graphics, phases: {}, errors: b.errors }
const defaultPhoto = '!IMG_20260103_160706.jpg'
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.usedGlassContexts=new Set();const gc=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){const ctx=gc.call(this,t,...a);if(t==='webgl'&&ctx&&!ctx.__counted){ctx.__counted=true;const draw=ctx.drawArrays.bind(ctx);ctx.drawArrays=(...args)=>{usedGlassContexts.add(this);return draw(...args)}}return ctx};window.layoutShifts=[];new PerformanceObserver(list=>{for(const e of list.getEntries())layoutShifts.push({time:e.startTime,value:e.value,recentInput:e.hadRecentInput})}).observe({type:'layout-shift',buffered:true})` })
async function rect(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`) }
async function ready(id = defaultPhoto) {
  await navigate(`${base}/?capsules=${encodeURIComponent(id)}#/photo/${encodeURIComponent(id)}`)
  await until(`document.querySelector('.photoImgHigh')?.currentSrc===new URL('/media/originals/'+${JSON.stringify(encodeURIComponent(id))},location.origin).href && document.querySelector('.photoStage')?.classList.contains('hiDone') && document.querySelector('.dockInner')?.dataset.glass==='webgl' && !document.querySelector('.dockMetaLoading')`)
  await evaluate('document.fonts.ready')
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 300, deltaX: 0, deltaY: 1 })
  const r = await rect('[data-glass-capsule="exif"]')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 20, y: r.y + 18 })
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
}
async function click(r) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1 })
}
async function crop(name) {
  const r = await rect('.dockInner')
  const data = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 24), width: Math.min(r.width + 48, await evaluate('innerWidth') - Math.max(0, r.x - 24)), height: Math.min(r.height + 48, await evaluate('innerHeight') - Math.max(0, r.y - 24)), scale: 1 } })
  await writeFile(`${b.out}/${name}.png`, Buffer.from(data.data, 'base64'))
}
const snapshot = `(()=>{const root=document.querySelector('.dockInner');return {state:root.dataset.toolbar,root:root.getBoundingClientRect().toJSON(),slot:root.parentElement.getBoundingClientRect().toJSON(),cls:__metrics.cls,contexts:usedGlassContexts.size,items:[...root.querySelectorAll(':scope > [data-glass-capsule]')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {name:e.dataset.glassCapsule,rect:r.toJSON(),visible:s.visibility!=='hidden'&&+s.opacity>.01,opacity:+s.opacity,translate:s.translate,border:s.borderWidth,config:JSON.parse(e.dataset.config),direct:e.parentElement===root,canvas:!!e.querySelector(':scope > canvas[data-glass-output]'),inert:e.inert}})}})()`
function noOverlap(data) {
  const items = data.items.filter(x => x.visible)
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].rect, c = items[j].rect
    assert.ok(Math.min(a.right, c.right) - Math.max(a.left, c.left) <= .5 || Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) <= .5, `${items[i].name}/${items[j].name} overlap`)
  }
}
const checks = {
  async structure() {
    const screens = []
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 740]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await ready()
      const data = await evaluate(snapshot)
      noOverlap(data)
      assert.equal(data.contexts, 1)
      assert.equal(data.items.length, 5)
      assert.deepEqual(data.items.filter(x => x.visible).map(x => x.name), ['exif', 'back', 'fit', 'download'])
      assert.ok(data.items.every(x => x.direct && x.canvas && x.border === '0px'))
      assert.ok(data.items.filter(x => x.visible).every(x => x.rect.left >= 0 && x.rect.right <= width))
      assert.equal(data.cls, 0)
      await shot(`capsules-${width}`)
      await crop(`capsules-${width}-detail`)
      screens.push({ width, height, ...data })
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    return { screens }
  },
  async material() {
    await ready()
    await evaluate(`(()=>{const c=document.createElement('canvas');c.id='material-fixture';c.width=1440;c.height=1000;c.style.cssText='position:fixed;inset:0;z-index:19;pointer-events:none';document.querySelector('.photoShell').append(c);window.paintMaterial=step=>{const r=document.querySelector('[data-glass-capsule="exif"]').getBoundingClientRect(),ctx=c.getContext('2d');ctx.fillStyle=step?'rgb(20,20,20)':'rgb(128,128,128)';ctx.fillRect(0,0,1440,1000);if(step){ctx.fillStyle='rgb(220,220,220)';ctx.fillRect(Math.round(r.x+r.width/2),0,1440,1000)}document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))};paintMaterial(false)})()`)
    await sleep(200)
    const edge = await evaluate(`(()=>{const p=document.querySelector('[data-glass-capsule="exif"]'),c=p.querySelector('canvas'),ctx=c.getContext('2d'),r=p.getBoundingClientRect(),cr=c.getBoundingClientRect(),x=Math.round(c.width/2),y=Math.round(r.y-cr.y);return {config:JSON.parse(p.dataset.config),cssBorder:getComputedStyle(p).borderWidth,cssShadow:getComputedStyle(p).boxShadow,edgePixels:Array.from({length:13},(_,i)=>({offset:i-4,rgba:[...ctx.getImageData(x,y+i-4,1,1).data]}))}})()`)
    assert.equal(edge.cssBorder, '0px')
    assert.equal(edge.config.edgeHighlight, 0)
    assert.equal(edge.config.fresnel, 0)
    assert.equal(edge.config.shadowOpacity, 0)
    assert.ok(edge.edgePixels.filter(p => p.offset >= 0).every(p => Math.max(...p.rgba.slice(0, 3)) < 145), 'Uniform grey must not acquire a white edge line')
    await crop('border-removed')
    await evaluate('paintMaterial(true)')
    await sleep(200)
    const blur = await evaluate(`(()=>{const p=document.querySelector('[data-glass-capsule="exif"]'),c=p.querySelector('canvas'),d=c.getContext('2d').getImageData(Math.floor(c.width/2)-20,Math.floor(c.height/2),41,1).data;const profile=Array.from({length:41},(_,i)=>d[i*4]);const width=v=>{const lo=v.slice(0,6).reduce((a,b)=>a+b)/6,hi=v.slice(-6).reduce((a,b)=>a+b)/6;const cross=q=>{const threshold=lo+(hi-lo)*q;for(let i=0;i<v.length-1;i++)if(v[i]<=threshold&&v[i+1]>=threshold)return i+(threshold-v[i])/(v[i+1]-v[i]);return null};return cross(.9)-cross(.1)};const a=document.createElement('canvas');a.width=160;a.height=80;const ac=a.getContext('2d');ac.fillStyle='rgb(20,20,20)';ac.fillRect(0,0,160,80);ac.fillStyle='rgb(220,220,220)';ac.fillRect(80,0,80,80);const ref=document.createElement('canvas');ref.width=160;ref.height=80;const ctx=ref.getContext('2d');ctx.filter='blur(2px)';ctx.drawImage(a,0,0);const rp=ctx.getImageData(60,40,41,1).data,reference=Array.from({length:41},(_,i)=>rp[i*4]);return {profile,reference,edgeWidthPx:width(profile),referenceEdgeWidthPx:width(reference),equivalentSigmaPx:width(profile)/2.563103,referenceSigmaPx:width(reference)/2.563103,control:getComputedStyle(document.querySelector('.dockInner')).getPropertyValue('--capsule-blur')}})()`)
    assert.ok(blur.equivalentSigmaPx > 1.5 && blur.equivalentSigmaPx < 2.6)
    assert.ok(Math.abs(blur.equivalentSigmaPx - blur.referenceSigmaPx) < .4)
    await crop('blur-2px')
    await evaluate(`document.querySelector('#material-fixture').remove();document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
    return { edge, blur }
  },
  async motion() {
    await ready()
    await evaluate(`window.motion=[];window.recordMotion=ms=>new Promise(resolve=>{const start=performance.now();const tick=()=>{const data=${snapshot};data.time=performance.now()-start;data.metaBlur=getComputedStyle(document.querySelector('.dockMeta')).filter;motion.push(data);if(data.time<ms)requestAnimationFrame(tick);else resolve(motion)};requestAnimationFrame(tick)})`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await evaluate('motion=[];window.closing=recordMotion(3900);true')
    const closeFrames = await evaluate('closing')
    const collapsed = await evaluate(snapshot)
    assert.deepEqual(collapsed.items.filter(x => x.visible).map(x => x.name), ['idle'])
    const idle = collapsed.items.find(x => x.name === 'idle').rect
    assert.equal(idle.width, 56); assert.equal(idle.height, 32)
    await shot('single-idle-capsule')
    await evaluate(`motion=[];window.opening=recordMotion(1050);document.querySelector('.dockInner').addEventListener('glassgeometry',()=>window.timings=document.querySelector('.dockInner').getAnimations({subtree:true}).map(a=>a.effect.getTiming()),{once:true});true`)
    await click(idle)
    const openFrames = await evaluate('opening')
    const timings = await evaluate('timings')
    assert.ok(timings.some(t => t.duration === 810))
    assert.ok(timings.every(t => t.easing !== 'linear'))
    assert.ok(openFrames.some(f => f.items.some(x => x.visible && x.name === 'exif' && parseFloat(x.translate.split(' ').at(-1)) < -.5)))
    assert.ok(closeFrames.some(f => f.items.some(x => x.name === 'exif' && x.opacity > 0 && x.opacity < 1) && parseFloat(f.metaBlur.slice(5)) > 0))
    for (const frame of [...closeFrames, ...openFrames]) noOverlap(frame)
    assert.equal(new Set([...closeFrames, ...openFrames].map(f => f.slot.height)).size, 1)
    assert.equal(await evaluate('__metrics.cls'), 0)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
    await evaluate(`document.querySelector('.dockInner').addEventListener('glassgeometry',()=>{window.poseAnimations=document.querySelector('.dockInner').getAnimations({subtree:true});for(const a of poseAnimations)a.pause()},{once:true})`)
    await click(await rect('.dockToggle'))
    const poses = []
    for (const time of [0, 200, 400, 650, 810]) {
      await evaluate(`for(const a of poseAnimations)a.currentTime=${time};document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
      await sleep(80)
      await crop(`opening-${time}ms`)
      poses.push({ time, ...await evaluate(snapshot) })
    }
    await evaluate('for(const a of poseAnimations)a.finish()')
    await until(`!document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
    const fit = await rect('.dockFit')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fit.x + 30, y: fit.y + 22 })
    await crop('hover-nonlinear')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fit.x + 30, y: fit.y + 22, button: 'left', clickCount: 1 })
    await crop('active-nonlinear')
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fit.x + 30, y: fit.y + 22, button: 'left', clickCount: 1 })
    const audit = await evaluate(`[...document.querySelectorAll('.photoShell *')].map(e=>{const s=getComputedStyle(e);return {node:e.className,transition:s.transitionDuration,timing:s.transitionTimingFunction,animation:s.animationName,animationTiming:s.animationTimingFunction}}).filter(x=>x.transition.split(',').some(v=>parseFloat(v)>0)||x.animation!=='none')`)
    assert.ok(audit.every(x => !x.timing.split(',').map(v => v.trim()).includes('linear') && (x.animation === 'none' || x.animationTiming !== 'linear')))
    assert.equal(await evaluate(`document.querySelector('.dockFit').querySelectorAll('[data-glass-output]').length`), 1)
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed'`)
    await click(await rect('.dockToggle'))
    assert.equal(await evaluate(`document.querySelector('.dockInner').getAnimations({subtree:true}).length`), 0)
    await send('Emulation.setEmulatedMedia', { features: [] })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
    const start = await evaluate('__metrics.draws')
    await sleep(5000)
    const idleDraws = await evaluate(`__metrics.draws-${start}`)
    assert.equal(idleDraws, 0)
    return { closeFrames, openFrames, collapsed, timings, poses, audit, idleDraws, cls: await evaluate('__metrics.cls'), shifts: await evaluate('layoutShifts') }
  },
  async photos() {
    const result = []
    for (const [name, id] of [['dark', 'IMG_20260214_154544.jpg'], ['light', 'IMG_20260327_170359.jpg']]) {
      await ready(id)
      const r = await rect('.photoImgHigh')
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -Math.log(Math.max(1.5, 1400 / r.height)) / .0018 })
      await sleep(600)
      const meta = await rect('[data-glass-capsule="exif"]')
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: meta.x + 20, y: meta.y + 18 })
      await until(`!document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
      const data = await evaluate(`(()=>{const root=document.querySelector('.dockInner'),c=root.querySelector('[data-glass-scene]'),d=c.getContext('2d').getImageData(20,20,c.width-40,c.height-40).data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;const p=document.querySelector('.photoImgHigh'),r=p.getBoundingClientRect(),b=root.getBoundingClientRect();return {backgroundLuma:sum/(d.length/4),source:p.currentSrc,natural:[p.naturalWidth,p.naturalHeight],photoBehind:r.bottom>b.bottom&&r.top<b.top,text:root.innerText}})()`)
      assert.ok(data.photoBehind)
      await shot(`${name}-photo`)
      await crop(`${name}-capsules`)
      result.push({ name, ...data })
    }
    assert.ok(result[0].backgroundLuma < 40 && result[1].backgroundLuma > 180)
    return { photos: result }
  },
  async gallery() {
    const states = []
    for (const [name, address] of [['baseline', 'http://127.0.0.1'], ['candidate', base]]) {
      await navigate(`${address}/?capsule-gallery-check=1#/`)
      await until(`document.querySelectorAll('.tile').length===44 && [...document.querySelectorAll('.tile img')].filter(e=>e.getBoundingClientRect().top<innerHeight).every(e=>e.complete&&e.naturalWidth)`)
      await evaluate('document.fonts.ready')
      await sleep(400)
      const data = await evaluate(`({tiles:[...document.querySelectorAll('.tile')].map(e=>({rect:e.getBoundingClientRect().toJSON(),text:e.innerText})),cls:__metrics.cls})`)
      await shot(`gallery-${name}`)
      states.push(data)
    }
    assert.deepEqual(states[1], states[0])
    assert.equal(states[1].cls, 0)
    return { tiles: states[1].tiles.length, exactGeometryAndTextMatch: true, cls: states[1].cls, states }
  },
}
try {
  for (const [name, check] of Object.entries(checks)) {
    if (selected && selected !== name) continue
    try { report.phases[name] = { status: 'passed', ...await check() }; console.log(`PASS ${name}`) }
    catch (error) { report.phases[name] = { status: 'failed', failure: error.stack }; process.exitCode = 1; console.error(`FAIL ${name}: ${error.stack}`) }
    await writeFile(`${b.out}/results.json`, JSON.stringify(report, null, 2))
  }
  const style = await readFile('src/style.css', 'utf8')
  assert.ok(!/(?:transition|animation)[^;]*\blinear\b/.test(style))
  assert.deepEqual(b.errors, [])
  report.status = Object.values(report.phases).every(x => x.status === 'passed') ? 'passed' : 'failed'
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(`${b.out}/results.json`, JSON.stringify(report, null, 2)); b.close() }

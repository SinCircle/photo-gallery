import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { browserSession, sleep } from './browser-session.mjs'

const base = process.env.VERIFY_URL || 'http://127.0.0.1:5176'
const repetitions = Number(process.env.BENCH_REPETITIONS || 5)
const browser = await browserSession('performance', 9252)
const { evaluate, send, until, navigate } = browser
const report = { base, startedAt: new Date().toISOString(), repetitions, graphics: browser.graphics, browser: browser.version.product, method: '1440x1000 Chrome headless; each case forces a fresh document, then applies the same -350px wheel zoom so actual panning is possible; 200 trusted CDP drag events at fixed 25ms targets + 9 wheel events; assert pan matrix changes; 5s input + 2.8s settle (includes asynchronous bitmap update); actual rAF timestamps and main-document PerformanceObserver longtask >=50ms; interleaved cases', runs: [], errors: browser.errors }
const reference = createServer(async (req, res) => {
  try {
    const uri = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join('.superpowers/verification/reference/dist', uri === '/' ? 'index.html' : uri)
    if (uri.startsWith('/images/')) { const rel = uri.slice(8); file = path.join('.superpowers/verification/library', rel.startsWith('thumbs/') ? rel : `originals/${rel}`) }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream')
    res.end(await readFile(file))
  } catch { res.statusCode = 404; res.end() }
})
await new Promise(resolve => reference.listen(5184, '127.0.0.1', resolve))
const cases = [
  { name: 'legacy', url: 'http://127.0.0.1:5184/#/photo/!IMG_20260103_160706.jpg' },
  { name: 'glass-off', url: `${base}/?benchmark=off#/photo/!IMG_20260103_160706.jpg`, noGL: true },
  { name: 'glass-on', url: `${base}/?benchmark=on#/photo/!IMG_20260103_160706.jpg` },
]
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const config of repeat % 2 ? [...cases].reverse() : cases) {
      let noGL
      if (config.noGL) noGL = await send('Page.addScriptToEvaluateOnNewDocument', { source: `const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t==='webgl'?null:original.call(this,t,...a)}` })
      const url = new URL(config.url)
      url.searchParams.set('round', String(repeat))
      const navigation = await navigate(url.href)
      assert.ok(navigation.loaderId, 'Each run must load a fresh document')
      await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
      await until(`!document.querySelector('.dockMetaLoading')`)
      if (config.name === 'glass-on') {
        const r = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
        await until(`document.querySelector('.dockInner').dataset.glass==='webgl'`)
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -350 })
      await sleep(900)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 })
      await sleep(650)
      await evaluate(`(()=>{
        window.glassPixels=()=>{const c=document.querySelector('[data-glass-output]');if(!c)return null;const ctx=c.getContext('2d'),pixels=[];for(const x of [.25,.5,.75])for(const y of [.25,.5,.75])pixels.push(...ctx.getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data);return pixels.join(',')};
        const surfacePixels=glassPixels();window.__bench={start:performance.now(),previous:0,intervals:[],activeIntervals:[],pan:document.querySelector('.photoPan').style.transform,surfacePixels};__metrics.longTasks=[];
        const frame=t=>{const b=__bench;if(b.previous){b.intervals.push(t-b.previous);if(t-b.start<=5000)b.activeIntervals.push(t-b.previous)}b.previous=t;if(t-b.start<7800)requestAnimationFrame(frame);else b.done=true};requestAnimationFrame(frame);
      })()`)
      const start = performance.now()
      let ticks = 0
      while (ticks < 200) {
        await sleep(Math.max(0, start + ticks * 25 - performance.now()))
        const tickStart = performance.now(), seconds = (tickStart - start) / 1000
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720 + Math.sin(seconds * 2) * 130, y: 450 + Math.cos(seconds * 3) * 65, buttons: 1 })
        if (ticks % 24 === 0) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -10 })
        ticks++
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 })
      await until(`__bench.done===true`)
      const stats = await evaluate(`(()=>{
        const b=__bench,sorted=[...b.intervals].sort((a,b)=>a-b),sum=b.intervals.reduce((a,b)=>a+b,0),active=b.activeIntervals.reduce((a,b)=>a+b,0);
        const tasks=__metrics.longTasks.filter(t=>t.start>=b.start);
        const afterPixels=glassPixels();return {fps:1000*b.intervals.length/sum,activeFPS:1000*b.activeIntervals.length/active,p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxFrameMs:sorted.at(-1),frames:b.intervals.length,longTaskCount:tasks.length,longTaskTotalMs:tasks.reduce((s,t)=>s+t.duration,0),longTaskMaxMs:Math.max(0,...tasks.map(t=>t.duration)),longTasks:tasks,glass:document.querySelector('.dockInner').dataset.glass||'legacy-css',panBefore:b.pan,panAfter:document.querySelector('.photoPan').style.transform,panChanged:b.pan!==document.querySelector('.photoPan').style.transform,pixelsBefore:b.surfacePixels,pixelsAfter:afterPixels,pixelsChanged:b.surfacePixels!==null&&b.surfacePixels!==afterPixels};
      })()`)
      report.runs.push({ case: config.name, repeat, loaderId: navigation.loaderId, inputTicks: ticks, ...stats })
      assert.ok(stats.panChanged, 'Trusted drag events must actually pan the photo')
      if (config.name === 'glass-on') {
        assert.equal(stats.glass, 'webgl', 'The enabled case must not fall back during measurement')
        assert.ok(stats.pixelsChanged, 'The interaction must change actual rendered pixels; pixel latency is tested separately')
      }
      console.log(`${config.name} #${repeat + 1}: FPS=${stats.fps.toFixed(3)} active=${stats.activeFPS.toFixed(3)} p95=${stats.p95FrameMs.toFixed(2)}ms longTasks=${stats.longTaskCount}/${stats.longTaskTotalMs}ms`)
      if (noGL) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noGL.identifier })
    }
  }
  report.summary = Object.fromEntries(cases.map(config => {
    const runs = report.runs.filter(r => r.case === config.name)
    return [config.name, { medianFPS: median(runs.map(r => r.fps)), medianActiveFPS: median(runs.map(r => r.activeFPS)), minFPS: Math.min(...runs.map(r => r.fps)), maxFPS: Math.max(...runs.map(r => r.fps)), maxP95FrameMs: Math.max(...runs.map(r => r.p95FrameMs)), totalLongTasks: runs.reduce((s, r) => s + r.longTaskCount, 0), totalLongTaskMs: runs.reduce((s, r) => s + r.longTaskTotalMs, 0) }]
  }))
  assert.deepEqual(browser.errors, [])
  report.acceptance = {
    rule: 'Five interleaved repetitions: glass-on median FPS >= unmodified legacy median FPS',
    legacyDeltaPercent: (report.summary['glass-on'].medianFPS / report.summary.legacy.medianFPS - 1) * 100,
    glassOffDeltaPercent: (report.summary['glass-on'].medianFPS / report.summary['glass-off'].medianFPS - 1) * 100,
    legacyParity: report.summary['glass-on'].medianFPS >= report.summary.legacy.medianFPS,
  }
  console.log('MEASURED summary:', JSON.stringify(report.summary))
  assert.ok(report.acceptance.legacyParity, 'Measured median FPS is below the legacy baseline')
  report.status = 'passed'
  console.log(`PASS performance median vs legacy: ${report.summary['glass-on'].medianFPS.toFixed(3)} >= ${report.summary.legacy.medianFPS.toFixed(3)} FPS; main-document long tasks=${report.summary['glass-on'].totalLongTasks}`)
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out + '/results.json', JSON.stringify(report, null, 2)); reference.close(); browser.close() }

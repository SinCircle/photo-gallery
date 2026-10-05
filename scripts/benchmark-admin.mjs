import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

// Authentication only; run against the isolated copy, never the real library.
const base = 'http://127.0.0.1:8085'
const browser = await browserSession('performance-admin', 9253)
const { navigate, evaluate, until, send } = browser
const report = { base, startedAt: new Date().toISOString(), browser: browser.version.product, graphics: browser.graphics,
  method: '1440x1000; copied library; three interleaved fresh documents per case; all 44 thumbnails decoded before measurement; 200 trusted wheel events at fixed 25ms targets; 5s scrolling + 2.8s settle; actual rAF timestamps and main-document long tasks >=50ms', runs: [], errors: browser.errors }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  await navigate(`${base}/#/admin`)
  assert.equal(await evaluate(`(async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'gallery-verification-only'})});return r.status})()`), 200)
  for (let round = 0; round < 3; round++) {
    for (const name of round % 2 ? ['glass-on', 'glass-off'] : ['glass-off', 'glass-on']) {
      let noGL
      if (name === 'glass-off') noGL = await send('Page.addScriptToEvaluateOnNewDocument', { source: `const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t==='webgl'?null:original.call(this,t,...a)}` })
      const navigation = await navigate(`${base}/?scroll-benchmark=${name}&round=${round}#/admin`)
      assert.ok(navigation.loaderId)
      await until(`document.querySelectorAll('article.tile img').length===44`)
      // Load images without altering the production implementation.
      await evaluate(`Promise.all([...document.querySelectorAll('article.tile img')].map(async i=>{i.loading='eager';await i.decode()}))`)
      await evaluate('document.fonts.ready')
      const r = await evaluate(`document.querySelector('.topbarInner').getBoundingClientRect().toJSON()`)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
      await until(`document.querySelector('.topbarInner').dataset.toolbar==='expanded' && !document.querySelector('.topbarInner').getAnimations().length`)
      if (name === 'glass-on') await until(`document.querySelector('.topbarInner').dataset.glass==='webgl'`)
      await sleep(700)
      const timersBefore = await evaluate('__metrics.timers')
      await evaluate(`(()=>{window.__bench={start:performance.now(),previous:0,intervals:[],surface:document.querySelector('.topbarInner').style.getPropertyValue('--glass-refraction')};__metrics.longTasks=[];const frame=t=>{const b=__bench;if(b.previous)b.intervals.push(t-b.previous);b.previous=t;if(t-b.start<7800)requestAnimationFrame(frame);else b.done=true};requestAnimationFrame(frame)})()`)
      const start = performance.now()
      for (let tick = 0; tick < 200; tick++) {
        await sleep(Math.max(0, start + tick * 25 - performance.now()))
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1200, y: 650, deltaX: 0, deltaY: tick < 150 ? 80 : -80 })
      }
      await until('__bench.done===true')
      const stats = await evaluate(`(()=>{const b=__bench,s=[...b.intervals].sort((a,b)=>a-b),tasks=__metrics.longTasks.filter(t=>t.start>=b.start);return {fps:1000*b.intervals.length/b.intervals.reduce((a,b)=>a+b,0),p95FrameMs:s[Math.floor(s.length*.95)],longTaskCount:tasks.length,longTaskTotalMs:tasks.reduce((sum,t)=>sum+t.duration,0),longTasks:tasks,scrollY,glass:document.querySelector('.topbarInner').dataset.glass,snapshotUpdated:!!b.surface&&b.surface!==document.querySelector('.topbarInner').style.getPropertyValue('--glass-refraction')}})()`)
      report.runs.push({ case: name, round, loaderId: navigation.loaderId, inputTicks: 200, ...stats })
      report.runs.at(-1).mainTimersCreated = await evaluate(`__metrics.timers-${timersBefore}`)
      assert.ok(stats.scrollY > 0, 'Actually scroll the management page')
      if (name === 'glass-on') {
        assert.equal(stats.glass, 'webgl', 'The enabled case must not fall back during measurement')
        assert.ok(stats.snapshotUpdated, 'The scroll must update actual refracted pixels')
      }
      console.log(`${name} scroll #${round + 1}: FPS=${stats.fps.toFixed(3)} p95=${stats.p95FrameMs.toFixed(2)}ms longTasks=${stats.longTaskCount}/${stats.longTaskTotalMs}ms`)
      if (noGL) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noGL.identifier })
    }
  }
  report.summary = Object.fromEntries(['glass-off', 'glass-on'].map(name => {
    const runs = report.runs.filter(r => r.case === name)
    return [name, { medianFPS: median(runs.map(r => r.fps)), minFPS: Math.min(...runs.map(r => r.fps)), maxFPS: Math.max(...runs.map(r => r.fps)), maxP95FrameMs: Math.max(...runs.map(r => r.p95FrameMs)), totalLongTasks: runs.reduce((s, r) => s + r.longTaskCount, 0), totalLongTaskMs: runs.reduce((s, r) => s + r.longTaskTotalMs, 0) }]
  }))
  assert.deepEqual(browser.errors, [])
  report.status = 'measured'
  console.log('MEASURED management scroll:', JSON.stringify(report.summary))
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out + '/results.json', JSON.stringify(report, null, 2)); browser.close() }

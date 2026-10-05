import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const browser = await browserSession('toolbar', 9251)
const { evaluate, send, until, navigate, shot } = browser
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5176'
const report = { base, checks: {}, errors: browser.errors }
const photo = `${base}/#/photo/!IMG_20260103_160706.jpg`
const collapsed = selector => until(`document.querySelector(${JSON.stringify(selector)})?.dataset.toolbar==='collapsed' && document.querySelector(${JSON.stringify(selector)}).getAnimations().length===0`)
const expanded = selector => until(`document.querySelector(${JSON.stringify(selector)})?.dataset.toolbar==='expanded' && document.querySelector(${JSON.stringify(selector)}).getAnimations().length===0`)
const move = async (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
try {
  await navigate(photo)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const startRect = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await move(startRect.x + startRect.width / 2, startRect.y + startRect.height / 2)
  await expanded('.dockInner')
  await until(`document.querySelector('.dockInner').dataset.glass==='webgl'`)
  await evaluate(`__metrics.cls=0; window.originalImageRect=JSON.stringify(document.querySelector('.photoImgHigh').getBoundingClientRect().toJSON())`)
  await shot('photo-expanded')
  await move(20, 20)
  await collapsed('.dockInner')
  report.checks.collapsed = await evaluate(`(()=>{const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect();return {width:r.width,height:r.height,hidden:[...bar.children].filter(e=>!e.classList.contains('glassSurface')).every(e=>e.inert&&getComputedStyle(e).visibility==='hidden'),imageUnchanged:originalImageRect===JSON.stringify(document.querySelector('.photoImgHigh').getBoundingClientRect().toJSON()),cls:__metrics.cls}})()`)
  assert.ok(Math.abs(report.checks.collapsed.width - 96) < .1)
  assert.ok(Math.abs(report.checks.collapsed.height - 8) < .1)
  assert.equal(report.checks.collapsed.hidden, true)
  assert.equal(report.checks.collapsed.imageUnchanged, true)
  await shot('photo-collapsed')
  const rect = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await evaluate(`window.widthSamples=[];window.sampleTimer=setInterval(()=>widthSamples.push(document.querySelector('.dockInner').getBoundingClientRect().width),8)`)
  await move(rect.x + rect.width / 2, rect.y - 20)
  await expanded('.dockInner')
  report.checks.approach = await evaluate(`(()=>{clearInterval(sampleTimer);return {peakWidth:Math.max(...widthSamples),finalWidth:document.querySelector('.dockInner').getBoundingClientRect().width,cls:__metrics.cls}})()`)
  assert.ok(report.checks.approach.peakWidth > report.checks.approach.finalWidth * 1.02)
  await move(20, 20)
  await collapsed('.dockInner')
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaY: -20, deltaX: 0 })
  await expanded('.dockInner')
  report.checks.wheel = true
  await collapsed('.dockInner')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 400, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 400, button: 'left', clickCount: 1 })
  await expanded('.dockInner')
  report.checks.click = true
  report.checks.photoCLS = await evaluate(`__metrics.cls`)
  assert.equal(report.checks.photoCLS, 0)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await collapsed('.dockInner')
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaY: -20, deltaX: 0 })
  report.checks.reducedMotion = await evaluate(`({expanded:document.querySelector('.dockInner').dataset.toolbar,animations:document.querySelector('.dockInner').getAnimations().length})`)
  assert.deepEqual(report.checks.reducedMotion, { expanded: 'expanded', animations: 0 })
  await send('Emulation.setEmulatedMedia', { features: [] })
  await navigate(`${base}/#/admin`)
  await until(`!!document.querySelector('.adminLogin')`)
  await sleep(800)
  await evaluate(`__metrics.cls=0;window.loginRect=JSON.stringify(document.querySelector('.adminLogin').getBoundingClientRect().toJSON())`)
  await move(20, 500)
  await collapsed('.topbarInner')
  report.checks.admin = await evaluate(`({cls:__metrics.cls,formUnchanged:loginRect===JSON.stringify(document.querySelector('.adminLogin').getBoundingClientRect().toJSON()),width:document.querySelector('.topbarInner').getBoundingClientRect().width,height:document.querySelector('.topbarInner').getBoundingClientRect().height})`)
  assert.equal(report.checks.admin.cls, 0)
  assert.equal(report.checks.admin.formUnchanged, true)
  await shot('admin-collapsed')
  const top = await evaluate(`document.querySelector('.topbarInner').getBoundingClientRect().toJSON()`)
  await move(top.x + top.width / 2, top.y + 20)
  await expanded('.topbarInner')
  await shot('admin-expanded')
  assert.deepEqual(browser.errors, [])
  report.status = 'passed'
  console.log(`PASS toolbar: 96x8px idle handle; approach/click/wheel restore; measured overshoot=${report.checks.approach.peakWidth.toFixed(2)}/${report.checks.approach.finalWidth}px`)
  console.log('PASS motion: photo CLS=0; admin CLS=0; image/form rectangles unchanged; reduced-motion instantaneous')
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out + '/results.json', JSON.stringify(report, null, 2)); browser.close() }

import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('performance-sweep/parity', 9375)
const bases = ['http://127.0.0.1:5196', 'http://127.0.0.1:5187']
const report = { cases: [], errors: b.errors }
try {
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  for (const width of [1440, 390]) {
    let before
    for (const base of bases) {
      await b.navigate(base + '/?performance-parity#/photo/IMG_3512.jpg', width, 844)
      await b.until(`document.querySelector('.dockBar')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving`)
      await b.evaluate('document.fonts.ready')
      await b.evaluate(`document.querySelector('.dockBar').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('.dockBack').focus({preventScroll:true})`)
      await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'`)
      await sleep(200)
      await b.evaluate(`(()=>{const scene=document.querySelector('[data-glass-scene]'),ctx=scene.getContext('2d');const gradient=ctx.createLinearGradient(0,0,scene.width,0);gradient.addColorStop(0,'#101010');gradient.addColorStop(.35,'#808080');gradient.addColorStop(.7,'#fdfdfd');gradient.addColorStop(1,'#202020');ctx.fillStyle=gradient;ctx.fillRect(0,0,scene.width,scene.height);document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'))})()`)
      await sleep(200)
      const ink = await b.evaluate(`({labels:[...document.querySelectorAll('.dockGlyph')].map(e=>({text:e.textContent,tone:getComputedStyle(e).getPropertyValue('--dock-tone'),mask:getComputedStyle(e.querySelector('.dockShadow')).maskImage})),dots:[...document.querySelectorAll('.capsuleDots,.capsuleDot')].map(e=>getComputedStyle(e).getPropertyValue('--dock-tone'))})`)
      const material = []
      for (const value of [0, .35, 1]) material.push(await b.evaluate(`(()=>{const bar=document.querySelector('.dockBar');bar.style.setProperty('--glass-material','${value}');const surface=getComputedStyle(bar.querySelector('[data-glass-output]'));return {shadow:getComputedStyle(bar).boxShadow,veil:getComputedStyle(bar,'::after').opacity,opacity:surface.opacity,filter:surface.filter}})()`))
      const state = { ink, material }
      before ??= state
      assert.deepEqual(state, before, 'Resolved ink, shadows and appearance must match the original build')
      report.cases.push({ base, width, ...state })
      await b.shot('parity-' + new URL(base).port + '-' + width)
    }
  }
  assert.deepEqual(b.errors, [])
  report.status = 'passed'
  console.log('PASS exact resolved masks, label/dot tones and material at 0%, 35%, 100%; desktop and mobile')
} catch (error) { report.status = 'failed'; report.failure = error.stack; console.error(error); process.exitCode = 1 }
finally { await writeFile(b.out + '/results.json', JSON.stringify(report, null, 2)); b.close() }

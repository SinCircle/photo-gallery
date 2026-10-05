import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

// Ad-hoc visual capture of the dock: expanded, mid-morph frames, collapsed.
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || '!IMG_20260103_160706.jpg'
const b = await browserSession('dock-shots', 9286)
const { evaluate, send, navigate, until } = b

async function crop(name, pad = 26) {
  const r = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  const w = await evaluate('innerWidth')
  const h = await evaluate('innerHeight')
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad)
  const data = await send('Page.captureScreenshot', { format: 'png', clip: {
    x, y, width: Math.min(r.width + pad * 2, w - x), height: Math.min(r.height + pad * 2, h - y), scale: 1 } })
  await writeFile(`${b.out}/${name}.png`, Buffer.from(data.data, 'base64'))
}

await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl' && !document.querySelector('.dockMetaLoading')`)
await evaluate('document.fonts.ready')
await sleep(500)
await crop('dock-expanded')

// Idle collapse: park the pointer far away and let the 2800ms timer run.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20 })
await until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed'`, 12000)
await evaluate(`(()=>{const bar=document.querySelector('.dockBar');window.__morph=[];const t0=performance.now();
  const step=()=>{const r=bar.getBoundingClientRect();__morph.push({t:Math.round(performance.now()-t0),w:+r.width.toFixed(1),h:+r.height.toFixed(1),op:getComputedStyle(bar.querySelector('[data-glass-capsule]')||bar).opacity});
  if(performance.now()-t0<900)requestAnimationFrame(step)};requestAnimationFrame(step)})()`)
// Pretend the pointer comes near so it opens, then sample the morph.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 940 })
await sleep(900)
await crop('dock-expanded-again')
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20 })
await sleep(3600)
await crop('dock-collapsed')
const morph = await evaluate('window.__morph')
console.log(JSON.stringify({ morph: morph.slice(0, 6), samples: morph.length, last: morph.at(-1) }, null, 2))
console.log('errors', JSON.stringify(b.errors))
b.close()

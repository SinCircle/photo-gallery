import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

// Does the outline touch the glyph core? Capture a label that has one, strip the
// attribute, capture again, and compare the extremes of the ink inside the label
// box. The ring may add pixels; it must not move the ink's own tone.
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || 'IMG_20260815_153938.jpg'
const b = await browserSession('outline', 9300)
const { evaluate, send, navigate, until } = b
await send('Network.setCacheDisabled', { cacheDisabled: true })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
await evaluate('document.fonts.ready')
await sleep(600)
const meta = await evaluate(`document.querySelector('.dockMeta').getBoundingClientRect().toJSON()`)
const mx = Math.round(meta.x + meta.width / 2), my = Math.round(meta.y + meta.height / 2)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my })
await sleep(700)
for (let i = 0; i < 3; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 460, deltaX: 0, deltaY: -120 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my })
  await sleep(300)
}
await sleep(900)
const target = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.dockMetaItem, .dockAction')].find(e => e.hasAttribute('data-halo'))
  if (!el) return null
  const r = el.getBoundingClientRect()
  return JSON.stringify({ label: el.textContent.trim().slice(0, 8), x: r.x, y: r.y, w: r.width, h: r.height })
})()`)
if (!target) { console.log(JSON.stringify({ photo, error: 'no label carried an outline' })); b.close(); process.exit(1) }
const t = JSON.parse(target)
const stats = async (tag) => {
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: t.x - 2, y: t.y - 2, width: t.w + 4, height: t.h + 4, scale: 4 } })
  await writeFile(`${b.out}/outline-${tag}.png`, Buffer.from(shot.data, 'base64'))
  return evaluate(`(async () => {
    const img = new Image()
    await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + ${JSON.stringify(shot.data)} })
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const l = []
    for (let i = 0; i < d.length; i += 4) l.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i+1]) + 0.0722 * lin(d[i+2]))
    l.sort((a, b) => a - b)
    const q = p => +l[Math.min(l.length - 1, Math.round(p * (l.length - 1)))].toFixed(4)
    return { p01: q(0.01), p10: q(0.1), median: q(0.5), p90: q(0.9), p99: q(0.99) }
  })()`)
}
const on = await stats('on')
await evaluate(`document.querySelectorAll('[data-halo]').forEach(e => e.removeAttribute('data-halo'))`)
await sleep(400)
const off = await stats('off')
await evaluate(`document.querySelectorAll('.dockMetaItem, .dockAction').forEach(e => e.setAttribute('data-halo',''))`)
console.log(JSON.stringify({ photo, label: t.label, on, off,
  coreShift: { p01: +(on.p01 - off.p01).toFixed(4), p10: +(on.p10 - off.p10).toFixed(4) },
  ringGain: { p90: +(on.p90 - off.p90).toFixed(4), p99: +(on.p99 - off.p99).toFixed(4) } }, null, 1))
console.log('errors', JSON.stringify(b.errors))
b.close()

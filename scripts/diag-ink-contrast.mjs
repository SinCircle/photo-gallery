import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

// Label contrast from a single rendered frame. The labels are baked into the
// glass texture, so there is no clean frame to diff against; instead the glass
// behind each glyph is estimated with a median filter wide enough to erase the
// strokes but narrow enough to follow the photo.
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photos = (process.env.PHOTOS || '!IMG_20260103_160706.jpg,IMG_20260110_094116 0.jpg,IMG_20260213_122307.jpg,IMG_20260201_181608.jpg,IMG_20260201_173805.jpg,IMG_20220101_120000.jpg').split(',')
const b = await browserSession('ink-contrast', 9288)
const { evaluate, send, navigate, until } = b

await send('Network.setCacheDisabled', { cacheDisabled: true })
const rows = []
for (const photo of photos) {
  await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
  let ok = true
  try { await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl'`, 20000) } catch { ok = false }
  if (!ok) { rows.push({ photo, error: 'no photo' }); continue }
  await evaluate('document.fonts.ready')
  await sleep(500)
  const meta = await evaluate(`document.querySelector('.dockMeta').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: meta.x + meta.width / 2, y: meta.y + meta.height / 2 })
  await sleep(600)
  const r = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  const clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 }
  const boxes = await evaluate(`JSON.stringify(['.dockBack','.dockFit','.dockMeta','.dockDownload'].map(s=>{const e=document.querySelector(s);const b=e.getBoundingClientRect();return {label:e.textContent.trim().slice(0,8).replace(/\s+/g,''),x:b.left-${clip.x},y:b.top-${clip.y},w:b.width,h:b.height}}))`)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip })
  await writeFile(`${b.out}/${photo.replace(/[^\w]/g, '_')}.png`, Buffer.from(shot.data, 'base64'))
  const report = await evaluate(`(async () => {
    const i = new Image()
    await new Promise(r => { i.onload = r; i.src = 'data:image/png;base64,' + ${JSON.stringify(shot.data)} })
    const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight
    const ctx = c.getContext('2d'); ctx.drawImage(i, 0, 0)
    const full = ctx.getImageData(0, 0, c.width, c.height)
    const W = c.width, H = c.height
    const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const L = new Float64Array(W * H)
    for (let p = 0; p < W * H; p++) L[p] = 0.2126 * lin(full.data[p*4]/255) + 0.7152 * lin(full.data[p*4+1]/255) + 0.0722 * lin(full.data[p*4+2]/255)
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    const S = 2, RAD = 3
    const out = []
    for (const box of ${boxes}) {
      const x0 = Math.round(box.x * S), y0 = Math.round(box.y * S), w = Math.round(box.w * S), h = Math.round(box.h * S)
      const win = []
      const cs = []
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const vals = []
        for (let dy = -RAD; dy <= RAD; dy++) for (let dx = -RAD; dx <= RAD; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy))
          vals.push(L[yy * W + xx])
        }
        vals.sort((a, b) => a - b)
        win.push(vals[(vals.length - 1) >> 1])
      }
      for (let k = 0; k < win.length; k++) {
        const x = x0 + (k % w), y = y0 + Math.floor(k / w)
        cs.push({ d: Math.abs(L[y * W + x] - win[k]), c: ratio(L[y * W + x], win[k]) })
      }
      cs.sort((a, b) => b.d - a.d)
      const core = cs.slice(0, Math.max(12, Math.round(cs.length * 0.12)))
      core.sort((a, b) => a.c - b.c)
      const at = p => core[Math.min(core.length - 1, Math.floor(core.length * p))].c
      out.push({ label: box.label, core: +at(0.5).toFixed(1), p75: +at(0.75).toFixed(1), p90: +at(0.9).toFixed(1) })
    }
    return out
  })()`)
  rows.push({ photo, report })
}
console.log(JSON.stringify(rows))
console.log('errors', JSON.stringify(b.errors))
b.close()

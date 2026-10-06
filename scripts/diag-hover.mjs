import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

// One-off: does hovering a dock action lighten its whole capsule-shaped zone,
// or only the label? Samples the rendered pixels inside the button's padding.
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || '!IMG_20260103_160706.jpg'
const PAD = 20
const b = await browserSession('hover-diag', 9287)
const { evaluate, send, navigate, until } = b

async function grab(name) {
  const r = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  const clip = { x: r.x - PAD, y: r.y - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2, scale: 1 }
  const shot = await send('Page.captureScreenshot', { format: 'png', clip })
  await writeFile(`${b.out}/${name}.png`, Buffer.from(shot.data, 'base64'))
  return { data: shot.data, origin: { x: clip.x, y: clip.y } }
}

async function probe({ data, origin }) {
  return evaluate(`(async () => {
    const btn = document.querySelector('.dockBack')
    const box = btn.getBoundingClientRect()
    const img = new Image()
    await new Promise(res => { img.onload = res; img.onerror = res; img.src = 'data:image/png;base64,' + ${JSON.stringify(data)} })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
    // A strip inside the button's own padding: left of the first glyph.
    const x = Math.round(box.left - ${origin.x} + 3)
    const y = Math.round(box.top - ${origin.y} + 7)
    const w = 6, h = Math.round(box.height - 14)
    const px = ctx.getImageData(x, y, w, h).data
    let r = 0, g = 0, bl = 0
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; bl += px[i + 2] }
    const n = px.length / 4
    const style = getComputedStyle(btn)
    return { mean: [r / n, g / n, bl / n].map(v => +v.toFixed(1)),
      lift: style.getPropertyValue('--dock-lift').trim(),
      clip: style.webkitBackgroundClip || style.backgroundClip,
      layers: style.backgroundImage.split(/,(?![^(]*\\))/).length,
      src: [img.naturalWidth, img.naturalHeight], at: [x, y, w, h] }
  })()`)
}

await send('Network.setCacheDisabled', { cacheDisabled: true })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
await evaluate('document.fonts.ready')
await sleep(400)
// Park the pointer on the metadata run, which is not an action.
const meta = await evaluate(`document.querySelector('.dockMeta').getBoundingClientRect().toJSON()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: meta.x + meta.width / 2, y: meta.y + meta.height / 2 })
await sleep(600)
const rest = await probe(await grab('hover-rest'))
const btn = await evaluate(`document.querySelector('.dockBack').getBoundingClientRect().toJSON()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 })
await sleep(700)
const hover = await probe(await grab('hover-active'))
console.log(JSON.stringify({ rest, hover, ratio: hover.mean.map((v, i) => +(v / rest.mean[i]).toFixed(3)) }, null, 2))
console.log('errors', JSON.stringify(b.errors))
b.close()

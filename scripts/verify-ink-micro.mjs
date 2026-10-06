import { browserSession, sleep } from './browser-session.mjs'

// Sub-pixel stimulus: nudge the photo 0.25px at a time behind a bar that stays
// open, and watch the computed ink. This is the scale the report is about —
// "a tiny movement brings a huge difference".
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || 'IMG_20260815_153938.jpg'
const STEPS = Number(process.env.STEPS || 24)
const STEP = Number(process.env.STEP || 0.25)
const b = await browserSession('ink-micro', 9299)
const { evaluate, send, navigate, until } = b

await send('Network.setCacheDisabled', { cacheDisabled: true })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
await evaluate('document.fonts.ready')
await sleep(600)
const meta = await evaluate(`document.querySelector('.dockMeta').getBoundingClientRect().toJSON()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(meta.x + meta.width / 2), y: Math.round(meta.y + meta.height / 2) })
await sleep(700)
for (let i = 0; i < 3; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 460, deltaX: 0, deltaY: -120 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(meta.x + meta.width / 2), y: Math.round(meta.y + meta.height / 2) })
  await sleep(300)
}
await sleep(900)
const baseTransform = await evaluate(`document.querySelector('.photoPan').style.transform`)
const parts = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(baseTransform) || [null, '0', '0']
const x0 = parseFloat(parts[1]), y0 = parseFloat(parts[2])

const series = []
for (let i = 0; i <= STEPS; i++) {
  const dx = x0 + i * STEP
  await evaluate(`document.querySelector('.photoPan').style.transform = 'translate3d(${dx}px, ${y0}px, 0px)'`)
  await sleep(620)
  const ink = await evaluate(`(() => {
    const g = document.querySelector('.dockBar').style.getPropertyValue('--dock-ink-gradient')
    return g ? g.split('rgb(').slice(1).map(t => parseInt(t, 10)) : []
  })()`)
  if (ink.length) series.push({ dx, ink })
}
if (series.length < 4) { console.log(JSON.stringify({ photo, error: 'no series', got: series.length })); b.close(); process.exit(1) }
const deltas = []
for (let i = 1; i < series.length; i++) {
  const a = series[i - 1].ink, c = series[i].ink
  let worst = 0
  for (let k = 0; k < Math.min(a.length, c.length); k++) worst = Math.max(worst, Math.abs(c[k] - a[k]))
  deltas.push(+worst.toFixed(3))
}
const sorted = [...deltas].sort((x, y) => x - y)
const all = series.flatMap(s => s.ink)
console.log(JSON.stringify({
  photo, steps: series.length, stepPx: STEP,
  inkRange: [Math.min(...all), Math.max(...all)],
  perStepMax: { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], worst: sorted.at(-1) },
  deltas,
}, null, 1))
console.log('errors', JSON.stringify(b.errors))
b.close()

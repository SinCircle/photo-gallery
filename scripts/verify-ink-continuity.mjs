import { browserSession, sleep } from './browser-session.mjs'

// The label ink must be a continuous function of the photo behind the bar. This
// moves the photo under the bar in small steps — wheel zoom, dispatched on the
// bar itself so the bar stays open — and measures how far the computed ink
// jumps between consecutive steps.
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || 'IMG_20260815_153938.jpg'
const STEPS = Number(process.env.STEPS || 20)
const DELTA = Number(process.env.DELTA || 6)
const b = await browserSession('ink-continuity', 9297)
const { evaluate, send, navigate, until } = b

const inkOf = () => evaluate(`(() => {
  const g = document.querySelector('.dockBar').style.getPropertyValue('--dock-ink-gradient')
  return g ? g.split('rgb(').slice(1).map(t => parseInt(t, 10)) : []
})()`)

await send('Network.setCacheDisabled', { cacheDisabled: true })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
await evaluate('document.fonts.ready')
await sleep(600)
const meta = await evaluate(`document.querySelector('.dockMeta').getBoundingClientRect().toJSON()`)
const bx = Math.round(meta.x + meta.width / 2), by = Math.round(meta.y + meta.height / 2)
// Open the bar, then zoom out to free mode with the pointer kept on the bar.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bx, y: by })
await sleep(700)
for (let i = 0; i < 3; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bx, y: by, deltaX: 0, deltaY: -120 })
  await sleep(260)
}
await sleep(900)

// The wheel has to land on the stage to move the photo, and the pointer has to
// come back to the bar to keep it open, so each step does both.
const series = []
for (let i = 0; i <= STEPS; i++) {
  if (i) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 460, deltaX: 0, deltaY: DELTA })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bx, y: by })
  await sleep(620)
  const ink = await inkOf()
  const zoom = await evaluate(`(() => { const z = document.querySelector('.photoZoom'); return (z.style.transform || '') + '|' + z.style.width + '|' + getComputedStyle(z).transform })()`)
  if (ink.length) series.push({ i, ink, zoom })
}
const zoomed = series[0].zoom !== series.at(-1).zoom
if (series.length < 4) { console.log(JSON.stringify({ photo, error: 'no series', got: series.length })); b.close(); process.exit(1) }
const deltas = []
for (let i = 1; i < series.length; i++) {
  const a = series[i - 1].ink, c = series[i].ink
  let worst = 0, total = 0
  for (let k = 0; k < Math.min(a.length, c.length); k++) { const d = Math.abs(c[k] - a[k]); worst = Math.max(worst, d); total += d }
  deltas.push({ max: worst, mean: Math.round(total / a.length) })
}
const pick = a => a.filter((_, i) => i % 6 === 0)
const all = series.flatMap(s => s.ink)
const sorted = deltas.map(d => d.max).sort((x, y) => x - y)
console.log(JSON.stringify({
  photo, samples: series.length, zoomed,
  inkRange: [Math.min(...all), Math.max(...all)],
  stepMax: { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], worst: sorted.at(-1) },
  stepMean: { median: deltas.map(d => d.mean).sort((x, y) => x - y)[Math.floor(deltas.length / 2)] },
  first: pick(series[0].ink), mid: pick(series[Math.floor(series.length / 2)].ink), last: pick(series.at(-1).ink),
  deltas: deltas.map(d => d.max),
}, null, 1))
console.log('errors', JSON.stringify(b.errors))
b.close()

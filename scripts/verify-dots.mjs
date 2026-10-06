import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

// Independent check of the loading relay: sample all three dots' positions and
// opacities across a full cycle and report whether the three are on the field,
// whether they ever overlap, and whether entry and exit mirror each other.
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || '!IMG_20260103_160706.jpg'
const b = await browserSession('dots-check', 9298)
const { evaluate, send, navigate, until } = b

await send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 20000, uploadThroughput: 20000 })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`, 1440, 1000)
await until(`document.querySelector('.dockBar')?.dataset.loading!==undefined`, 30000)
await sleep(500)
const box = await evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20, scale: 4 } })
await writeFile(`${b.out}/loading-4x.png`, Buffer.from(shot.data, 'base64'))

const frames = []
const sample = () => evaluate(`(() => {
  const dots = [...document.querySelectorAll('.capsuleDots i')]
  return { t: performance.now(), men: dots.map(d => {
    const s = getComputedStyle(d); const m = new DOMMatrixReadOnly(s.transform)
    return { x: +m.m41.toFixed(1), op: +(+s.opacity).toFixed(2) }
  }) }
})()`)
for (let i = 0; i < 30; i++) { frames.push(await sample()); await sleep(70) }

const report = []
for (const f of frames) {
  const vis = f.men.filter(m => m.op > 0.05).sort((a, c) => a.x - c.x)
  const gaps = vis.slice(1).map((m, i) => +(m.x - vis[i].x).toFixed(1))
  report.push({ visible: vis.length, overlap: gaps.some(g => g < 4), minGap: gaps.length ? Math.min(...gaps) : null, xs: vis.map(m => m.x) })
}
const counts = report.map(r => r.visible)
const overlaps = report.filter(r => r.overlap).length
// Symmetry: the entry segment should mirror the exit. Compare the extreme
// positions reached on either side of the centre across the run.
const allX = frames.flatMap(f => f.men.filter(m => m.op > 0.05).map(m => m.x))
console.log(JSON.stringify({
  photo,
  frames: frames.length,
  visibleCount: { min: Math.min(...counts), max: Math.max(...counts), mean: +(counts.reduce((a, v) => a + v, 0) / counts.length).toFixed(2) },
  framesWithOverlap: overlaps,
  minGapSeen: Math.min(...report.filter(r => r.minGap !== null).map(r => r.minGap)),
  reach: { left: Math.min(...allX), right: Math.max(...allX) },
  sample: frames.filter((_, i) => i % 5 === 0).map(f => f.men.map(m => `${m.x}@${m.op}`).join(' ')),
}, null, 1))
console.log('errors', JSON.stringify(b.errors))
b.close()

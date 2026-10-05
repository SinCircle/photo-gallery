import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const b = await browserSession('dock-loading', 9289)
const { evaluate, send, navigate, until } = b
async function crop(name) {
  const r = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  const w = await evaluate('innerWidth'), h = await evaluate('innerHeight')
  const x = Math.max(0, r.x - 26), y = Math.max(0, r.y - 26)
  const data = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(r.width + 52, w - x), height: Math.min(r.height + 52, h - y), scale: 1 } })
  await writeFile(`${b.out}/${name}.png`, Buffer.from(data.data, 'base64'))
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.navigate', { url: `${base}/#/photo/${encodeURIComponent('!IMG_20260103_160706.jpg')}` })
await until(`document.querySelector('.dockBar')?.dataset.loading!==undefined`, 15000)
await crop('dock-loading-a')
await sleep(160)
await crop('dock-loading-b')
const state = await evaluate(`(()=>{const bar=document.querySelector('.dockBar');const r=bar.getBoundingClientRect();return {w:+r.width.toFixed(1),h:+r.height.toFixed(1),toolbar:document.querySelector('.dockInner').dataset.toolbar,dots:getComputedStyle(bar.querySelector('.capsuleDots')).display}})()`)
console.log(JSON.stringify(state))
await until(`document.querySelector('.dockBar')?.dataset.loading===undefined`, 30000)
await sleep(1400)
await crop('dock-loaded')
console.log('errors', JSON.stringify(b.errors))
b.close()

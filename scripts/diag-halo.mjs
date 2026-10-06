import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const photo = process.env.PHOTO || 'IMG_20260201_181608.jpg'
const b = await browserSession('halo', 9291)
const { evaluate, send, navigate, until } = b
await send('Network.setCacheDisabled', { cacheDisabled: true })
await navigate(`${base}/?v=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
await until(`document.querySelector('.photoImgHigh')?.naturalWidth>0 && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
await evaluate('document.fonts.ready')
await sleep(500)
const meta = await evaluate(`document.querySelector('.dockMeta').getBoundingClientRect().toJSON()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: meta.x + meta.width / 2, y: meta.y + meta.height / 2 })
await sleep(700)
const info = await evaluate(`JSON.stringify([...document.querySelectorAll('.dockBar .dockAction, .dockBar .dockMetaItem')].map(e=>({
  t:e.textContent.trim().slice(0,10), halo:e.dataset.halo||'-',
  filter:getComputedStyle(e).filter.slice(0,40), bgPos:getComputedStyle(e).backgroundPosition,
  visible: getComputedStyle(e).webkitBackgroundClip||getComputedStyle(e).backgroundClip})))`)
console.log(info)
const r = await evaluate(`(()=>{const bar=document.querySelector('.dockBar').getBoundingClientRect();return {x:bar.right-bar.width*0.46,y:bar.y-6,width:bar.width*0.48,height:bar.height+12}})()`)
const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 4 } })
await writeFile(`${b.out}/right-zoom.png`, Buffer.from(s.data, 'base64'))
const r2 = await evaluate(`(()=>{const bar=document.querySelector('.dockBar').getBoundingClientRect();return {x:bar.x-6,y:bar.y-6,width:bar.width*0.42,height:bar.height+12}})()`)
const s2 = await send('Page.captureScreenshot', { format: 'png', clip: { ...r2, scale: 4 } })
await writeFile(`${b.out}/left-zoom.png`, Buffer.from(s2.data, 'base64'))
console.log('errors', JSON.stringify(b.errors))
b.close()

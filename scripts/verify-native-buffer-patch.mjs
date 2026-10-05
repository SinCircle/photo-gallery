import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const baseline = process.argv.includes('--baseline')
const dir = 'docs/verification/2026-10-05-capsules'
await mkdir(dir, { recursive: true })
const browser = await browserSession('capsule-buffer-parity', 9272)
try {
  await browser.navigate('http://127.0.0.1:5176/#/photo/!IMG_20260103_160706.jpg')
  await browser.until(`document.querySelector('.dockInner')?.dataset.glass==='webgl' && document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const r = await browser.evaluate(`document.querySelector('[data-glass-capsule="exif"]').getBoundingClientRect().toJSON()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 20, y: r.y + 18 })
  await browser.until(`!document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
  await browser.evaluate(`(()=>{const c=document.createElement('canvas');c.width=1440;c.height=1000;c.style.cssText='position:fixed;inset:0;z-index:19;pointer-events:none';document.querySelector('.photoShell').append(c);const ctx=c.getContext('2d');ctx.fillStyle='#a0a0a0';ctx.fillRect(0,0,1440,1000);for(let y=0;y<1000;y+=11)for(let x=0;x<1440;x+=17){ctx.fillStyle=(x/17+y/11)%2?'#2551bb':'#da731c';ctx.fillRect(x,y,8,5)}document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))})()`)
  await sleep(400)
  const pixels = await browser.evaluate(`[...document.querySelectorAll('[data-glass-capsule]')].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>{const c=e.querySelector('[data-glass-output]');return {name:e.dataset.glassCapsule,width:c.width,height:c.height,pixels:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}})`)
  const hashes = pixels.map(({ pixels: values, ...rest }) => ({ ...rest, sha256: createHash('sha256').update(Buffer.from(values)).digest('hex') }))
  if (baseline) await writeFile(`${dir}/buffer-pixels-baseline.json`, JSON.stringify(pixels))
  else {
    const before = JSON.parse(await readFile(`${dir}/buffer-pixels-baseline.json`, 'utf8'))
    assert.deepEqual(pixels, before, 'The buffer optimization must preserve every actual output RGBA byte')
  }
  await writeFile(`${dir}/buffer-parity-${baseline ? 'before' : 'after'}.json`, JSON.stringify({ status: 'passed', baseline, hashes, errors: browser.errors }, null, 2))
  assert.deepEqual(browser.errors, [])
  console.log(`PASS ${baseline ? 'baseline capture' : 'exact RGBA parity'}: ${hashes.length} native outputs`)
} finally { browser.close() }

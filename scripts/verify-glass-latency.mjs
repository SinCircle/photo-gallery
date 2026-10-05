import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { browserSession } from './browser-session.mjs'

const baseline = process.argv.includes('--baseline')
const base = process.env.VERIFY_URL || 'http://127.0.0.1'
const browser = await browserSession(baseline ? 'glass-latency-baseline' : 'glass-latency', 9260)
const { navigate, evaluate, until, send } = browser
const report = { base, baseline, startedAt: new Date().toISOString(), method: 'Change actual canvas pixels and position behind the toolbar while a trusted pointer is held; read rendered glass pixels, not dataset, URL generation or rAF count. Each sample changes on a frame and polls real pixels until their color changes.', errors: browser.errors }
try {
  await navigate(`${base}/#/photo/!IMG_20260103_160706.jpg`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const box = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await until(`document.querySelector('.dockInner').dataset.glass==='webgl' && !document.querySelector('.dockInner').getAnimations().length`)
  await evaluate(`(()=>{const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect(),c=document.createElement('canvas');c.id='latency-fixture';c.width=Math.ceil(r.width+100);c.height=Math.ceil(r.height+100);c.style.cssText='position:fixed;pointer-events:none;z-index:19;left:'+(r.x-50)+'px;top:'+(r.y-50)+'px;width:'+c.width+'px;height:'+c.height+'px';document.querySelector('.photoShell').append(c);window.paintFixture=blue=>{const ctx=c.getContext('2d');ctx.fillStyle=blue?'rgb(20,20,240)':'rgb(240,20,20)';ctx.fillRect(0,0,c.width,c.height);c.style.left=(r.x-50+(blue?1:0))+'px';bar.dispatchEvent(new Event('glassrefresh'))};paintFixture(false)})()`)
  await evaluate(`window.readGlass=async()=>{const bar=document.querySelector('.dockInner'),live=bar.querySelector('canvas[data-glass-output]');if(live){const r=bar.getBoundingClientRect(),b=live.getBoundingClientRect();return [...live.getContext('2d').getImageData(Math.floor((r.x+r.width/2-b.x)*live.width/b.width),Math.floor((r.y+r.height/2-b.y)*live.height/b.height),1,1).data]}const url=getComputedStyle(bar).backgroundImage.slice(5,-2);if(!url||url==='')return [0,0,0,0];if(window.pixelURL!==url){const img=await createImageBitmap(await(await fetch(url)).blob());const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);img.close();window.pixelCanvas=c;window.pixelURL=url}const c=window.pixelCanvas;return [...c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]}`)
  await until(`(async()=>{const p=await readGlass();return p[0]-p[2]>60})()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 })
  const samples = await evaluate(`(async()=>{const result=[];for(let i=0;i<${baseline ? 1 : 120};i++){await new Promise(requestAnimationFrame);const blue=i%2===0,start=performance.now();paintFixture(blue);let pixels,latency;do{pixels=await readGlass();if(blue?pixels[2]-pixels[0]>60:pixels[0]-pixels[2]>60){latency=performance.now()-start;break}if(performance.now()-start>${baseline ? 1000 : 200})break;await new Promise(r=>setTimeout(r,0))}while(true);result.push({index:i,blue,latencyMs:latency??null,timedOut:latency===undefined,pixels});if(latency===undefined)break}return result})()`)
  report.samples = samples
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 })
  if (baseline) { assert.equal(samples[0].timedOut, true); report.status = 'baseline-stall-reproduced'; console.log('BASELINE: actual glass pixels unchanged after 1000ms while pointer held') }
  else {
    assert.equal(samples.length, 120)
    assert.ok(samples.every(s => !s.timedOut))
    const times = samples.map(s => s.latencyMs).sort((a,b) => a-b)
    report.summary = { count: times.length, medianMs: times[60], p95Ms: times[114], maxMs: times.at(-1) }
    assert.ok(report.summary.maxMs < 16, JSON.stringify(report.summary))
    assert.deepEqual(browser.errors, [])
    report.status = 'passed'
    console.log('PASS actual pixel latency:', JSON.stringify(report.summary))
  }
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out+'/results.json',JSON.stringify(report,null,2)); browser.close() }

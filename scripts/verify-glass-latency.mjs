import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const baseline = process.argv.includes('--baseline')
const base = process.env.VERIFY_URL || 'http://127.0.0.1'
const browser = await browserSession(baseline ? 'glass-latency-baseline' : 'glass-latency', 9260)
const { navigate, evaluate, until, send, shot } = browser
const report = { base, baseline, startedAt: new Date().toISOString(), graphics: browser.graphics, browser: browser.version.product,
  method: 'Three separate real-input states. A canvas under the toolbar alternates red/blue at each background mutation. Timing starts immediately after its fillRect. Completion requires reading matching actual rendered output pixels. Live canvas drawImage is instrumented only in the test to read pixels immediately after a paint (no timer-poll quantization); legacy CSS PNG is decoded and sampled. Trusted CDP drag/wheel events also change the real photo transform. Idle samples continue without input, including after collapse. No dataset, URL or rAF counter constitutes completion.', cases: [], errors: browser.errors }
report.servedModule = (await (await fetch(base)).text()).match(/<script[^>]+src="([^"]+)"/)?.[1]
report.pixelReadback = 'Copy each visible glass output pixel to a separate 1x1 CPU canvas and read RGBA there. A sample completes only after every visible capsule matches the changed background. Timing includes copy/readback; the test does not change the display canvas backing.'
try {
  for (const name of ['held-pointer-drag', 'wheel', 'released-idle']) {
    await navigate(`${base}/?latency=${name}#/photo/!IMG_20260103_160706.jpg`)
    await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
    const box = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: -400 })
    await until(`document.querySelector('.dockInner').dataset.glass==='webgl' && !document.querySelector('.dockInner').getAnimations({subtree:true}).length`)
    await sleep(300)
    await evaluate(`(()=>{
      const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect(),c=document.createElement('canvas');
      c.id='latency-fixture';c.width=1440;c.height=200;c.style.cssText='position:fixed;pointer-events:none;z-index:19;left:0;bottom:0;width:1440px;height:200px';document.querySelector('.photoShell').append(c);
      window.paintFixture=blue=>{const ctx=c.getContext('2d');ctx.fillStyle=blue?'rgb(20,20,240)':'rgb(240,20,20)';ctx.fillRect(0,0,c.width,c.height);const start=performance.now();c.style.left=(blue?1:0)+'px';bar.dispatchEvent(new Event('glassrefresh'));return start};
      const probe=document.createElement('canvas');probe.width=probe.height=1;const probeCtx=probe.getContext('2d',{willReadFrequently:true});
      window.liveOutputs=()=>[...bar.querySelectorAll('canvas[data-glass-output]')].filter(c=>{const p=c.parentElement,r=p.getBoundingClientRect(),s=getComputedStyle(p);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&+s.opacity>.01});
      window.readLivePixels=live=>{probeCtx.clearRect(0,0,1,1);probeCtx.drawImage(live,Math.floor(live.width/2),Math.floor(live.height/2),1,1,0,0,1,1);return [...probeCtx.getImageData(0,0,1,1).data]};
      window.readGlass=async()=>{const live=liveOutputs()[0];if(live)return readLivePixels(live);
        if(bar.querySelector('canvas[data-glass-output]'))return [0,0,0,0];
        const url=getComputedStyle(bar).backgroundImage.slice(5,-2);if(!url)return [0,0,0,0];if(window.pixelURL!==url){const img=await createImageBitmap(await(await fetch(url)).blob());const target=document.createElement('canvas');target.width=img.width;target.height=img.height;target.getContext('2d').drawImage(img,0,0);img.close();window.pixelCanvas=target;window.pixelURL=url}const target=window.pixelCanvas;return [...target.getContext('2d').getImageData(Math.floor(target.width/2),Math.floor(target.height/2),1,1).data]};
      paintFixture(false);
      window.armSample=(index,blue)=>{
        window.pendingSample=new Promise(resolve=>{window.sampleResolve=resolve});window.sampleState={index,blue,matched:new Map()};
      };
      window.beginSample=()=>{
        const s=window.sampleState;if(!s||s.start!==undefined)return;
        s.start=paintFixture(s.blue);
        s.deadline=setTimeout(()=>finish(null,[]),${baseline ? 1050 : 250});
        if(!bar.querySelector('canvas[data-glass-output]'))poll();
      };
      const finish=(latency,pixels)=>{const s=window.sampleState;if(!s||s.start===undefined)return;clearTimeout(s.deadline);window.sampleState=null;sampleResolve({index:s.index,blue:s.blue,latencyMs:latency,timedOut:latency===null,pixels,outputs:[...s.matched.values()],sourceChangedAt:s.start,inputPaintAt:s.inputPaintAt,copyStartedAt:s.copyStartedAt,outputReadAt:s.outputReadAt,toolbar:bar.dataset.toolbar,pan:document.querySelector('.photoPan').style.transform,zoom:document.querySelector('.photoZoom').style.transform})};
      const check=async(live)=>{const s=window.sampleState;if(!s||s.start===undefined)return;const pixels=live?readLivePixels(live):await readGlass();s.outputReadAt=performance.now();if(!(s.blue?pixels[2]-pixels[0]>60:pixels[0]-pixels[2]>60))return;if(live){s.matched.set(live,{name:live.dataset.glassOutput||'legacy-panel',pixels,readAt:s.outputReadAt,latencyMs:s.outputReadAt-s.start});const visible=liveOutputs();if(!visible.length||!visible.every(c=>s.matched.has(c)))return}finish(s.outputReadAt-s.start,pixels)};
      const poll=async()=>{await check();if(window.sampleState?.start!==undefined)setTimeout(poll,0)};
      for(const output of bar.querySelectorAll('canvas[data-glass-output]')){const ctx=output.getContext('2d'),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{if(window.sampleState?.start!==undefined)sampleState.copyStartedAt=performance.now();draw(...args);void check(output)}};
      const input=bar.querySelector('canvas[data-glass-scene]');if(input){const ctx=input.getContext('2d'),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{draw(...args);if(args[0]===c&&window.sampleState?.start!==undefined)sampleState.inputPaintAt=performance.now()}};
      window.addEventListener('pointermove',beginSample);window.addEventListener('wheel',beginSample);
    })()`)
    await until(`(async()=>{const p=await readGlass();return p[0]-p[2]>60})()`)
    const before = await evaluate(`({pan:document.querySelector('.photoPan').style.transform,zoom:document.querySelector('.photoZoom').style.transform})`)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450 })
    if (name !== 'wheel') await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 })
    if (name === 'released-idle') {
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 })
      await sleep(700)
    }
    if (baseline && name === 'wheel') await evaluate(`window.continuousWheel=setInterval(()=>window.dispatchEvent(new WheelEvent('wheel',{deltaY:1})),25)`)
    const samples = []
    for (let i = 0; i < (baseline ? 3 : 60); i++) {
      await evaluate(`(async()=>{const p=await readGlass();armSample(${i},p[0]>p[2])})()`)
      if (name === 'held-pointer-drag') await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 650 + i * 2, y: 460 + i % 9, buttons: 1 })
      else if (name === 'wheel') await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: i % 2 ? 12 : -12 })
      else { await sleep(80); await evaluate(`beginSample()`) }
      samples.push(await evaluate(`pendingSample`))
    }
    if (name === 'held-pointer-drag') await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 770, y: 460, button: 'left', clickCount: 1 })
    if (baseline && name === 'wheel') await evaluate(`clearInterval(continuousWheel)`)
    const times = samples.filter(s => !s.timedOut).map(s => s.latencyMs).sort((a,b) => a-b)
    const contextAttributes = await evaluate(`[...document.querySelectorAll('[data-glass-output]')].map(c=>({name:c.dataset.glassOutput,attributes:c.getContext('2d').getContextAttributes()}))`)
    const result = { name, before, contextAttributes, samples, summary: { count: samples.length, timeoutCount: samples.filter(s => s.timedOut).length,
      medianMs: times[Math.floor(times.length / 2)] ?? null, p95Ms: times[Math.floor(times.length * .95)] ?? null, maxMs: times.at(-1) ?? null },
      passed: samples.every(s => !s.timedOut && s.latencyMs < 16) }
    report.cases.push(result)
    await shot(name)
    console.log(`${baseline ? 'BASELINE' : 'MEASURED'} ${name}: ${JSON.stringify(result.summary)} pass=${result.passed}`)
    await writeFile(browser.out+'/results.json',JSON.stringify(report,null,2))
    if (!baseline && name === 'held-pointer-drag') assert.ok(samples.some(s => s.pan !== before.pan), 'The real photo must pan')
    if (!baseline && name === 'wheel') assert.ok(samples.some(s => s.zoom !== before.zoom), 'The real photo must zoom')
  }
  if (baseline) { assert.ok(report.cases.every(c => !c.passed)); report.status = 'baseline-failures-reproduced' }
  else { assert.ok(report.cases.every(c => c.passed), 'Every sample in all three states must be <16ms'); assert.deepEqual(browser.errors, []); report.status = 'passed' }
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out+'/results.json',JSON.stringify(report,null,2)); browser.close() }

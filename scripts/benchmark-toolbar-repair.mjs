import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession(process.env.BENCH_NAME || 'toolbar-repair-performance', 9315)
const report = { method: '1440x1000, DPR 1, hardware-accelerated headless Chrome; fresh documents, alternating comparison order when multiple URLs are supplied. Each input scenario sends 120 trusted CDP events at 60Hz targets (overloaded runs may take longer). FPS is measured from actual rAF intervals; CPU is total main-document time across the full input sequence. No concurrent browser benchmarks.', graphics: b.graphics, browser: b.version.product, runs: [], errors: b.errors }
const bases = (process.env.BENCH_URLS || 'http://127.0.0.1:5189,http://127.0.0.1:5187').split(',')
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.repairs={ink:0,scene:0,reads:0,png:0};
  document.addEventListener('dockink',()=>repairs.ink++);
  document.addEventListener('glassscene',()=>repairs.scene++,true);
  const read=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=function(...args){repairs.reads++;return read.apply(this,args)};
  const png=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...args){repairs.png++;return png.apply(this,args)};
` })
try {
  for (let repeat = 0; repeat < Number(process.env.BENCH_REPETITIONS || 2); repeat++) {
    for (const base of repeat % 2 ? bases.toReversed() : bases) {
      await b.navigate(`${base}/?repair=${repeat}#/photo/IMG_20260815_153938.jpg`)
      await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
      const rect = await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
      await b.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:720, y:rect.y+rect.height/2 })
      await sleep(2100)
      for (const scenario of ['idle-expanded', 'hover', 'drag', 'wheel', 'idle-collapsed']) {
        if (scenario === 'drag') {
          await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:720, y:450, deltaX:0, deltaY:-600 })
          await sleep(400)
          await b.send('Input.dispatchMouseEvent', { type:'mousePressed', x:720, y:450, button:'left', clickCount:1 })
        }
        if (scenario === 'idle-collapsed') {
          await b.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:720, y:450 })
          await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').dataset.moving`)
          await sleep(200)
        }
        await b.send('Performance.enable')
        const before = await b.send('Performance.getMetrics')
        await b.evaluate(`window.startCounts={...repairs,draws:__metrics.draws};window.frameTimes=[];window.measuring=true;window.prev=0;__metrics.longTasks=[];window.panBefore=document.querySelector('.photoPan').style.transform;window.zoomBefore=document.querySelector('.photoZoom').style.transform;window.zoomChanged=false;requestAnimationFrame(function frame(t){if(prev)frameTimes.push(t-prev);prev=t;zoomChanged ||= document.querySelector('.photoZoom').style.transform!==zoomBefore;if(measuring)requestAnimationFrame(frame)})`)
        const start = performance.now()
        for (let i=0; i<120; i++) {
          await sleep(Math.max(0,start+i*1000/60-performance.now()))
          if (scenario === 'hover') await b.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:680+Math.sin(i/5)*30, y:rect.y+rect.height/2 })
          if (scenario === 'drag') await b.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:720+Math.sin(i/15)*110, y:450+Math.sin(i/10)*80, buttons:1 })
          if (scenario === 'wheel') await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:720, y:450, deltaX:0, deltaY:i<60?-2:2 })
        }
        const result = await b.evaluate(`(()=>{measuring=false;const times=frameTimes.toSorted((a,b)=>a-b);return {fps:1000*times.length/times.reduce((s,x)=>s+x,0),p95:times[Math.floor(times.length*.95)],max:times.at(-1),longTasks:__metrics.longTasks,counts:Object.fromEntries(Object.entries({...repairs,draws:__metrics.draws}).map(([k,v])=>[k,v-startCounts[k]])),panChanged:panBefore!==document.querySelector('.photoPan').style.transform,zoomChanged,glass:document.querySelector('.dockInner').dataset.glass}})()`)
        result.elapsedMs = performance.now()-start
        const after = await b.send('Performance.getMetrics')
        result.cpu = Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name => [name,1000*(after.metrics.find(m=>m.name===name).value-before.metrics.find(m=>m.name===name).value)]))
        report.runs.push({base,repeat,scenario,...result})
        assert.equal(result.glass,'webgl')
        if (scenario==='drag') assert.ok(result.panChanged,'Real drag must pan the photo')
        if (scenario==='wheel') assert.ok(result.zoomChanged,'Real wheel must zoom the photo')
        console.log(JSON.stringify(report.runs.at(-1)))
        if (scenario === 'drag') await b.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:720, y:450, button:'left', clickCount:1 })
      }
    }
  }
  assert.deepEqual(b.errors,[])
} finally { await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close() }

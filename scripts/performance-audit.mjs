import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b=await browserSession(process.env.PERF_NAME||'performance-20261007',9370)
const bases=(process.env.PERF_URLS||'http://127.0.0.1:5196').split(',')
const repeats=Number(process.env.PERF_REPEATS||1)
const layouts=(process.env.PERF_LAYOUTS||'desktop,mobile').split(',').map(value=>value==='mobile')
const report={browser:b.version,graphics:b.graphics,method:'Production bundles, sequential tests, desktop 1440x1000 DPR1 CPU1x; mobile 390x844 DPR3 CPU4x. Cold gallery uses 120ms RTT / 1.6Mbps; interactions run unthrottled network. Frame intervals are document RAF cadence, not hardware presented FPS.',runs:[],errors:b.errors}
const stats=values=>{const s=[...values].sort((a,z)=>a-z);return {count:s.length,p95:s[Math.floor(s.length*.95)]||0,max:s.at(-1)||0,total:s.reduce((a,z)=>a+z,0)}}
await b.send('Performance.enable')
await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.audit={lcp:0,events:[],canvas:{reads:0,readMs:0,draws:0,drawMs:0},ink:0};
  new PerformanceObserver(list=>{for(const e of list.getEntries())audit.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});
  document.addEventListener('phototransition',e=>audit.events.push({...e.detail,at:performance.now()}));
  document.addEventListener('dockink',()=>audit.ink++);
  for(const [method,count,time] of [['getImageData','reads','readMs'],['drawImage','draws','drawMs']]){const original=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){const t=performance.now();const result=original.apply(this,args);audit.canvas[count]++;audit.canvas[time]+=performance.now()-t;return result}}
`})
const resetMetrics=()=>b.evaluate(`window.phaseStart=performance.now();window.countBefore={...audit.canvas,ink:audit.ink,raf:__metrics.executed,drawsGL:__metrics.draws};__metrics.longTasks=[];window.frameSamples=[];window.measuring=true;window.lastFrame=0;window.phasePan=document.querySelector('.photoPan');window.phaseZoom=document.querySelector('.photoZoom');window.initialPan=phasePan?.style.transform;window.initialZoom=phaseZoom?.style.transform;window.inputChanged=false;requestAnimationFrame(function frame(t){inputChanged ||= phasePan?.style.transform!==initialPan || phaseZoom?.style.transform!==initialZoom;if(lastFrame)frameSamples.push(t-lastFrame);lastFrame=t;if(measuring)requestAnimationFrame(frame)})`)
const measure=async(name,action,profile=false)=>{
  const before=await b.send('Performance.getMetrics')
  await resetMetrics()
  if(profile){await b.send('Profiler.enable');await b.send('Profiler.start')}
  await action()
  if(profile){const p=(await b.send('Profiler.stop')).profile;await writeFile(b.out+'/'+name+'.cpuprofile',JSON.stringify(p))}
  const value=await b.evaluate(`(()=>{measuring=false;return {elapsed:performance.now()-phaseStart,inputChanged,frames:frameSamples,longTasks:__metrics.longTasks.filter(t=>t.start>=phaseStart),counts:Object.fromEntries(Object.entries({...audit.canvas,ink:audit.ink,raf:__metrics.executed,drawsGL:__metrics.draws}).map(([k,v])=>[k,v-countBefore[k]]))}})()`)
  const after=await b.send('Performance.getMetrics')
  value.cpu=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,1000*(after.metrics.find(m=>m.name===k).value-before.metrics.find(m=>m.name===k).value)]))
  value.frames=stats(value.frames);value.longTasks=stats(value.longTasks.map(t=>t.duration))
  return value
}
const readyPhoto=()=>b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
const layout=async mobile=>{
  await b.send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1000,deviceScaleFactor:mobile?3:1,mobile})
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5})
  await b.send('Emulation.setCPUThrottlingRate',{rate:mobile?4:1})
}
const navigate=async(url,mobile)=>{
  // browserSession.navigate resets DPR; set the desired metrics before loading.
  await layout(mobile)
  await b.send('Page.navigate',{url})
  await b.until(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'`)
}
try {
  for(let repeat=0;repeat<repeats;repeat++)for(const base of repeat%2?bases.toReversed():bases)for(const mobile of layouts) {
    const row={base,repeat,mobile,phases:{}}
    report.runs.push(row)
    await b.send('Page.navigate',{url:'about:blank'})
    await b.until(`location.href==='about:blank'&&document.readyState==='complete'`)
    await b.send('Network.setCacheDisabled',{cacheDisabled:false})
    await b.send('Network.clearBrowserCache')
    await b.send('Network.emulateNetworkConditions',{offline:false,latency:120,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8})
    const url=base+'/?performance='+repeat+'-'+mobile+'#/'
    await navigate(url,mobile)
    await b.until(`document.querySelectorAll('.tile').length===44&&[...document.querySelectorAll('.tile img')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(e=>e.complete&&e.naturalWidth>0)`)
    await sleep(600)
    row.cold=await b.evaluate(`({ready:performance.now(),fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:audit.lcp,cls:__metrics.cls,longTasks:__metrics.longTasks,heap:performance.memory?.usedJSHeapSize,resources:performance.getEntriesByType('resource').map(r=>({url:r.name,type:r.initiatorType,bytes:r.transferSize,encoded:r.encodedBodySize,ms:r.duration})),navigation:performance.getEntriesByType('navigation')[0].toJSON()})`)
    await b.shot('gallery-'+new URL(base).port+'-'+mobile)
    await b.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
    await b.evaluate(`window.target=[...document.querySelectorAll('.tile')].find(e=>e.dataset.photoId==='IMG_20260815_153938.jpg');target.scrollIntoView({block:'center'})`)
    await b.until(`target.querySelector('img').naturalWidth>0`)
    row.phases.open=await measure('open-'+new URL(base).port+'-'+mobile,async()=>{
      await b.evaluate('target.click()');await readyPhoto()
    },process.env.PERF_PROFILE==='1')
    // Fix keyboard focus inside the toolbar so both builds measure its fully
    // expanded local contrast work instead of letting the idle timer hide it.
    await b.evaluate(`document.querySelector('.dockBar').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));document.querySelector('.dockBack').focus({preventScroll:true})`)
    await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
    await sleep(700)
    const cx=mobile?195:720,cy=mobile?420:450
    await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:cx,y:cy,deltaX:0,deltaY:-650})
    await sleep(800)
    const touch=(type,points)=>b.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:4,radiusY:4,force:1}))})
    if(mobile) {
      // Enlarge far enough that the landscape photo really moves behind the
      // bottom glass during both gesture phases, rather than sampling a fixed
      // page-colour margin while the photo changes elsewhere on screen.
      await touch('touchStart',[[1,cx-45,cy],[2,cx+45,cy]])
      for(let half=60;half<=150;half+=15){await touch('touchMove',[[1,cx-half,cy],[2,cx+half,cy]]);await sleep(50)}
      await touch('touchEnd',[]);await sleep(500)
    }
    for(const kind of mobile?['pinch','drag','wheel']:['wheel','drag']) {
      if(mobile&&kind!=='wheel')await touch('touchStart',kind==='pinch'?[[1,cx-45,cy],[2,cx+45,cy]]:[[1,cx,cy]])
      else if(kind==='drag')await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:cx,y:cy,button:'left',clickCount:1})
      await b.evaluate(`document.querySelector('.dockBar').dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));document.querySelector('.dockBack').focus({preventScroll:true})`)
      await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
      const geometryBefore=await b.evaluate(`({pan:document.querySelector('.photoPan').style.transform,zoom:document.querySelector('.photoZoom').style.transform})`)
      row.phases[kind]=await measure(kind+'-'+new URL(base).port+'-'+mobile,async()=>{
        const start=performance.now()
        for(let i=0;i<90;i++) {
          await sleep(Math.max(0,start+i*1000/60-performance.now()))
          if(kind==='pinch'){const half=45+Math.sin(i/20)*15;await touch('touchMove',[[1,cx-half,cy],[2,cx+half,cy]])}
          else if(kind==='wheel')await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:cx,y:cy,deltaX:0,deltaY:i<45?-3:3})
          else if(mobile)await touch('touchMove',[[1,cx+Math.sin(i/10)*70,cy+Math.sin(i/13)*50]])
          else await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:cx+Math.sin(i/10)*70,y:cy+Math.sin(i/13)*50,buttons:1})
        }
        if(mobile&&kind!=='wheel')await touch('touchEnd',[])
        else if(kind==='drag')await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:cx,y:cy,button:'left',clickCount:1})
        await sleep(450)
      },process.env.PERF_PROFILE==='1')
      const geometryAfter=await b.evaluate(`({pan:document.querySelector('.photoPan').style.transform,zoom:document.querySelector('.photoZoom').style.transform})`)
      assert.ok(row.phases[kind].inputChanged,'Input must really move the photo')
      row.phases[kind].endState=await b.evaluate(`({glass:document.querySelector('.dockInner').dataset.glass,toolbar:document.querySelector('.dockInner').dataset.toolbar,scale:visualViewport.scale,geometry:${JSON.stringify(geometryAfter)}})`)
    }
    await sleep(800)
    const idleBefore=await b.evaluate(`({raf:__metrics.executed,draws:__metrics.draws})`)
    await sleep(900)
    row.idle=await b.evaluate(`({raf:__metrics.executed-${idleBefore.raf},draws:__metrics.draws-${idleBefore.draws}})`)
    row.phases.close=await measure('close-'+new URL(base).port+'-'+mobile,async()=>{
      await b.evaluate(`location.hash='#/'`);await b.until(`document.querySelector('.tile')&&!document.documentElement.dataset.photoTransition`)
    })
    await navigate(url.replace('performance=','warmperformance='),mobile)
    await b.until(`document.querySelector('.tile img')?.naturalWidth>0`)
    await sleep(500)
    row.warm=await b.evaluate(`({ready:performance.now(),fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:audit.lcp,bytes:performance.getEntriesByType('resource').reduce((s,r)=>s+r.transferSize,0),resources:performance.getEntriesByType('resource').map(r=>({url:r.name,bytes:r.transferSize}))})`)
    console.log(JSON.stringify({base,repeat,mobile,cold:{fcp:row.cold.fcp,lcp:row.cold.lcp,ready:row.cold.ready,bytes:row.cold.resources.reduce((s,r)=>s+r.bytes,0)},phases:row.phases,idle:row.idle,warm:row.warm.ready}))
    await writeFile(b.out+'/results.json',JSON.stringify(report,null,2))
  }
  assert.deepEqual(b.errors,[])
  report.status='measured'
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error)}
finally{await b.send('Emulation.setCPUThrottlingRate',{rate:1});await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

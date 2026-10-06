import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b=await browserSession(process.env.NAV_NAME || 'performance-sweep/navigation',9332)
const bases=(process.env.NAV_URLS || 'http://127.0.0.1:5192,http://127.0.0.1:5187').split(',')
const report={browser:b.version.product,graphics:b.graphics,runs:[],errors:b.errors}
await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.navMetrics={events:[],animations:[]};
  const original=document.startViewTransition?.bind(document);
  if(original)document.startViewTransition=update=>{
    const started=performance.now(),vt=original(update);
    vt.ready.then(()=>navMetrics.events.push({name:'transition-ready',at:performance.now(),duration:performance.now()-started})).catch(()=>{});
    vt.finished.then(()=>navMetrics.events.push({name:'transition-finished',at:performance.now(),duration:performance.now()-started})).catch(()=>{});
    return vt;
  };
  document.addEventListener('phototransition',event=>navMetrics.events.push({name:'transition-'+event.detail.phase,at:performance.now()}));
  document.addEventListener('load',e=>{if(e.target.matches?.('.photoImgHigh'))navMetrics.events.push({name:'high-load',at:performance.now()})},true);
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){const start=performance.now();const a=animate.call(this,frames,options);navMetrics.animations.push({ms:performance.now()-start,frames:frames.length,class:this.className});return a};
`})
try{
  for(let repeat=0;repeat<Number(process.env.NAV_REPETITIONS || 1);repeat++)for(const base of repeat%2?bases.toReversed():bases){
    for(const mobile of [false,true]){
      await b.send('Emulation.setCPUThrottlingRate',{rate:mobile?4:1})
      await b.navigate(base+'/?nav='+repeat+'-'+mobile+'#/',mobile?390:1440,mobile?844:1000)
      await b.send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1000,deviceScaleFactor:mobile?2:1,mobile:false})
      await b.until(`document.querySelector('.tile img')?.naturalWidth>0`)
      await b.evaluate(`window.target=[...document.querySelectorAll('.tile')].find(t=>t.dataset.photoId==='IMG_20260815_153938.jpg')||document.querySelector('.tile');target.scrollIntoView({block:'center'})`)
      await b.until(`target.querySelector('img').naturalWidth>0`)
      await sleep(350)
      await b.send('Performance.enable')
      const before=await b.send('Performance.getMetrics')
      if(process.env.NAV_PROFILE){await b.send('Profiler.enable');await b.send('Profiler.start')}
      await b.evaluate(`window.started=performance.now();navMetrics.events=[];navMetrics.animations=[];__metrics.longTasks=[];window.frames=[];window.sampling=true;window.samplePrevious=performance.now();requestAnimationFrame(function tick(t){frames.push({at:t,dt:t-samplePrevious});samplePrevious=t;if(sampling)requestAnimationFrame(tick)});target.click()`)
      await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.documentElement.dataset.photoTransition && !document.querySelector('.dockInner').dataset.moving`,60000)
      const after=await b.send('Performance.getMetrics')
      let profile
      if(process.env.NAV_PROFILE){
        profile=(await b.send('Profiler.stop')).profile
        await writeFile(b.out+'/open-'+new URL(base).port+'-'+mobile+'-'+repeat+'.cpuprofile',JSON.stringify(profile))
      }
      const open=await b.evaluate(`(()=>{sampling=false;const stats=a=>{const f=a.map(f=>f.dt).sort((a,b)=>a-b);return {frames:f.length,p95:f[Math.floor(f.length*.95)],max:f.at(-1),over33:f.filter(t=>t>33.4).length}};const motionStart=navMetrics.events.find(e=>e.name==='transition-ready')?.at||started,motionEnd=navMetrics.events.find(e=>e.name==='transition-finished')?.at||performance.now();const motion=stats(frames.filter(f=>f.at-f.dt>=motionStart&&f.at<=motionEnd));const f=frames.filter(f=>f.at-started<1100).map(f=>f.dt).sort((a,b)=>a-b);return {motion,elapsed:performance.now()-started,first1100ms:{frames:f.length,p95:f[Math.floor(f.length*.95)],max:f.at(-1),over33:f.filter(t=>t>33.4).length},events:navMetrics.events.map(e=>({...e,at:e.at-started})),animations:navMetrics.animations,longTasks:__metrics.longTasks.filter(t=>t.start>=started),image:document.querySelector('.photoImgHigh').currentSrc,imageWidth:document.querySelector('.photoImgHigh').naturalWidth,resources:performance.getEntriesByType('resource').filter(r=>r.startTime>=started&&r.name.includes('/media/')).map(r=>({url:r.name,bytes:r.encodedBodySize,ms:r.duration}))}})()`)
      open.cpu=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.metrics.find(m=>m.name===name).value-before.metrics.find(m=>m.name===name).value)]))
      if(profile)open.hot=profile.nodes.filter(n=>n.hitCount).toSorted((a,b)=>b.hitCount-a.hitCount).slice(0,16).map(n=>({name:n.callFrame.functionName,hits:n.hitCount,line:n.callFrame.lineNumber}))
      await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:40,y:80})
      await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').dataset.moving`)
      await sleep(150)
      await b.evaluate(`window.idleBefore={raf:__metrics.executed,draws:__metrics.draws}`)
      const idleBefore=await b.send('Performance.getMetrics')
      await sleep(1000)
      const idleAfter=await b.send('Performance.getMetrics')
      const idle=await b.evaluate(`({raf:__metrics.executed-idleBefore.raf,draws:__metrics.draws-idleBefore.draws})`)
      idle.cpu=1000*(idleAfter.metrics.find(m=>m.name==='TaskDuration').value-idleBefore.metrics.find(m=>m.name==='TaskDuration').value)
      await b.evaluate(`started=performance.now();navMetrics.events=[];__metrics.longTasks=[];location.hash='#/'`)
      await b.until(`document.querySelector('.tile') && !document.documentElement.dataset.photoTransition`)
      const close=await b.evaluate(`({elapsed:performance.now()-started,events:navMetrics.events.map(e=>({...e,at:e.at-started})),longTasks:__metrics.longTasks.filter(t=>t.start>=started)})`)
      const row={base,repeat,mobile,cpuThrottle:mobile?4:1,open,idle,close}
      report.runs.push(row)
      console.log(JSON.stringify({base,mobile,openMs:open.elapsed,transition:open.events,frames:open.first1100ms,longTasks:open.longTasks,cpu:open.cpu,bytes:open.resources.reduce((s,r)=>s+r.bytes,0),animationSetupMs:open.animations.reduce((s,a)=>s+a.ms,0),idle,hot:open.hot}))
    }
  }
}finally{await b.send('Emulation.setCPUThrottlingRate',{rate:1});await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

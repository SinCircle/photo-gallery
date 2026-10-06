import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'
const b=await browserSession(process.env.LARGE_NAME || 'transition-details/large-zoom',9338)
const report={runs:[],errors:b.errors}
await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.events=[];window.drawTimes=[];
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){if(${!!process.env.LARGE_SKIP_GL_COPY} && args[0] instanceof HTMLCanvasElement && args[0].matches('[data-glass-output]'))return;const t=performance.now();const result=draw.apply(this,args);drawTimes.push({at:t,ms:performance.now()-t,source:args[0].className,width:this.canvas.width,height:this.canvas.height});return result};
  const native=document.startViewTransition.bind(document);
  document.startViewTransition=update=>{const vt=native(update);vt.ready.then(()=>events.push({phase:'ready',at:performance.now()})).catch(()=>{});vt.finished.then(()=>events.push({phase:'finished',at:performance.now()})).catch(()=>{});return vt};
  document.addEventListener('phototransition',e=>events.push({...e.detail,at:performance.now()}));
`})
try{
 for(let repeat=0;repeat<Number(process.env.LARGE_REPETITIONS || 2);repeat++)for(const port of process.env.LARGE_PORTS ? process.env.LARGE_PORTS.split(',').map(Number) : repeat?[5187,5193]:[5193,5187])for(const slow of process.env.LARGE_SLOW_ONLY ? [true] : [false,true]){
  await b.send('Emulation.setCPUThrottlingRate',{rate:slow?4:1})
  await b.navigate('http://127.0.0.1:'+port+'/?large='+repeat+'-'+slow+(process.env.LARGE_CACHED_GALLERY?'#/':'#/photo/IMG_20260815_153938.jpg'),slow?390:1440,slow?844:1000)
  if(process.env.LARGE_CACHED_GALLERY){await b.until(`document.querySelector('.tile img')?.naturalWidth>0`);await b.evaluate(`window.target=[...document.querySelectorAll('.tile')].find(t=>t.dataset.photoId==='IMG_20260815_153938.jpg');target.scrollIntoView({block:'center'})`);await b.until(`target.querySelector('img').naturalWidth>0`);await b.evaluate('target.click()')}
  await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockInner').dataset.moving`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:slow?195:720,y:450,deltaX:0,deltaY:-1800})
  await b.until(`document.querySelector('.photoImgHigh').currentSrc.includes('/media/originals/')`)
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').dataset.moving`)
  await sleep(200)
  await b.send('Performance.enable')
  const before=await b.send('Performance.getMetrics')
  if(process.env.LARGE_PROFILE){await b.send('Profiler.enable');await b.send('Profiler.start')}
  await b.evaluate(`window.zoomRect=document.querySelector('.photoZoom').getBoundingClientRect().toJSON();window.start=performance.now();events=[];drawTimes=[];__metrics.longTasks=[];window.frames=[];window.sampling=true;window.prev=performance.now();requestAnimationFrame(function tick(t){frames.push({at:t,dt:t-prev});prev=t;if(sampling)requestAnimationFrame(tick)});location.hash='#/'`)
  await b.until(`document.querySelector('#app .tile') && !document.documentElement.dataset.photoTransition`)
  const after=await b.send('Performance.getMetrics')
  if(process.env.LARGE_PROFILE)await writeFile(b.out+'/'+port+'-'+slow+'.cpuprofile',JSON.stringify((await b.send('Profiler.stop')).profile))
  const result=await b.evaluate(`(()=>{sampling=false;const elapsed=performance.now()-start;const sorted=frames.filter(f=>f.at>=start).map(f=>f.dt).sort((a,b)=>a-b);const ready=events.find(e=>e.phase==='ready')?.at;return {drawTimes,elapsed,ready:ready-start,events:events.map(e=>({...e,at:e.at-start})),rect:zoomRect,frames:sorted.length,p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),longTasks:__metrics.longTasks.filter(t=>t.start>=start),cleanup:document.querySelectorAll('.photoTransitionImage,.photoTransitionBackdrop,.photoTransitionToolbar').length}})()`)
  result.cpu=1000*(after.metrics.find(m=>m.name==='TaskDuration').value-before.metrics.find(m=>m.name==='TaskDuration').value)
  const row={port,repeat,slow,...result};report.runs.push(row);console.log(JSON.stringify(row))
 }
}finally{await b.send('Emulation.setCPUThrottlingRate',{rate:1});await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

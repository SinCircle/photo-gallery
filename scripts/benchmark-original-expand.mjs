import {writeFile} from 'node:fs/promises'
import {browserSession,sleep} from './browser-session.mjs'
const b=await browserSession(process.env.EXPAND_NAME||'original-expand',9347)
const bases=(process.env.EXPAND_URLS||'http://127.0.0.1:5195,http://127.0.0.1:5187').split(',')
const report={runs:[],errors:b.errors}
if(process.env.EXPAND_PROBE) await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
 document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(process.env.EXPAND_PROBE==='shadows'?'.dockShadow{display:none!important}':'.capsuleDock,.capsuleDock *{filter:none!important}')};document.head.append(style)});
`})
await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.bench={frames:[],events:[],ink:[],reads:[],animationSetup:[]};window.sampling=true;
  let last=performance.now();requestAnimationFrame(function tick(t){bench.frames.push({at:t,dt:t-last});last=t;if(sampling)requestAnimationFrame(tick)});
  const emit=EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent=function(event){const t=performance.now(),result=emit.call(this,event);if(event.type==='glassscene')bench.ink.push({at:t,ms:performance.now()-t});return result};
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(frames,timing){const t=performance.now(),a=animate.call(this,frames,timing);bench.animationSetup.push({at:t,ms:performance.now()-t,class:this.className});return a};
  const decode=HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode=function(){return decode.call(this).then(()=>{bench.events.push({name:this.src.includes('/media/originals/')?'original-decoded':'preview-decoded',at:performance.now()})})};
  const read=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=function(...args){const t=performance.now(),result=read.apply(this,args);bench.reads.push({at:t,ms:performance.now()-t,w:args[2],h:args[3]});return result};
  document.addEventListener('glassready',()=>bench.events.push({name:'glassready',at:performance.now()}),true);
  let root;new MutationObserver(()=>{if(!root&&(root=document.querySelector('.dockInner'))){const ob=new MutationObserver(records=>{for(const r of records)if(r.attributeName==='data-moving')bench.events.push({name:root.dataset.moving||'settled',at:performance.now()})});ob.observe(root,{attributes:true,attributeFilter:['data-moving']})}}).observe(document,{childList:true,subtree:true});
`})
try {
 for(const base of bases)for(const width of process.env.EXPAND_MOBILE ? [390] : [1440,390]) {
  const cpuRate=Number(process.env.EXPAND_CPU_RATE || (width===390?4:1))
  await b.send('Emulation.setCPUThrottlingRate',{rate:cpuRate})
  await b.send('Performance.enable')
  await b.send('Profiler.enable');await b.send('Profiler.start')
  await b.navigate(base+'/?expand-bench='+Date.now()+'#/photo/IMG_20260815_153938.jpg',width,844)
  await b.until(`document.querySelector('.dockBar')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')&&!document.querySelector('.dockInner').dataset.moving`)
  await sleep(150)
  const raw=await b.evaluate(`(()=>{sampling=false;return {...bench,longTasks:__metrics.longTasks,glass:JSON.parse(document.querySelector('.dockBar').dataset.config)}})()`)
  const profile=(await b.send('Profiler.stop')).profile
  const metrics=(await b.send('Performance.getMetrics')).metrics
  await writeFile(b.out+'/'+new URL(base).port+'-'+width+'.cpuprofile',JSON.stringify(profile))
  const start=raw.events.find(e=>e.name==='opening')?.at??0,end=raw.events.find(e=>e.name==='settled'&&e.at>start)?.at??start+1800
  const times=raw.frames.filter(f=>f.at>=start&&f.at<=end).map(f=>f.dt).sort((a,z)=>a-z)
  const original=raw.events.find(e=>e.name==='original-decoded')?.at??0
  const stats={frames:times.length,p95:times[Math.floor(times.length*.95)],max:times.at(-1),over33:times.filter(t=>t>33.4).length,
   cpu:metrics.filter(m=>['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].includes(m.name)),
   inkMs:raw.ink.filter(f=>f.at>=start&&f.at<=end).reduce((n,f)=>n+f.ms,0),inkMax:Math.max(...raw.ink.map(f=>f.ms)),
   longTasks:raw.longTasks.filter(f=>f.start>=original-100&&f.start<=end),events:raw.events,
   hot:profile.nodes.filter(n=>n.hitCount).sort((a,z)=>z.hitCount-a.hitCount).slice(0,18).map(n=>({name:n.callFrame.functionName,hits:n.hitCount,line:n.callFrame.lineNumber}))}
  report.runs.push({base,width,cpuRate,stats,raw});console.log(JSON.stringify({base,width,cpuRate,...stats}))
 }
}finally{await b.send('Emulation.setCPUThrottlingRate',{rate:1});await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

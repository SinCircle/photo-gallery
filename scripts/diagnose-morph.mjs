import { browserSession } from './browser-session.mjs'
const b=await browserSession('performance-sweep/morph-diagnostics',9336)
try {
  await b.send('Emulation.setCPUThrottlingRate',{rate:4})
  await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.costs={};
    const record=(key,start)=>{const t=performance.now()-start;const x=costs[key]??={ms:0,count:0,max:0};x.ms+=t;x.count++;x.max=Math.max(x.max,t)};
    for(const name of ['getBoundingClientRect','getAnimations']){const f=Element.prototype[name];Element.prototype[name]=function(...args){const t=performance.now();const r=f.apply(this,args);record(name+':'+this.className,t);return r}};
    for(const name of ['offsetWidth','offsetHeight']){const d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,name);Object.defineProperty(HTMLElement.prototype,name,{...d,get(){const t=performance.now();const r=d.get.call(this);record(name+':'+this.className,t);return r}})};
    for(const name of ['drawImage','getImageData']){const f=CanvasRenderingContext2D.prototype[name];CanvasRenderingContext2D.prototype[name]=function(...args){const t=performance.now();const r=f.apply(this,args);record(name+':'+this.canvas.outerHTML.slice(0,130),t);return r}};
  `})
  await b.navigate('http://127.0.0.1:5187/?diagnose#/photo/IMG_20260815_153938.jpg',390,844)
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:false})
  await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockInner').dataset.moving`)
  console.log(await b.evaluate(`Object.entries(costs).sort((a,b)=>b[1].ms-a[1].ms).slice(0,15)`))
} finally {await b.send('Emulation.setCPUThrottlingRate',{rate:1});b.close()}

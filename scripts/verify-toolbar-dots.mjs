import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {browserSession,sleep} from './browser-session.mjs'
const b=await browserSession('toolbar-dots-final',9304)
const {evaluate,send,navigate,until}=b
const report={base:'http://127.0.0.1:5187',frames:[],errors:b.errors}
await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('dockink',e=>e.target.__inkDiagnostic=e.detail)`})
try {
 await navigate(report.base+'/',400,240)
 await until(`document.querySelector('.tile')`)
 // Rasterise at 6 device pixels per CSS pixel. Upscaling a DPR-1 compositor
 // screenshot instead rounds 5px dot layers by half a CSS pixel.
 await send('Emulation.setDeviceMetricsOverride',{width:400,height:240,deviceScaleFactor:6,mobile:false})
 // The shell is loaded, then the photo route is navigated under real network
 // throttling. No attribute override is used to fabricate the loading state.
 await send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:16000,uploadThroughput:16000})
 await send('Page.navigate',{url:report.base+'/#/photo/'+encodeURIComponent('!IMG_20260103_160706.jpg')})
 await until(`document.querySelector('.dockBar')?.hasAttribute('data-loading')`)
 await send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:512,uploadThroughput:512})
 await until(`document.querySelector('.dockBar').getBoundingClientRect().width===56 && !document.querySelector('.dockInner').dataset.moving`)
 await evaluate(`window.anims=document.querySelector('.capsuleDots').getAnimations({subtree:true});anims.forEach(a=>a.pause())`)
 const rect=await evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
 const clip={x:rect.x-4,y:rect.y-4,width:64,height:40,scale:1}
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png',clip});await writeFile(b.out+'/'+name+'.png',Buffer.from(shot.data,'base64'));return shot.data}
 await evaluate(`document.querySelector('.capsuleDots').style.visibility='hidden';document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
 await sleep(120)
 const bg=await capture('backdrop')
 await evaluate(`document.querySelector('.capsuleDots').style.visibility='';document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
 await sleep(120)
 const images=[]
 for(let i=0;i<=120;i++) {
  const t=i===120?1799.999:i*15
  await evaluate(`anims.forEach(a=>a.currentTime=${t});document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
  await sleep(16)
  const frame=await evaluate(`(()=>{const bar=document.querySelector('.dockBar'),r=bar.getBoundingClientRect();return {t:${t},loading:bar.hasAttribute('data-loading'),width:r.width,height:r.height,ink:bar.__inkDiagnostic,computed:bar.style.getPropertyValue('--dock-dot-ink'),dots:[...bar.querySelectorAll('.capsuleDots i')].map(e=>{const r2=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:r2.x+r2.width/2-r.x,width:r2.width,opacity:+s.opacity,color:s.backgroundColor}})}})()`)
  images.push(await capture(`frame-${String(i).padStart(3,'0')}`))
  report.frames.push(frame)
 }
 const raster=await evaluate(`(async()=>{
  const decode=async src=>{const i=new Image();await new Promise(r=>{i.onload=r;i.src='data:image/png;base64,'+src});const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,c.width,c.height)};
  const bg=await decode(${JSON.stringify(bg)}),images=${JSON.stringify(images)},out=[];const W=bg.width,H=bg.height;
  for(const src of images){const frame=await decode(src),mask=new Uint8Array(W*H),components=[];
   // Restrict to the dots' vertical band; the fixed glass rim is irrelevant.
   for(let y=14*6;y<26*6;y++)for(let x=4*6;x<60*6;x++){const p=(y*W+x)*4;mask[y*W+x]=Math.max(...[0,1,2].map(k=>Math.abs(frame.data[p+k]-bg.data[p+k])))>8?1:0}
   for(let p=0;p<mask.length;p++)if(mask[p]){const queue=[p];mask[p]=0;let n=0,xsum=0,minX=W,maxX=0;while(queue.length){const q=queue.pop(),x=q%W;n++;xsum+=x+.5;minX=Math.min(minX,x);maxX=Math.max(maxX,x);for(const k of[q-1,q+1,q-W,q+W])if(k>=0&&k<mask.length&&mask[k]){mask[k]=0;queue.push(k)}}if(n>10)components.push({x:xsum/n/6-4,left:minX/6-4,right:(maxX+1)/6-4,pixels:n})}
   components.sort((a,b)=>a.x-b.x);out.push(components)
  }return out;
 })()`)
 report.raster=raster
 const gaps=[],speeds=[]
 for(const [i,f]of report.frames.entries()) {
  assert.ok(f.loading,'Network must hold the real loading state for every frame')
  assert.equal(f.width,56);assert.equal(f.height,32)
  const dots=f.dots.toSorted((a,b)=>a.x-b.x)
  assert.equal(raster[i].length,3,'Every rendered frame must contain three separate dot components')
  for(let k=0;k<3;k++) {
   assert.ok(dots[k].opacity>=.3&&dots[k].x-2.5>=0&&dots[k].x+2.5<=56)
   assert.ok(Math.abs(dots[k].x-raster[i][k].x)<.2,'Raster centroid must agree with measured motion')
  }
  for(let k=0;k<2;k++){const gap=dots[k+1].x-dots[k].x;gaps.push(gap);assert.ok(Math.abs(gap-14)<.002);assert.ok(raster[i][k+1].left-raster[i][k].right>=8.5)}
  if(i){const dt=(f.t-report.frames[i-1].t)/1000,dx=f.dots[0].x-report.frames[i-1].dots[0].x;speeds.push(dx/dt)}
 }
 const mirrors=[]
 for(let i=1;i<120;i++) {
  const a=report.frames[i].dots[0],z=report.frames[120-i].dots[0]
  mirrors.push({x:Math.abs(a.x+z.x-56),opacity:Math.abs(a.opacity-z.opacity)})
 }
 assert.ok(mirrors.every(m=>m.x<.002&&m.opacity<.00001),'Entry and exit must mirror each other')
 assert.ok(Math.min(...speeds)>10&&Math.max(...speeds)-Math.min(...speeds)>10,'Motion must ease without a dead stop or constant speed')
 report.summary={gapMin:Math.min(...gaps),gapMax:Math.max(...gaps),speedMin:Math.min(...speeds),speedMax:Math.max(...speeds),mirrorX:Math.max(...mirrors.map(m=>m.x)),mirrorOpacity:Math.max(...mirrors.map(m=>m.opacity)),rasterCount:[...new Set(raster.map(r=>r.length))],opacityMin:Math.min(...report.frames.flatMap(f=>f.dots.map(d=>d.opacity)))}
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await sleep(120);await capture('reduced-motion')
 report.reduced=await evaluate(`[...document.querySelectorAll('.capsuleDots i')].map(e=>({rect:e.getBoundingClientRect().toJSON(),opacity:+getComputedStyle(e).opacity,animations:e.getAnimations().length}))`)
 assert.ok(report.reduced.every(d=>d.opacity===.8&&d.animations===0))
 assert.deepEqual(b.errors,[])
 report.status='passed';console.log(JSON.stringify(report.summary))
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error)}
finally{await writeFile(b.out+'/report.json',JSON.stringify(report,null,2));b.close()}

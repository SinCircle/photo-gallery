import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { browserSession, sleep } from './browser-session.mjs'

const phase = process.argv[2] || 'baseline'
const b = await browserSession(`toolbar-${phase}`, 9301)
const { evaluate, send, navigate, until } = b
const base = 'http://127.0.0.1:5187'
const photos = process.env.PHOTOS?.split(',') || ['!IMG_20260103_160706.jpg', 'IMG_20260201_181608.jpg', 'IMG_20260815_153938.jpg', 'IMG_20260103_154828.jpg']
const report = { phase, photos: [], errors: b.errors }
await send('Page.addScriptToEvaluateOnNewDocument', {source:`document.addEventListener('dockink',e=>e.target.__inkDiagnostic=e.detail)`})
const sample = `(() => {
 const bar=document.querySelector('.dockBar'), scene=document.querySelector('[data-glass-scene]');
 const r=bar.getBoundingClientRect(), s=scene.getBoundingClientRect(), scale=scene.width/s.width;
 const x=Math.max(0,Math.round((r.left-s.left)*scale)), y=Math.max(0,Math.round((r.top+r.height*.2-s.top)*scale));
 const w=Math.min(scene.width-x,Math.round(r.width*scale)), h=Math.max(1,Math.min(scene.height-y,Math.round(r.height*.6*scale)));
 const c=document.createElement('canvas');c.width=24;c.height=1;const ctx=c.getContext('2d');ctx.drawImage(scene,x,y,w,h,0,0,24,1);
 const lin=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
 const lum=(d,p)=>.2126*lin(d[p]/255)+.7152*lin(d[p+1]/255)+.0722*lin(d[p+2]/255);
 const tiny=ctx.getImageData(0,0,24,1).data, full=scene.getContext('2d').getImageData(x,y,w,h).data;
 const old=Array.from({length:24},(_,i)=>lum(tiny,4*i));
 const area=Array.from({length:24},(_,i)=>{let sum=0,weight=0;for(let xx=Math.floor(i*w/24);xx<Math.ceil((i+1)*w/24);xx++){const wx=Math.min(xx+1,(i+1)*w/24)-Math.max(xx,i*w/24);for(let yy=0;yy<h;yy++){sum+=wx*lum(full,(yy*w+xx)*4);weight+=wx}}return sum/weight});
 const diagnostic=bar.__inkDiagnostic;
 let oracleError;
 if(diagnostic?.source==='photo') {
  const band=diagnostic.band, data=scene.getContext('2d').getImageData(0,0,scene.width,scene.height).data;
  const y0=(band.top-s.top)*scale,y1=(band.bottom-s.top)*scale;
  const oracle=Array.from({length:24},(_,i)=>{const x0=(band.left-s.left+(band.right-band.left)*i/24)*scale,x1=(band.left-s.left+(band.right-band.left)*(i+1)/24)*scale;let sum=0,area=0;for(let yy=Math.floor(y0);yy<Math.ceil(y1);yy++)for(let xx=Math.floor(x0);xx<Math.ceil(x1);xx++){const a=(Math.min(xx+1,x1)-Math.max(xx,x0))*(Math.min(yy+1,y1)-Math.max(yy,y0));sum+=a*lum(data,(yy*scene.width+xx)*4);area+=a}return sum/area});
  oracleError=Math.max(...oracle.map((v,i)=>Math.abs(v-diagnostic.sampled[i])));
 }
 return {region:{x,y,w,h},old,area,ink:bar.style.getPropertyValue('--dock-ink-gradient').split('rgb(').slice(1).map(t=>parseFloat(t)),diagnostic,oracleError,labels:[...bar.querySelectorAll('.dockMetaItem,.dockAction')].map(e=>({text:e.textContent,halo:e.dataset.halo,rect:e.getBoundingClientRect().toJSON()})),bar:r.toJSON(),fit:document.querySelector('.dockFit').textContent};
})()`
async function capture(name, scale=1) {
 const r=await evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
 const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:r.x-4,y:r.y-4,width:r.width+8,height:r.height+8,scale}})
 await writeFile(`${b.out}/${name}.png`,Buffer.from(shot.data,'base64'))
}
try {
 if(phase!=='dots') for(const photo of photos) {
  await navigate(`${base}/?probe=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockMetaLoading') && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
  await evaluate('document.fonts.ready')
  for(let i=0;i<4;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:500,deltaX:0,deltaY:-120});await sleep(220)}
  const r=await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+20})
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').dataset.moving`)
  await sleep(600)
  const series=[]
  for(let step=0;step<=24;step++) {
   await evaluate(`document.querySelector('.photoPan').style.translate='${step*.25}px 0';document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
   await sleep(540)
   series.push({offset:step*.25,...await evaluate(sample)})
   if(step===0||step===24)await capture(`${photo}-${step}`,2)
  }
  const deltas=series.slice(1).map((s,i)=>({ink:Math.max(...s.ink.map((v,k)=>Math.abs(v-series[i].ink[k]))),old:Math.max(...s.old.map((v,k)=>Math.abs(v-series[i].old[k]))),area:Math.max(...s.area.map((v,k)=>Math.abs(v-series[i].area[k])))}))
  const row={photo,series,deltas};report.photos.push(row)
  console.log(photo,JSON.stringify({maxInk:Math.max(...deltas.map(d=>d.ink)),maxOracleError:Math.max(...series.map(s=>s.oracleError||0))}))
  await writeFile(`${b.out}/report.json`,JSON.stringify(report,null,2))
  assert.ok(series.every(s=>s.bar.width>900),'Continuity must be measured on the expanded bar')
  if(phase!=='baseline') {
   assert.ok(series.every(s=>s.oracleError<1e-10),'Native sampler must equal independent full-area oracle')
   assert.ok(deltas.every(d=>d.ink<=8),'A 0.25px step must change every ink stop by at most 8/255')
  }
 }
 if(phase==='baseline'||phase==='dots') {
  await send('Network.emulateNetworkConditions',{offline:false,latency:800,downloadThroughput:16000,uploadThroughput:16000})
  await send('Page.navigate',{url:`${base}/?loading=${Date.now()}#/photo/${encodeURIComponent(photos[0])}`})
  await until(`document.querySelector('.dockBar')?.hasAttribute('data-loading')`,60000)
  await until(`!document.querySelector('.dockInner').dataset.moving && document.querySelector('.dockBar').getBoundingClientRect().width===56`,10000)
  await evaluate(`window.dotAnimations=[...document.querySelector('.capsuleDots').getAnimations({subtree:true})];dotAnimations.forEach(a=>a.pause())`)
  const frames=[]
  for(let i=0;i<=72;i++) {
   await evaluate(`dotAnimations.forEach(a=>a.currentTime=${i*25});document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
   await sleep(20)
   frames.push(await evaluate(`(()=>{const b=document.querySelector('.dockBar').getBoundingClientRect();return {t:${i*25},bar:b.toJSON(),dots:[...document.querySelectorAll('.capsuleDots i')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x+r.width/2-b.x,w:r.width,opacity:+s.opacity,color:s.backgroundColor}})}})()`))
   if(i%6===0)await capture(`dots-${i}`,6)
  }
  report.dots=frames
  console.log('dots minimum center gap',Math.min(...frames.flatMap(f=>{const x=f.dots.map(d=>d.x).sort((a,b)=>a-b);return [x[1]-x[0],x[2]-x[1]]})))
 }
} finally {
 await writeFile(`${b.out}/report.json`,JSON.stringify(report,null,2));b.close()
}

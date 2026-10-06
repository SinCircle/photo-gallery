import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('toolbar-ink-final', 9302)
const { evaluate, send, navigate, until } = b
const photos = process.env.PHOTOS?.split(',') || ['!IMG_20260103_160706.jpg', 'IMG_20260201_181608.jpg', 'IMG_20260815_153938.jpg', 'IMG_20260103_154828.jpg']
const report = { base: 'http://127.0.0.1:5187', photos: [], errors: b.errors }
await send('Page.addScriptToEvaluateOnNewDocument', {source:`document.addEventListener('dockink',e=>e.target.__inkDiagnostic=e.detail)`})
try {
 for(const photo of photos) {
  await navigate(`${report.base}/?ink=${Date.now()}#/photo/${encodeURIComponent(photo)}`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockMetaLoading') && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
  await evaluate('document.fonts.ready')
  for(let i=0;i<4;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:500,deltaX:0,deltaY:-120});await sleep(220)}
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:720,y:965})
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').dataset.moving`)
  await sleep(600)
  const series=[]
  for(let i=0;i<=24;i++) {
   await evaluate(`document.querySelector('.photoPan').style.translate='${i*.25}px 0';document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
   await sleep(60)
   series.push(await evaluate(`(()=>{const bar=document.querySelector('.dockBar'),root=document.querySelector('.dockInner');return {offset:${i*.25},state:root.dataset.toolbar,moving:root.dataset.moving||null,width:bar.getBoundingClientRect().width,...bar.__inkDiagnostic}})()`))
  }
  // Unlike the historical probe's incorrect >900px assumption, metadata may
  // naturally produce a 444px bar. Verify actual state and invariant geometry.
  assert.ok(series.every(s=>s.state==='expanded'&&!s.moving&&s.width===series[0].width&&s.width>56))
  const deltas=series.slice(1).flatMap((s,i)=>s.values.map((v,k)=>Math.abs(v-series[i].values[k])))
  assert.ok(Math.max(...deltas)<=8,'0.25px movement must not jump the ink')
  await evaluate(`document.querySelector('.photoPan').style.translate='0px 0';document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
  await sleep(200)
  const geometry=await evaluate(`(()=>{const bar=document.querySelector('.dockBar');return {bar:bar.getBoundingClientRect().toJSON(),diagnostic:bar.__inkDiagnostic,labels:[...bar.querySelectorAll('.dockAction,.dockMetaItem')].map(e=>({text:e.textContent,halo:e.hasAttribute('data-halo'),rect:e.querySelector('.dockFill').getBoundingClientRect().toJSON()}))}})()`)
  const clip={x:geometry.bar.x-2,y:geometry.bar.y-2,width:geometry.bar.width+4,height:geometry.bar.height+4,scale:6}
  const shots={},states={}
  for(const [mode,css] of Object.entries({on:'',off:'.dockOutline{display:none!important}',mask:'.dockOutline{display:none!important}.dockFill{background-image:linear-gradient(red,red)!important}',backdrop:'.dockFill,.dockOutline{visibility:hidden!important}'})) {
   await evaluate(`(()=>{let s=document.getElementById('ink-probe-style');if(!s){s=document.createElement('style');s.id='ink-probe-style';document.head.append(s)}s.textContent=${JSON.stringify(css)};document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))})()`)
   await sleep(120)
   shots[mode]=(await send('Page.captureScreenshot',{format:'png',clip})).data
   states[mode]=await evaluate(`({ink:document.querySelector('.dockBar').__inkDiagnostic,scene:[document.querySelector('[data-glass-scene]').width,document.querySelector('[data-glass-scene]').height],dpr:devicePixelRatio})`)
   await writeFile(`${b.out}/${photo}-${mode}-6x.png`,Buffer.from(shots[mode],'base64'))
  }
  const pixels=await evaluate(`(async()=>{
   const shots=${JSON.stringify(shots)}, images={};let W,H;
   for(const [key,src] of Object.entries(shots)){const image=new Image();await new Promise(r=>{image.onload=r;image.src='data:image/png;base64,'+src});const c=document.createElement('canvas');c.width=W=image.width;c.height=H=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);images[key]=ctx.getImageData(0,0,W,H).data}
   const lin=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
   const lum=(d,p)=>.2126*lin(d[p]/255)+.7152*lin(d[p+1]/255)+.0722*lin(d[p+2]/255);
   return ${JSON.stringify(geometry.labels)}.map(label=>{let count=0,maxCoreChange=0,minimum=Infinity,failing=0,outlinePixels=0,darkest=null,brightest=null;
    const r=label.rect,clip=${JSON.stringify(clip)};
    for(let y=Math.max(0,Math.ceil((r.top-clip.y)*6));y<Math.min(H,Math.floor((r.bottom-clip.y)*6));y++)for(let x=Math.max(0,Math.ceil((r.left-clip.x)*6));x<Math.min(W,Math.floor((r.right-clip.x)*6));x++){
     const p=(y*W+x)*4,on=images.on,off=images.off,mask=images.mask,bg=images.backdrop;
     if(on[p]!==off[p]||on[p+1]!==off[p+1]||on[p+2]!==off[p+2])outlinePixels++;
     if(mask[p]!==255||mask[p+1]!==0||mask[p+2]!==0)continue;
     count++;maxCoreChange=Math.max(maxCoreChange,...[0,1,2].map(k=>Math.abs(on[p+k]-off[p+k])));
     const a=lum(off,p),b=lum(bg,p),c=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);minimum=Math.min(minimum,c);if(c<5)failing++;
     const value={x,y,on:Array.from(on.slice(p,p+3)),off:Array.from(off.slice(p,p+3)),luma:a};
     if(!darkest||a<darkest.luma)darkest=value;if(!brightest||a>brightest.luma)brightest=value;
    }
    return {text:label.text,halo:label.halo,count,maxCoreChange,minimum,failing,outlinePixels,darkest,brightest};
   });
  })()`)
  const result={photo,series,maxStep:Math.max(...deltas),geometry,pixels,states};report.photos.push(result)
  await writeFile(`${b.out}/report.json`,JSON.stringify(report,null,2))
  console.log(photo,JSON.stringify(pixels.map(p=>({text:p.text,halo:p.halo,core:p.maxCoreChange,min:p.minimum,failing:p.failing,outline:p.outlinePixels}))))
  for(const label of pixels.filter(l=>l.count>0)) {
   assert.equal(label.maxCoreChange,0,`${label.text}: outline must preserve opaque glyph cores`)
   if(label.failing)assert.ok(label.halo&&label.outlinePixels>0,`${label.text}: rendered contrast below 5 must receive a visible outline`)
  }
 }
 assert.deepEqual(b.errors,[])
 report.status='passed'
} catch(error) {report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error)}
finally {await writeFile(`${b.out}/report.json`,JSON.stringify(report,null,2));b.close()}

import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const b = await browserSession('toolbar-repair-visual', 9316)
const report = { base, loading: [], photos: [], errors: b.errors }
const image = 'IMG_20260815_153938.jpg'
const move = (x, y) => b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
const captureBar = async name => {
  const r = await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
  const shot = await b.send('Page.captureScreenshot', { format: 'png', clip: { x:r.x-4, y:r.y-4, width:r.width+8, height:r.height+8, scale:3 } })
  await writeFile(b.out+'/'+name+'.png', Buffer.from(shot.data,'base64'))
  return shot.data
}
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('dockink',e=>e.target.__ink=e.detail)` })
try {
  await b.navigate(base+'/')
  await b.until(`document.querySelector('.tile')`)
  const held = []
  b.on('Fetch.requestPaused', event => held.push(event.requestId))
  await b.send('Fetch.enable', { patterns:[{urlPattern:'*/media/originals/*',requestStage:'Request'},{urlPattern:'*/media/web/*',requestStage:'Request'}] })
  await b.send('Page.navigate',{url:base+'/#/photo/'+image})
  await b.until(`document.querySelector('.dockBar')?.hasAttribute('data-loading') && document.querySelector('.dockInner')?.dataset.glass==='webgl'`)
  await b.until(`document.querySelector('.photoImgLow')?.naturalWidth>0`)
  await b.until(`!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
  await sleep(300)
  await b.evaluate(`window.loadingWork={ink:0,draws:__metrics.draws};document.querySelector('.dockBar').addEventListener('dockink',()=>loadingWork.ink++)`)
  await sleep(500)
  report.loadingWork=await b.evaluate(`({ink:loadingWork.ink,draws:__metrics.draws-loadingWork.draws})`)
  assert.deepEqual(report.loadingWork,{ink:0,draws:0},'Loading dots alone must not resample or render glass')
  await b.evaluate(`window.dots=[...document.querySelectorAll('.dockBar > .capsuleDots i')];window.dotAnimations=dots.flatMap(d=>d.getAnimations());dotAnimations.forEach(a=>a.pause())`)
  for (let t=0; t<=6400; t+=32) {
    // Hold the actual compositor animations at exact phases, including the loop seam.
    await b.evaluate(`dotAnimations.forEach(a=>a.currentTime=${t})`)
    const frame=await b.evaluate(`(()=>{const r=document.querySelector('.dockBar').getBoundingClientRect();return {t:${t},width:r.width,height:r.height,dots:dots.map(d=>{const box=d.getBoundingClientRect();return {x:box.x+box.width/2-r.x,y:box.y+box.height/2-r.y,opacity:+getComputedStyle(d).opacity,width:box.width}})}})()`)
    report.loading.push(frame)
    assert.equal(frame.width,56)
    assert.equal(frame.height,32)
    assert.equal(frame.dots.length,4)
    assert.ok(frame.dots.every(d=>Math.abs(d.y-16)<.01 && d.opacity===.9),'All balls stay on the vertical centerline')
    const visible=frame.dots.filter(d=>d.width>.05).toSorted((a,z)=>a.x-z.x)
    assert.ok(visible.length>=3 && visible.length<=4)
    for (const d of visible) assert.ok(d.x-d.width/2>=-.1 && d.x+d.width/2<=56.1,'Visible ball remains inside the capsule')
    for (let i=1;i<visible.length;i++) assert.ok(visible[i].x-visible[i-1].x>(visible[i].width+visible[i-1].width)/2,'Visible balls must not overlap')
    if (t<=1000 && t%200===0) await captureBar('loading-'+String(t).padStart(4,'0'))
  }
  const speeds=report.loading.slice(1).map((f,i)=>f.dots.map((d,j)=>(d.x-report.loading[i].dots[j].x)/.032))
  assert.ok(speeds.some(s=>Math.max(...s)-Math.min(...s)>12),'Phase offsets must produce visibly different speeds')
  assert.ok(speeds.some(s=>s.some(v=>v<0 && v>-20)),'The tail must gently recoil')
  assert.ok(report.loading[0].dots.every((d,i)=>Math.abs(d.x-report.loading.at(-1).dots[i].x)<.001),'All ball identities repeat after four pushes')
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await b.until(`[...document.querySelectorAll('.dockBar > .capsuleDots i')].every(d=>d.getAnimations().length===0)`)
  report.reduced=await b.evaluate(`[...document.querySelectorAll('.dockBar > .capsuleDots i')].map(d=>({animations:d.getAnimations().length,opacity:+getComputedStyle(d).opacity,x:d.getBoundingClientRect().x}))`)
  assert.ok(report.reduced.every(d=>d.animations===0 && d.opacity===.8))
  assert.ok(Math.abs(report.reduced[1].x-report.reduced[0].x-14)<.01)
  await captureBar('loading-reduced')
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  await b.until(`[...document.querySelectorAll('.dockBar > .capsuleDots i')].every(d=>d.getAnimations().length===2)`)
  for (const requestId of held) await b.send('Fetch.continueRequest',{requestId})
  await b.send('Fetch.disable')
  await b.until(`document.querySelector('.dockInner').dataset.moving==='opening'`)
  // Activity during the morph must not prematurely settle or cancel it.
  const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
  await move(r.x+r.width/2,r.y+r.height/2)
  report.opening=await b.evaluate(`({moving:document.querySelector('.dockInner').dataset.moving,animations:document.querySelector('.dockBar').getAnimations().filter(a=>a.playState==='running').length})`)
  assert.equal(report.opening.moving,'opening')
  assert.ok(report.opening.animations>0)
  await b.until(`!document.querySelector('.dockInner').dataset.moving && document.querySelector('.dockInner').dataset.toolbar==='expanded'`)
  assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('.dockBar > .capsuleDots')).opacity`),'0')
  assert.equal(await b.evaluate(`[...document.querySelectorAll('.dockBar > .capsuleDots i')].reduce((n,d)=>n+d.getAnimations().length,0)`),0,'Loading animation must stop after the image arrives')

  for (const name of [image,'IMG_20260201_181608.jpg','IMG_20260103_154828.jpg']) {
    if (name!==image) {
      await b.navigate(base+'/#/photo/'+name)
      await b.until(`document.querySelector('.photoImgLow')?.alt===${JSON.stringify(name)} && document.querySelector('.photoStage')?.classList.contains('hiDone')`)
    }
    for(let i=0;i<4;i++) await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:450,deltaX:0,deltaY:-120})
    await b.until(`document.querySelector('.dockFit > .capsuleLabel:not(.stateOutgoing)').textContent==='比例：自由'`)
    const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
    await move(r.x+r.width/2,r.y+r.height/2)
    await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').dataset.moving`)
    await sleep(250)
    const details=await b.evaluate(`(()=>{const bar=document.querySelector('.dockBar');return {name:${JSON.stringify(name)},ink:bar.__ink,outline:!!document.querySelector('.dockOutline, #dock-outline-ring'),texture:bar.style.getPropertyValue('--dock-ink-texture'),shadows:[...document.querySelectorAll('.dockShadow')].map(s=>({filter:getComputedStyle(s).filter,shadow:getComputedStyle(s,'::before').textShadow,mask:getComputedStyle(s).maskImage})),fit:document.querySelector('.dockFit').textContent}})()`)
    assert.equal(details.outline,false)
    assert.equal(details.texture,'')
    assert.ok(details.shadows.every(s=>s.filter==='none' && s.shadow.includes('2px') && s.mask.startsWith('linear-gradient')))
    assert.equal(details.fit,'比例：自由')
    const on=await captureBar(name+'-shadow')
    await b.evaluate(`window.hideShadows=document.createElement('style');hideShadows.textContent='.dockShadow{visibility:hidden!important}';document.head.append(hideShadows)`)
    const off=await captureBar(name+'-no-shadow')
    // Compare actual raster pixels, not just class names or computed styles.
    details.raster=await b.evaluate(`(async()=>{const read=async base64=>{const i=new Image();i.src='data:image/png;base64,'+base64;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,c.width,c.height).data};const a=await read(${JSON.stringify(on)}),z=await read(${JSON.stringify(off)});let changed=0,lighter=0,darker=0;for(let i=0;i<a.length;i+=4){const d=a[i]+a[i+1]+a[i+2]-z[i]-z[i+1]-z[i+2];if(Math.abs(d)>6){changed++;if(d>0)lighter++;else darker++}}return {changed,lighter,darker}})()`)
    if (details.ink.labels.some(l=>l.halo)) assert.ok(details.raster.changed>20,'Enabled shadows must actually paint')
    await b.evaluate(`hideShadows.remove()`)
    report.photos.push(details)
  }
  // Narrow screens keep the actions visible and metadata horizontally scrollable.
  for(const width of [390,320]) {
    await b.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false})
    const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
    await move(r.x+r.width/2,r.y+r.height/2)
    await sleep(2100)
    const layout=await b.evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,bar:document.querySelector('.dockBar').getBoundingClientRect().toJSON(),buttons:[...document.querySelectorAll('.dockAction')].map(e=>e.getBoundingClientRect().toJSON()),meta:document.querySelector('.dockMeta').getBoundingClientRect().toJSON()})`)
    assert.equal(layout.overflow,false)
    assert.ok(layout.buttons.every(r=>r.x>=layout.bar.x&&r.right<=layout.bar.right),'Actions must be inside the unclipped bar, not just inside the viewport')
    assert.ok(layout.meta.width>16,'Metadata retains a scrollable viewport')
    await b.shot('mobile-'+width)
  }
  // CSS fallback still responds when WebGL is unavailable.
  const noGL=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t==='webgl'?null:original.call(this,t,...a)}`})
  await b.navigate(base+'/?fallback=1#/photo/'+image)
  await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const fallbackRect=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
  await move(fallbackRect.x+fallbackRect.width/2,fallbackRect.y+fallbackRect.height/2)
  await sleep(2100)
  report.fallback=await b.evaluate(`({glass:document.querySelector('.dockInner').dataset.glass,ink:document.querySelector('.dockBar').__ink})`)
  assert.equal(report.fallback.glass,'css')
  assert.equal(report.fallback.ink.source,'fallback-photo')
  await b.evaluate(`window.fallbackUpdates=0;document.querySelector('.dockBar').addEventListener('dockink',()=>fallbackUpdates++)`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:720,y:450,deltaX:0,deltaY:-400})
  await b.until(`fallbackUpdates>0 && document.querySelector('.dockFit').textContent==='比例：自由'`)
  report.fallback.updates=await b.evaluate(`fallbackUpdates`)
  await b.shot('css-fallback')
  await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:noGL.identifier})
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'})
  await b.until(`document.querySelector('.tile') && !document.querySelector('.photoStage')`)
  report.gallery=await b.evaluate(`({tiles:document.querySelectorAll('.tile').length,orphanCanvases:document.querySelectorAll('canvas[data-glass-scene]').length})`)
  assert.ok(report.gallery.tiles>0)
  assert.equal(report.gallery.orphanCanvases,0)
  await b.navigate(base+'/#/admin')
  await b.until(`document.querySelector('input[type=password]')`)
  report.admin={loginVisible:true}
  assert.deepEqual(b.errors,[])
  report.status='passed'
  console.log(JSON.stringify({status:report.status,frames:report.loading.length,photos:report.photos.map(p=>({name:p.name,raster:p.raster})),opening:report.opening}))
} catch(error) { report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error) }
finally { await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close() }

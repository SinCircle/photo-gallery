import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b=await browserSession(process.env.PINCH_NAME||'pinch-zoom',9364)
const base=process.env.VERIFY_URL||'http://127.0.0.1:5187'
const report={samples:[],errors:b.errors}
const touch=(type,points)=>b.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:4,radiusY:4,force:1}))})
const frame=()=>b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
const state=()=>b.evaluate(`(()=>{const zoom=document.querySelector('.photoZoom'),pan=document.querySelector('.photoPan'),img=document.querySelector('.photoImgHigh');return {rect:zoom.getBoundingClientRect().toJSON(),animations:[...zoom.getAnimations(),...pan.getAnimations()].length,transition:getComputedStyle(zoom).transitionDuration,scale:new DOMMatrix(getComputedStyle(zoom).transform).a,src:img.currentSrc,opacity:getComputedStyle(img).opacity,viewport:visualViewport.scale}})()`)
const near=(a,z,label)=>assert.ok(Math.abs(a-z)<1,`${label}: ${a} != ${z}`)
try {
  await b.navigate(base+'/?pinch-check#/photo/IMG_20260319_235815.jpg',390,844)
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true})
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
  await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
  await sleep(250)
  const initial=report.initial=await state()
  await touch('touchStart',[[1,150,422],[2,240,422]])
  report.started=await state()
  for(let i=1;i<=8;i++) {
    const half=45+114*i/8
    await touch('touchMove',[[1,195-half,422],[2,195+half,422]])
    await frame()
    report.samples.push({half,...await state()})
  }
  const enlarged=report.samples.at(-1)
  await touch('touchMove',[[1,48,407],[2,366,407]])
  await frame()
  report.panned=await state()
  // Lift one finger, then continue dragging with the remaining finger.
  await touch('touchEnd',[[2,366,407]])
  await frame()
  report.oneFinger=await state()
  await touch('touchMove',[[1,58,417]])
  await frame()
  report.dragged=await state()
  await touch('touchEnd',[])
  await sleep(250)
  report.released=await state()
  await b.shot('after-pinch')

  assert.equal(report.started.transition,'0s','Direct pinch motion must not restart a CSS tween')
  for(const sample of report.samples) {
    assert.equal(sample.animations,0,'No transform transition during a held pinch')
    near(sample.rect.width,initial.rect.width*(sample.half*2/90),'Distance follows fingers')
    assert.equal(sample.src,initial.src)
    assert.equal(sample.opacity,'1')
    assert.equal(sample.viewport,1,'The photo zooms without zooming the browser viewport')
  }
  near(report.panned.rect.x,enlarged.rect.x+12,'Two-finger horizontal pan')
  near(report.panned.rect.y,enlarged.rect.y-15,'Two-finger vertical pan')
  near(report.oneFinger.rect.x,report.panned.rect.x,'Finger release must not jump')
  near(report.oneFinger.rect.y,report.panned.rect.y,'Finger release must not jump')
  near(report.dragged.rect.x,report.oneFinger.rect.x+10,'One-finger continuation')
  near(report.dragged.rect.y,report.oneFinger.rect.y+10,'One-finger continuation')
  near(report.released.rect.x,report.dragged.rect.x,'Final release must not jump')

  // Reverse direction while moving the centre, then cancel a held gesture.
  await touch('touchStart',[[1,100,422],[2,290,422]])
  const reverseStart=await state()
  report.reverse=[]
  for(let i=1;i<=5;i++) {
    const half=95-10*i
    await touch('touchMove',[[1,195-half,422],[2,195+half,422]])
    await frame()
    const sample=await state();report.reverse.push(sample)
    near(sample.rect.width,reverseStart.rect.width*(half*2/190),'Reverse pinch follows fingers')
    assert.equal(sample.animations,0)
  }
  await touch('touchCancel',[])
  await frame()
  assert.equal(await b.evaluate(`document.querySelector('.photoStage').classList.contains('isManipulating')`),false)

  // Pick up a fit animation halfway through, not at its unpainted endpoint.
  await b.evaluate(`document.querySelector('.dockFit').click();window.fitTweens=[...document.querySelector('.photoPan').getAnimations(),...document.querySelector('.photoZoom').getAnimations()];fitTweens.forEach(a=>{a.pause();a.currentTime=80})`)
  report.interruptBefore=await state()
  await touch('touchStart',[[1,140,420],[2,250,420]])
  await frame()
  report.interruptAfter=await state()
  for(const axis of ['x','y','width','height'])near(report.interruptAfter.rect[axis],report.interruptBefore.rect[axis],'Tween pickup '+axis)
  assert.equal(report.interruptAfter.animations,0)
  await touch('touchCancel',[])
  await b.evaluate(`window.dispatchEvent(new Event('blur'))`)
  await sleep(1100)
  const before=await b.evaluate(`({raf:__metrics.executed,draws:__metrics.draws})`)
  await sleep(500)
  report.idle=await b.evaluate(`({raf:__metrics.executed-${before.raf},draws:__metrics.draws-${before.draws}})`)
  assert.deepEqual(report.idle,{raf:0,draws:0})
  assert.deepEqual(b.errors,[])
  report.status='passed'
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error)}
finally{await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,transition:report.started?.transition,activeTransitions:report.samples.map(s=>s.animations),failure:report.failure}));b.close()}

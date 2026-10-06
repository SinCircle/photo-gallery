import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('loading-push', 9328)
const report = { layouts: [], errors: b.errors }
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const phase = time => b.evaluate(`(()=>{
  document.querySelectorAll('.dockBar > .capsuleDots i').forEach(d=>d.getAnimations().forEach(a=>a.currentTime=${time}));
  const bar=document.querySelector('.dockBar').getBoundingClientRect();
  return {t:${time},width:bar.width,height:bar.height,dots:[...document.querySelectorAll('.dockBar > .capsuleDots i')].map(d=>{const r=d.getBoundingClientRect();return {x:r.x+r.width/2-bar.x,y:r.y+r.height/2-bar.y,size:r.width}})}
})()`)
const visible = f => f.dots.filter(d=>d.size>.05).toSorted((a,b)=>a.x-b.x)
try {
  await b.send('Fetch.enable', { patterns: [{urlPattern:'*/media/originals/*',requestStage:'Request'},{urlPattern:'*/media/web/*',requestStage:'Request'}] })
  await b.navigate(base+'/#/photo/IMG_20260815_153938.jpg')
  await b.until(`document.querySelector('.dockBar')?.hasAttribute('data-loading') && document.querySelector('.photoImgLow')?.naturalWidth>0`)
  await b.until(`document.querySelector('.dockInner').dataset.glass==='webgl'&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
  await sleep(150)
  await b.evaluate(`window.loadingPaints={ink:0,draws:__metrics.draws};document.querySelector('.dockBar').addEventListener('dockink',()=>loadingPaints.ink++)`)
  await sleep(600)
  report.paints=await b.evaluate(`({ink:loadingPaints.ink,draws:__metrics.draws-loadingPaints.draws})`)
  assert.deepEqual(report.paints,{ink:0,draws:0})
  await b.evaluate(`document.querySelectorAll('.dockBar > .capsuleDots i').forEach(d=>d.getAnimations().forEach(a=>a.pause()))`)
  for (const [width,dpr] of [[1440,1],[390,2],[320,2]]) {
    await b.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:dpr,mobile:false})
    const frames=[]
    for(let t=0;t<=1600;t+=10){
      const frame=await phase(t); frames.push(frame)
      assert.equal(frame.width,56); assert.equal(frame.height,32)
      const balls=visible(frame)
      assert.ok(balls.length>=3 && balls.length<=4)
      assert.ok(balls.every(d=>Math.abs(d.y-16)<.01 && d.size<=5.01 && d.x-d.size/2>=-.1 && d.x+d.size/2<=56.1),JSON.stringify(frame))
      assert.ok(balls.slice(1).every((d,i)=>d.x-balls[i].x>(d.size+balls[i].size)/2),'Pushing balls must not intersect')
    }
    const starts=[0,1,2].map(i=>frames.find(f=>f.dots[i].x>14*(i+1)+.05).t)
    assert.ok(starts.every((t,i)=>i===0 || t-starts[i-1]>=25 && t-starts[i-1]<=45),'The actual propagation delay is halved to 35ms')
    for(const [i,target] of [[3,14],[0,28],[1,42]]){
      const overshoot=Math.max(...frames.map(f=>f.dots[i].x))-target
      assert.ok(overshoot>.7 && overshoot<1.3,'Each landing needs a small spring overshoot')
    }
    const rest=visible(frames[144]).map(d=>d.x)
    assert.deepEqual(rest,[14,28,42])
    assert.deepEqual(visible(frames[0]),visible(frames.at(-1)),'The visible arrangement must repeat every push')
    for(let t=0;t<=320;t+=16){
      const enter=(await phase(t)).dots[3],leave=(await phase(t+105)).dots[2]
      assert.ok(Math.abs(enter.size+leave.size-5)<.002,'Entry growth and exit shrink must be complementary')
      assert.ok(Math.abs(leave.x-enter.x-42)<.002,'Entry and exit must travel the same distance on opposite sides')
    }
    report.layouts.push({width,dpr,frames:frames.length,starts,rest})
    if(width===1440)report.frames=frames
  }
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  for(let t=0;t<1600;t+=40){
    await phase(t)
    const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
    const shot=await b.send('Page.captureScreenshot',{format:'png',clip:{x:r.x-6,y:r.y-6,width:r.width+12,height:r.height+12,scale:4}})
    await writeFile(b.out+'/frame-'+String(t/40).padStart(3,'0')+'.png',Buffer.from(shot.data,'base64'))
  }
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await b.until(`[...document.querySelectorAll('.dockBar > .capsuleDots i')].every(d=>d.getAnimations().length===0)`)
  report.reduced=visible(await phase(0))
  assert.deepEqual(report.reduced.map(d=>[d.x,d.y,d.size]),[[14,16,5],[28,16,5],[42,16,5]])
  assert.deepEqual(b.errors,[])
  report.status='passed'
  console.log(JSON.stringify({...report,frames:report.frames.length}))
} catch(error) { report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error) }
finally { await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close() }

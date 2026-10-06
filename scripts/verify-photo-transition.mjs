import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b=await browserSession('transition-details',9330)
const base=process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const report={cases:[],errors:b.errors}
await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.vts=[];window.holdTransition=true;
  document.addEventListener('phototransition',event=>{
    if(event.detail.phase==='ready'){
      const record={ready:true,finished:false};vts.push(record);
      record.animations=document.getAnimations().filter(a=>a.effect?.target?.className?.includes('photoTransition'));
      if(holdTransition)record.animations.forEach(a=>{a.pause();a.currentTime=0});
    }else if(vts.length)vts.at(-1).finished=true;
  });
`})
const click=async selector=>{
  const r=await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)
  await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1})
  await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1})
}
const group=()=>b.evaluate(`(()=>{const e=document.querySelector('[data-photo-transition-image]');const r=e.getBoundingClientRect();return {...r.toJSON(),pixels:e.width*e.height,bitmapWidth:e.width,bitmapHeight:e.height,easing:e.getAnimations()[0].effect.getTiming().easing}})()`)
const rect=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)
const near=(a,z)=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-z[k])<1,`${k}: ${a[k]} != ${z[k]}`)}
const seek=async time=>{await b.evaluate(`vts.at(-1).animations.forEach(a=>a.currentTime=${time})`);return group()}
const finish=async()=>{
  await b.evaluate(`vts.at(-1).animations.forEach(a=>a.finish())`)
  await b.until(`vts.at(-1).finished && !document.documentElement.dataset.photoTransition`)
}
const clean=()=>b.evaluate(`({names:[...document.querySelectorAll('[style]')].filter(e=>e.style.viewTransitionName==='photo-focus').length,fallback:document.querySelectorAll('.photoTransitionImage,.photoTransitionBackdrop,.photoTransitionToolbar,.photoTransitionSurface').length,errors:document.querySelector('.empty')?.textContent})`)
try{
  for(const width of [1440,390,320]){
    await b.navigate(base+'/?transition='+width+'#/',width,1000)
    await b.until(`document.querySelectorAll('.tile').length>3`)
    await b.evaluate(`scrollTo(0,1200);window.chosen=[...document.querySelectorAll('.tile')].find(t=>{const r=t.getBoundingClientRect();return r.y>20&&r.y<600});chosen.dataset.testSelected='';chosen.querySelector('img').loading='eager'`)
    await b.until(`chosen.querySelector('img').naturalWidth>0 && getComputedStyle(chosen.querySelector('img')).opacity==='1'`)
    const source=await rect('[data-test-selected] img'),scroll=await b.evaluate('scrollY')
    await click('[data-test-selected]')
    await b.until(`vts.at(-1)?.ready`)
    const dest=await rect('.photoZoom')
    const open=[]
    for(const time of [0,170,340,510,680]){
      const state=await seek(time);open.push({time,...state})
      if(width===1440)await b.shot('open-'+String(time).padStart(3,'0'))
    }
    near(open[0],source);near(open.at(-1),dest)
    const axis=['x','y','width','height'].toSorted((a,z)=>Math.abs(dest[z]-source[z])-Math.abs(dest[a]-source[a]))[0]
    const progress=(open[1][axis]-source[axis])/(dest[axis]-source[axis])
    const halfway=(open[2][axis]-source[axis])/(dest[axis]-source[axis])
    const late=(open[3][axis]-source[axis])/(dest[axis]-source[axis])
    assert.ok(progress>.03 && progress<.2 && halfway>.5 && late>.9,
      'Opening must accelerate, then decelerate, rather than move at constant speed')
    await finish()
    await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockInner').dataset.moving`)
    const bar=await rect('.dockBar')
    await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:bar.x+bar.width/2,y:bar.y+bar.height/2})
    await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').dataset.moving`)
    await click('.dockBack')
    await b.until(`vts.length===2 && vts.at(-1).ready`)
    const returnTarget=await rect('[data-test-selected] img')
    const close=[]
    for(const time of [0,170,340,510,680]){
      const state=await seek(time);close.push({time,...state})
      if(width===1440)await b.shot('close-'+String(time).padStart(3,'0'))
    }
    near(close[0],dest);near(close.at(-1),returnTarget);near(returnTarget,source)
    assert.equal(await b.evaluate('scrollY'),scroll)
    await finish()
    assert.equal((await clean()).names,0)
    report.cases.push({width,scroll,source,dest,open,close})
  }
  // Browser history runs the same shared-image path in both directions.
  await b.evaluate(`holdTransition=false;history.back()`)
  await b.until(`document.querySelector('.photoZoom') && !document.documentElement.dataset.photoTransition`)
  await b.evaluate('history.forward()')
  await b.until(`document.querySelector('.tile') && !document.documentElement.dataset.photoTransition`)
  report.history=true
  // A zoomed/panned photo returns from its actual displayed rectangle. A slow
  // gallery revalidation must not delay the cached destination or its motion.
  await click('[data-test-selected]')
  await b.until(`document.querySelector('.photoZoom') && !document.documentElement.dataset.photoTransition`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:160,y:500,deltaX:0,deltaY:-450})
  await sleep(240)
  const zoomed=await rect('.photoZoom')
  const held=[]
  b.on('Fetch.requestPaused',event=>held.push(event.requestId))
  await b.send('Fetch.enable',{patterns:[{urlPattern:'*/api/photos',requestStage:'Request'}]})
  const count=await b.evaluate('vts.length'),began=Date.now()
  await b.evaluate('holdTransition=true')
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'})
  await b.until(`vts.length>${count} && vts.at(-1).ready`)
  const revalidationDelay=Date.now()-began
  assert.ok(revalidationDelay<1500 && held.length>0,'Cached return must start even while API revalidation is held')
  near(await seek(0),zoomed)
  near(await seek(680),await rect('[data-test-selected] img'))
  await finish()
  for(const requestId of held)await b.send('Fetch.continueRequest',{requestId})
  await b.send('Fetch.disable')
  report.zoomedReturn={zoomed,revalidationDelay}
  // Magnification reuses the decoded image through a clipped compositor plane.
  await b.evaluate('holdTransition=false')
  await click('[data-test-selected]')
  await b.until(`document.querySelector('.photoZoom') && !document.documentElement.dataset.photoTransition`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:160,y:500,deltaX:0,deltaY:-3000})
  await sleep(250)
  await b.until(`document.querySelector('.photoImgHigh').currentSrc.includes('/media/originals/')`);const magnified=await rect('.photoZoom')
  await b.evaluate('holdTransition=true')
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'})
  await b.until(`vts.at(-1).ready && !vts.at(-1).finished`)
  const largeStart=await seek(0)
  near(largeStart,magnified)
  const proxies=await b.evaluate(`[...document.querySelectorAll('.photoTransitionImage')].map(e=>({width:e.width,height:e.height,naturalWidth:e.naturalWidth,tag:e.tagName}))`)
  assert.ok(proxies.length===1 && proxies.every(t=>t.tag==='IMG'&&t.width<=1600&&t.height<=1600))
  near(await seek(680),await rect('[data-test-selected] img'))
  await finish()
  report.largeZoom={magnified,proxies}

  // Resizing midway settles the destination instead of leaving a snapshot.
  await click('[data-test-selected]')
  await b.until(`vts.at(-1).ready && !vts.at(-1).finished`)
  await seek(170)
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:false})
  await b.until(`!document.documentElement.dataset.photoTransition`)
  assert.equal((await clean()).names,0)
  await b.evaluate('holdTransition=false')
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'})
  await b.until(`document.querySelector('.tile') && !document.documentElement.dataset.photoTransition`)
  report.resize=true
  // Repeated input, resizing, and a changed motion preference must release snapshots.
  await b.evaluate(`chosen.click();setTimeout(()=>location.hash='#/',90)`)
  await b.until(`location.hash==='#/' && document.querySelector('.tile') && !document.documentElement.dataset.photoTransition`)
  await sleep(400)
  assert.equal((await clean()).names,0)
  report.interrupted=true
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  const previous=await b.evaluate('vts.length')
  await click('[data-test-selected]')
  await b.until(`document.querySelector('.photoZoom')`)
  assert.equal(await b.evaluate('vts.length'),previous)
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'})
  await b.until(`document.querySelector('.tile')`)
  report.reduced=true
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  await b.evaluate(`document.startViewTransition=undefined`)
  await click('[data-test-selected]')
  await b.until(`document.querySelector('.photoTransitionImage')`)
  await b.until(`document.querySelector('.photoZoom') && !document.documentElement.dataset.photoTransition`)
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'})
  await b.until(`document.querySelector('.tile') && !document.documentElement.dataset.photoTransition`)
  report.fallback=await clean()
  assert.equal(report.fallback.names,0);assert.equal(report.fallback.fallback,0)
  assert.deepEqual(b.errors,[])
  report.status='passed';console.log(JSON.stringify({status:report.status,widths:report.cases.map(c=>c.width),history:report.history,zoomedReturn:report.zoomedReturn,resize:report.resize,interrupted:report.interrupted,reduced:report.reduced,fallback:report.fallback}))
}catch(error){report.status='failed';report.failure=error.stack;report.state=await b.evaluate(`({hash:location.hash,transitions:vts.map(v=>({ready:v.ready,finished:v.finished,error:v.error})),html:document.documentElement.dataset,body:document.body.className})`);process.exitCode=1;console.error(error);console.error(report.state)}
finally{await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const browser = await browserSession()
const { evaluate, until, navigate, shot, send } = browser
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5176'
const report = { base, checks: {}, errors: browser.errors }
try {
  await navigate(`${base}/#/photo/!IMG_20260103_160706.jpg`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  const firstBar = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: firstBar.x + firstBar.width / 2, y: firstBar.y + firstBar.height / 2 })
  await until(`document.querySelector('.dockInner').dataset.glass==='webgl'`)
  const visibleBar = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: visibleBar.x + visibleBar.width / 2, y: visibleBar.y + visibleBar.height / 2 })
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').getAnimations().length`)
  await evaluate(`(()=>{
    const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect();
    window.fixturePrevious=bar.style.getPropertyValue('--glass-refraction');
    const canvas=document.createElement('canvas');canvas.id='refraction-pattern';canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);
    canvas.style.cssText='position:fixed;pointer-events:none;z-index:19;left:'+r.x+'px;top:'+r.y+'px;width:'+r.width+'px;height:'+r.height+'px';
    const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);
    c.fillStyle='red';c.fillRect(0,8,canvas.width,6);c.fillStyle='black';
    for(let x=12;x<canvas.width;x+=37)c.fillRect(x,0,5,canvas.height);
    document.querySelector('.photoShell').append(canvas);
    bar.dispatchEvent(new Event('glassrefresh'));
  })()`)
  await until(`document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction')!==fixturePrevious && document.querySelector('.dockInner').dataset.glass==='webgl'`)
  report.checks.refraction = await evaluate(`(async()=>{
    const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect(),css=getComputedStyle(bar);
    const url=css.backgroundImage.slice(5,-2),bitmap=await createImageBitmap(await(await fetch(url)).blob());
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const size=css.backgroundSize.split(' ').map(parseFloat),position=css.backgroundPosition.split(' ').map(parseFloat);
    const rect={x:r.x+position[0],y:r.y+position[1],width:size[0],height:size[1]},ratio=canvas.width/rect.width;
    const pattern=document.querySelector('#refraction-pattern'),p=pattern.getContext('2d');
    const extent=values=>{const runs=[];let start=-1;for(let y=0;y<=values.length;y++){if(values[y]&&start<0)start=y;if(!values[y]&&start>=0){runs.push([start,y-1]);start=-1}}return runs.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0]};
    const lines=[];
    for(const x of [Math.round(r.width/2),70,Math.round(r.width-70)]){
      const refracted=[],plain=[];
      for(let y=0;y<r.height;y++){
        const a=ctx.getImageData(Math.round((r.x+x-rect.x)*ratio),Math.round((r.y+y-rect.y)*ratio),1,1).data;
        refracted.push(a[3]>150&&a[0]>120&&a[0]-a[1]>60&&a[0]-a[2]>60);const b=p.getImageData(x,y,1,1).data;plain.push(b[0]>120&&b[0]-b[1]>60&&b[0]-b[2]>60);
      }
      const expected=extent(plain),actual=extent(refracted);
      lines.push({x,expected,actual,maxDisplacement:actual&&expected?Math.max(Math.abs(actual[0]-expected[0]),Math.abs(actual[1]-expected[1])):0,
        originalThickness:expected?expected[1]-expected[0]+1:0,refractedThickness:actual?actual[1]-actual[0]+1:0});
    }
    return {lines,maxDisplacement:Math.max(...lines.map(l=>l.maxDisplacement)),draws:__metrics.draws,
      background:getComputedStyle(bar).backgroundColor,backdrop:getComputedStyle(bar).backdropFilter,config:JSON.parse(bar.dataset.config)};
  })()`)
  assert.ok(report.checks.refraction.maxDisplacement >= 2, JSON.stringify(report.checks.refraction))
  assert.ok(report.checks.refraction.lines.some(line=>line.actual && Math.abs(line.refractedThickness-line.originalThickness)>2), 'A unique colored marker must geometrically deform, not just change brightness')
  report.checks.refraction.isolatedRenderer = browser.createdTargets.some(t => t.type === 'iframe')
  report.checks.refraction.separateDocument = await evaluate(`document.querySelector('iframe[data-glass-renderer]')?.contentDocument!==document && document.querySelector('iframe[data-glass-renderer]')?.contentDocument?.URL==='about:srcdoc'`)
  assert.ok(report.checks.refraction.separateDocument)
  report.checks.refraction.rendererFramesRemaining = await evaluate(`document.querySelectorAll('iframe[data-glass-renderer]').length`)
  report.checks.refraction.rendererHidden = await evaluate(`[...document.querySelectorAll('iframe[data-glass-renderer]')].every(f=>getComputedStyle(f).opacity==='0' && f.getBoundingClientRect().width===1 && f.getBoundingClientRect().height===1)`)
  assert.equal(report.checks.refraction.rendererFramesRemaining, 1)
  assert.equal(report.checks.refraction.rendererHidden, true)
  assert.equal(report.checks.refraction.backdrop, 'none')
  assert.equal(report.checks.refraction.background, 'rgba(0, 0, 0, 0)')
  await shot('refracted')
  await evaluate(`window.originalRefraction=document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction');document.querySelector('.dockInner').style.setProperty('--glass-refraction','none')`)
  await shot('unrefracted')
  await evaluate(`document.querySelector('.dockInner').style.setProperty('--glass-refraction',originalRefraction)`)
  const start = await evaluate(`({requested:__metrics.requested,executed:__metrics.executed})`)
  report.checks.iframeIdle = await browser.traceIdle(5000)
  assert.equal(report.checks.iframeIdle.requested, 0)
  assert.equal(report.checks.iframeIdle.executed, 0)
  assert.equal(report.checks.iframeIdle.requestedAll, 0)
  assert.equal(report.checks.iframeIdle.executedAll, 0)
  report.checks.idle = await evaluate(`({requested:__metrics.requested-${start.requested},executed:__metrics.executed-${start.executed},active:__metrics.active.size})`)
  assert.deepEqual(report.checks.idle, { requested: 0, executed: 0, active: 0 })
  // A cached renderer must also produce fresh pixels after several idle seconds.
  const sleepingBar = await evaluate(`document.querySelector('.dockInner').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sleepingBar.x + sleepingBar.width / 2, y: sleepingBar.y + sleepingBar.height / 2 })
  await until(`document.querySelector('.dockInner').dataset.toolbar==='expanded' && !document.querySelector('.dockInner').getAnimations().length`)
  await evaluate(`window.idlePrevious=document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction');document.querySelector('#refraction-pattern').style.left=(parseFloat(document.querySelector('#refraction-pattern').style.left)+1)+'px';document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
  await until(`document.querySelector('.dockInner').dataset.glass==='webgl' && document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction')!==idlePrevious`)
  report.checks.refreshAfterIdle = true
  // Also photograph the actual photo behind the control, without the fixture.
  await evaluate(`document.querySelector('#refraction-pattern').remove();window.beforePhotoGlass=document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction')`)
  const fit = await evaluate(`document.querySelector('.dockLeft button:nth-child(2)').getBoundingClientRect().toJSON()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fit.x + fit.width / 2, y: fit.y + fit.height / 2, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fit.x + fit.width / 2, y: fit.y + fit.height / 2, button: 'left', clickCount: 1 })
  await until(`document.querySelector('.dockInner').dataset.glass==='webgl' && document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction')!==beforePhotoGlass`)
  report.checks.actualPhotoBehindGlass = await evaluate(`(()=>{const a=document.querySelector('.photoImgHigh').getBoundingClientRect(),b=document.querySelector('.dockInner').getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom&&a.right>b.left&&a.left<b.right})()`)
  assert.equal(report.checks.actualPhotoBehindGlass, true)
  await shot('photo-behind-glass')
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await until(`document.querySelector('.dockInner').dataset.glass==='css' && !document.querySelector('.dockInner').style.getPropertyValue('--glass-refraction')`)
  report.checks.reducedMotion = true
  await send('Emulation.setEmulatedMedia', { features: [] })
  const noGL = await send('Page.addScriptToEvaluateOnNewDocument', { source: `const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t==='webgl'?null:original.call(this,t,...a)}` })
  await navigate(`${base}/?no-gl-test=1#/photo/!IMG_20260103_160706.jpg`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone')`)
  await sleep(900)
  report.checks.noWebGL = await evaluate(`({path:document.querySelector('.dockInner').dataset.glass,backdrop:getComputedStyle(document.querySelector('.dockInner')).backdropFilter,buttons:document.querySelectorAll('.dockInner button').length})`)
  assert.deepEqual(report.checks.noWebGL, { path: 'css', backdrop: 'blur(18px)', buttons: 3 })
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noGL.identifier })
  assert.deepEqual(browser.errors, [])
  report.status = 'passed'
  console.log(`PASS refraction: edge displacement=${report.checks.refraction.maxDisplacement}px; separateDocument=${report.checks.refraction.separateDocument}; background transparent; backdrop none`)
  console.log('PASS public lifecycle: idle 5s rAF requested=0 executed=0 active=0; CSS fallback and reduced motion')
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out + '/results.json', JSON.stringify(report, null, 2)); browser.close() }

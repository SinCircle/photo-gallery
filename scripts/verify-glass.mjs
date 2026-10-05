import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const browser = await browserSession()
const { evaluate, until, navigate, shot, send } = browser
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5176'
const report = { base, checks: {}, errors: browser.errors }
try {
  await navigate(`${base}/#/photo/!IMG_20260103_160706.jpg`)
  await until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && document.querySelector('.glassSurface canvas')?.width>0`)
  await evaluate(`(()=>{
    const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect();
    const canvas=document.createElement('canvas');canvas.id='refraction-pattern';canvas.width=Math.ceil(r.width);canvas.height=Math.ceil(r.height);
    canvas.style.cssText='position:fixed;pointer-events:none;z-index:19;left:'+r.x+'px;top:'+r.y+'px;width:'+r.width+'px;height:'+r.height+'px';
    const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='black';
    for(let y=8;y<canvas.height;y+=19)c.fillRect(0,y,canvas.width,6);
    for(let x=12;x<canvas.width;x+=37)c.fillRect(x,0,5,canvas.height);
    document.querySelector('.photoShell').append(canvas);
    bar.dispatchEvent(new Event('glassrefresh'));
  })()`)
  await sleep(1600)
  report.checks.refraction = await evaluate(`(()=>{
    const bar=document.querySelector('.dockInner'),r=bar.getBoundingClientRect(),canvas=bar.querySelector('.glassSurface canvas');
    const rect=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d'),ratio=canvas.width/rect.width;
    const pattern=document.querySelector('#refraction-pattern'),p=pattern.getContext('2d');
    const edges=(values)=>values.slice(1).flatMap((v,i)=>(v>128)!==(values[i]>128)?[i+1]:[]);
    const lines=[];
    for(const x of [Math.round(r.width/2),70,Math.round(r.width-70)]){
      const refracted=[],plain=[];
      for(let y=3;y<r.height-3;y++){
        const a=ctx.getImageData(Math.round((r.x+x-rect.x)*ratio),Math.round((r.y+y-rect.y)*ratio),1,1).data;
        refracted.push((a[0]+a[1]+a[2])/3);const b=p.getImageData(x,y,1,1).data;plain.push((b[0]+b[1]+b[2])/3);
      }
      const expected=edges(plain),actual=edges(refracted);
      const displacement=actual.map(a=>Math.min(...expected.map(e=>Math.abs(a-e))));
      lines.push({x,expected,actual,maxDisplacement:Math.max(...displacement)});
    }
    return {lines,maxDisplacement:Math.max(...lines.map(l=>l.maxDisplacement)),draws:__metrics.draws,
      background:getComputedStyle(bar).backgroundColor,backdrop:getComputedStyle(bar).backdropFilter,config:JSON.parse(bar.dataset.config)};
  })()`)
  assert.ok(report.checks.refraction.maxDisplacement >= 2, JSON.stringify(report.checks.refraction))
  assert.ok(report.checks.refraction.draws > 0)
  assert.equal(report.checks.refraction.backdrop, 'none')
  assert.equal(report.checks.refraction.background, 'rgba(0, 0, 0, 0)')
  await shot('refracted')
  await evaluate(`document.querySelector('.glassSurface').style.visibility='hidden'`)
  await shot('unrefracted')
  await evaluate(`document.querySelector('.glassSurface').style.visibility=''`)
  const start = await evaluate(`({requested:__metrics.requested,executed:__metrics.executed})`)
  await sleep(5000)
  report.checks.idle = await evaluate(`({requested:__metrics.requested-${start.requested},executed:__metrics.executed-${start.executed},active:__metrics.active.size})`)
  assert.deepEqual(report.checks.idle, { requested: 0, executed: 0, active: 0 })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await until(`document.querySelector('.dockInner').dataset.glass==='css' && !document.querySelector('.glassSurface')`)
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
  console.log(`PASS refraction: edge displacement=${report.checks.refraction.maxDisplacement}px; shader draws=${report.checks.refraction.draws}; background transparent; backdrop none`)
  console.log('PASS public lifecycle: idle 5s rAF requested=0 executed=0 active=0; CSS fallback and reduced motion')
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.stack) }
finally { await writeFile(browser.out + '/results.json', JSON.stringify(report, null, 2)); browser.close() }

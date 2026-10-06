import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('fluid-states', 9345)
const report = { sizes: [], errors: b.errors }
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const wake = async () => {
  const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2})
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
}
const pauseSwaps = () => b.evaluate(`window.swaps=[...document.querySelectorAll('.dockDownload > .capsuleLabel:not(.stateOutgoing),.downloadLoading')].flatMap(e=>e.getAnimations());swaps.forEach(a=>{a.pause();a.currentTime=0})`)
const phase = time => b.evaluate(`(()=>{swaps.forEach(a=>a.currentTime=${time});const button=document.querySelector('.dockDownload'),label=button.querySelector('.capsuleLabel'),dots=button.querySelector('.downloadLoading');return {time:${time},label:+getComputedStyle(label).opacity,icon:+getComputedStyle(dots).opacity,labelBlur:getComputedStyle(label).filter,iconBlur:getComputedStyle(dots).filter,balls:[...dots.children].flatMap(e=>e.getAnimations()).length}})()`)
const alpha = mask => [...mask.matchAll(/rgba?\(0, 0, 0(?:, ([\d.]+))?\)/g)].map(m=>m[1]===undefined?1:+m[1])
try {
  await b.send('Browser.setDownloadBehavior',{behavior:'deny'})
  await b.send('DOM.enable'); await b.send('CSS.enable')
  for(const width of [1440,390]) {
    await b.navigate(base+'/?fluid-states='+width+'#/photo/IMG_3512.jpg',width,844)
    await b.until(`document.querySelector('.dockBar')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
    await wake(); await sleep(500)
    const document=await b.send('DOM.getDocument')
    const node=await b.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'.dockBack .dockFill'})
    const fonts=await b.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})
    const weight=await b.evaluate(`getComputedStyle(document.querySelector('.dockBack')).fontWeight`)
    assert.equal(weight,'600')
    assert.ok(fonts.fonts.some(f=>/Noto Serif SC/i.test(f.familyName)&&f.glyphCount>=2))
    await b.shot('font-photo-'+width)
    const layout=await b.evaluate(`(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON(),meta=document.querySelector('.dockMeta');return {bar:rect('.dockBar'),meta:rect('.dockMeta'),metaBottom:meta.offsetTop+meta.offsetHeight,buttons:[...document.querySelectorAll('.dockAction')].map(e=>({...e.getBoundingClientRect().toJSON(),rowTop:e.offsetTop})),overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    assert.equal(layout.overflow,false)
    const glassBlur=await b.evaluate(`({native:JSON.parse(document.querySelector('.dockBar').dataset.config).blurAmount,css:getComputedStyle(document.querySelector('.dockBar')).getPropertyValue('--capsule-blur').trim()})`)
    assert.equal(glassBlur.native,width<=560?.4:.15)
    assert.equal(glassBlur.css,width<=560?'0.4px':'0.15px')
    assert.ok(layout.buttons.every(r=>r.left>=layout.bar.left&&r.right<=layout.bar.right))
    if(width<=560){assert.equal(layout.bar.height,78);assert.ok(layout.buttons.every(r=>r.rowTop>=layout.metaBottom));assert.ok(layout.meta.width>width-80)}

    await b.evaluate(`window.pendingEncodes=[];window.realToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,type,...args){if(type==='image/jpeg')pendingEncodes.push(()=>realToBlob.call(this,callback,type,...args));else realToBlob.call(this,callback,type,...args)};document.querySelector('.dockDownload').click()`)
    await pauseSwaps()
    const enter=[]
    for(const t of [0,84,210,420,630,840]) enter.push(await phase(t))
    assert.equal(enter[0].label,1);assert.equal(enter[0].icon,0)
    assert.equal(enter.at(-1).label,0);assert.equal(enter.at(-1).icon,1)
    assert.ok(enter.slice(1,-1).every(s=>s.label>0&&s.label<1&&s.icon>0&&s.icon<1&&Math.abs(s.label+s.icon-1)<.001&&s.balls===8))
    assert.ok(enter[2].labelBlur!=='blur(0px)'&&enter[2].iconBlur!=='blur(0px)')
    // Reverse halfway through; the next fade must begin at this exact frame.
    const interrupted=await phase(210)
    await b.until('pendingEncodes.length===1')
    await b.evaluate('pendingEncodes.shift()();HTMLCanvasElement.prototype.toBlob=realToBlob')
    await b.until(`!document.querySelector('.dockBar').hasAttribute('data-busy')`)
    await pauseSwaps()
    const reverse=await phase(0)
    assert.ok(Math.abs(reverse.label-interrupted.label)<.002&&Math.abs(reverse.icon-interrupted.icon)<.002)
    const leave=[]
    for(const t of [0,210,420,630,840]) leave.push(await phase(t))
    assert.equal(leave.at(-1).label,1);assert.equal(leave.at(-1).icon,0)
    assert.ok(leave.every(s=>s.balls===8),'Keep the reused loader moving throughout its outgoing blur')
    await b.evaluate('swaps.forEach(a=>a.finish())')
    await b.until(`[...document.querySelectorAll('.downloadLoading i')].every(e=>e.getAnimations().length===0)`)

    await b.evaluate(`document.querySelector('.dockFit').click();window.textSwaps=document.querySelector('.dockFit').getAnimations({subtree:true}).filter(a=>a.effect.getKeyframes().some(f=>'filter' in f))`)
    const textSwap=await b.evaluate(`({copies:document.querySelectorAll('.dockFit .stateOutgoing').length,animations:textSwaps.map(a=>a.effect.getKeyframes()),incoming:getComputedStyle(document.querySelector('.dockFit > .capsuleLabel:not(.stateOutgoing)')).filter})`)
    assert.equal(textSwap.copies,0);assert.equal(textSwap.animations.length,0);assert.ok(['none','blur(0px)'].includes(textSwap.incoming))
    await b.evaluate('textSwaps.forEach(a=>a.finish())');await sleep(500)
    assert.equal(await b.evaluate(`document.querySelectorAll('.stateOutgoing').length`),0)

    // A 4px bright patch requires a local shadow without changing the label's
    // white ink. Verify actual resolved mask alphas, including interruption.
    await b.evaluate(`window.scene=document.querySelector('[data-glass-scene]');window.ctx=scene.getContext('2d');window.original=ctx.getImageData(0,0,scene.width,scene.height);window.paint=patch=>{ctx.fillStyle='#263643';ctx.fillRect(0,0,scene.width,scene.height);if(patch){const r=document.querySelector('.dockBack .dockFill').getBoundingClientRect(),s=scene.getBoundingClientRect();ctx.fillStyle='#fff';ctx.fillRect((r.x+r.width/2-s.x)*scene.width/s.width,0,4*scene.width/s.width,scene.height)}document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'))};paint(false)`)
    let rowInk
    if(width<=560){
      await b.evaluate(`(()=>{const upper=document.querySelector('.dockMeta').getBoundingClientRect(),lower=document.querySelector('.dockBack').getBoundingClientRect(),s=scene.getBoundingClientRect();ctx.fillStyle='#eee';ctx.fillRect(0,0,scene.width,((upper.bottom+lower.top)/2-s.top)*scene.height/s.height);document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'))})()`)
      await sleep(500)
      rowInk=await b.evaluate(`({meta:[...document.querySelectorAll('.dockMeta .dockGlyph')].map(e=>+getComputedStyle(e).getPropertyValue('--dock-tone')),actions:[...document.querySelectorAll('.dockAction .dockGlyph')].map(e=>+getComputedStyle(e).getPropertyValue('--dock-tone'))})`)
      assert.ok(rowInk.meta.every(v=>v===0)&&rowInk.actions.every(v=>v===255),'Each mobile row samples its own background')
      await b.evaluate('paint(false)')
    }
    await sleep(900)
    await b.evaluate(`paint(true);window.maskFade=document.querySelector('.dockBar').getAnimations().find(a=>a.effect.getKeyframes().some(f=>'--dock-shadow-progress' in f));maskFade.pause();maskFade.currentTime=0`)
    const maskPhases=[]
    for(const t of [0,28,70,140,210,280]) {
      const state=await b.evaluate(`(()=>{maskFade.currentTime=${t};const glyph=document.querySelector('.dockBack .dockGlyph');return {time:${t},tone:+getComputedStyle(glyph).getPropertyValue('--dock-tone'),mask:getComputedStyle(glyph.querySelector('.dockShadow')).maskImage}})()`)
      assert.equal(state.tone,255);assert.notEqual(state.mask,'none')
      state.maxAlpha=Math.max(...alpha(state.mask));maskPhases.push(state)
    }
    report.lastMask=maskPhases
    assert.ok(maskPhases[0].maxAlpha<.01&&maskPhases.at(-1).maxAlpha>.95)
    assert.ok(maskPhases.slice(1).every((s,i)=>s.maxAlpha>maskPhases[i].maxAlpha))
    await b.evaluate('maskFade.currentTime=70')
    const before=await b.evaluate(`getComputedStyle(document.querySelector('.dockBack .dockShadow')).maskImage`)
    await b.evaluate(`paint(false);maskFade=document.querySelector('.dockBar').getAnimations().find(a=>a.effect.getKeyframes().some(f=>'--dock-shadow-progress' in f));maskFade.pause();maskFade.currentTime=0`)
    const after=await b.evaluate(`getComputedStyle(document.querySelector('.dockBack .dockShadow')).maskImage`)
    const from=alpha(before),to=alpha(after)
    assert.equal(from.length,to.length);assert.ok(from.every((v,i)=>Math.abs(v-to[i])<.002))
    await b.evaluate(`maskFade.finish();ctx.putImageData(original,0,0);document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'))`)
    await sleep(650)
    await wake()
    const start=await b.evaluate('({raf:__metrics.executed,draws:__metrics.draws})')
    await sleep(600)
    const idle=await b.evaluate(`({raf:__metrics.executed-${start.raf},draws:__metrics.draws-${start.draws},animations:document.getAnimations().length})`)
    assert.deepEqual(idle,{raf:0,draws:0,animations:0})
    report.sizes.push({width,fonts,weight,layout,glassBlur,rowInk,enter,interrupted,reverse,leave,textSwap,maskPhases,maskRetargetMaxError:Math.max(...from.map((v,i)=>Math.abs(v-to[i]))),idle})
  }
  await b.navigate(base+'/?camera-normalized=1#/photo/IMG_20260405_173912.jpg',390,844)
  await b.until(`document.querySelector('.dockBar')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving`)
  await wake();await sleep(500)
  report.camera=await b.evaluate(`document.querySelector('.dockMetaItem[title="相机"] .dockFill').textContent`)
  assert.equal(report.camera,'HUAWEI Pura 70 Ultra')
  await b.shot('camera-mobile')
  report.status='passed';assert.deepEqual(b.errors,[])
  console.log(JSON.stringify({status:report.status,sizes:report.sizes.map(s=>({width:s.width,fonts:s.fonts,maskRetargetMaxError:s.maskRetargetMaxError,idle:s.idle}))}))
} catch(error) {report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1}
finally {await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

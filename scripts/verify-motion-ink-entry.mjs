import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('motion-ink-entry', 9341)
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const report = { sizes: [], errors: b.errors }
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.entry={pending:[],paints:0,ready:[]};window.hold=false;window.motions=[];
  document.addEventListener('glasspaint',()=>entry.paints++,true);
  document.addEventListener('glassready',e=>{
    const root=e.target,bar=root.querySelector('.dockBar'),canvas=root.querySelector('[data-glass-output]');
    const data=canvas?.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    entry.ready.push({time:performance.now(),mode:root.dataset.glass,pending:root.hasAttribute('data-glass-pending'),
      paints:entry.paints,paintedPixels:data?data.filter((v,i)=>i%4===3&&v>0).length:0,loading:bar?.hasAttribute('data-loading')});
    if(location.search.includes('float=1')){
      window.floatAnimation=bar.getAnimations().find(a=>a.effect.getKeyframes().some(f=>'--glass-material' in f));
      floatAnimation?.pause();if(floatAnimation)floatAnimation.currentTime=0;
      window.riseAnimation=bar.getAnimations().find(a=>a.effect.getKeyframes().some(f=>'transform' in f));
      riseAnimation?.pause();if(riseAnimation)riseAnimation.currentTime=0;
    }
  },true);
  document.addEventListener('dockink',e=>e.target.__ink=e.detail);
  document.addEventListener('phototransition',e=>{
    if(e.detail.phase==='ready'){
      const animations=document.getAnimations().filter(a=>a.effect?.target?.className?.includes('photoTransition'));
      motions.push({direction:e.detail.direction,animations});
      if(hold)animations.forEach(a=>{a.pause();a.currentTime=0});
    }
  });
  const inspect=()=>{
    const root=document.querySelector('.capsuleDock[data-glass-pending]'),bar=root?.querySelector('.dockBar');
    if(bar){const s=getComputedStyle(bar);entry.pending.push({opacity:s.opacity,dotAnimations:[...bar.querySelectorAll('.capsuleDots i')].flatMap(e=>e.getAnimations()).length,bg:s.backgroundColor,shadow:s.boxShadow,veil:getComputedStyle(bar,'::after').opacity,
      loading:bar.hasAttribute('data-loading'),output:[...root.querySelectorAll('[data-glass-output]')].map(e=>getComputedStyle(e).opacity)});}
    if(!entry.ready.length)requestAnimationFrame(inspect);
  };requestAnimationFrame(inspect);
` })
const wheel = (width, deltaY) => b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: 360, deltaX: 0, deltaY })
const rect = selector => b.evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)
const same = (a, z) => { for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[k] - z[k]) < 1, `${k}: ${a[k]} / ${z[k]}`) }
const endMotion = async () => {
  await b.evaluate(`motions.at(-1).animations.forEach(a=>a.finish())`)
  await b.until(`!document.documentElement.dataset.photoTransition`)
}
const wake = async () => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
}
try {
  for (const width of [1440, 390]) {
    const held = []
    b.on('Fetch.requestPaused', event => held.push(event.requestId))
    await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/media/web/*', requestStage: 'Request' }, { urlPattern: '*/media/originals/*', requestStage: 'Request' }] })
    await b.navigate(base + '/?float=1&motion-entry=' + width + '#/photo/IMG_20260319_235815.jpg', width, 844)
    await b.until(`entry.ready.length&&window.floatAnimation`)
    const entry = await b.evaluate('entry')
    report.lastEntry = entry
    assert.ok(entry.pending.length > 0)
    assert.ok(entry.pending.every(s => s.opacity === '0' && s.dotAnimations === 0 && s.bg === 'rgba(0, 0, 0, 0)' && s.shadow === 'none' && s.veil === '0' && s.loading && s.output.every(o => o === '0')))
    assert.ok(entry.ready.every(s => s.mode === 'webgl' && !s.pending && s.paints > 0 && s.paintedPixels > 0))
    const appearance = []
    for (const time of [0, 140, 350, 700, 1050, 1400]) {
      const phase = await b.evaluate(`(()=>{floatAnimation.currentTime=${time};riseAnimation.currentTime=Math.min(${time},1100);const bar=document.querySelector('.dockBar'),s=getComputedStyle(bar);return {time:${time},opacity:+s.opacity,material:+s.getPropertyValue('--glass-material'),shadow:s.boxShadow,transform:s.transform,width:bar.getBoundingClientRect().width,canvasOpacity:+getComputedStyle(bar.querySelector('[data-glass-output]')).opacity,dotOpacity:+getComputedStyle(bar.querySelector('.capsuleDots i')).opacity,dotAnimations:[...bar.querySelectorAll('.capsuleDots i')].flatMap(e=>e.getAnimations()).length}})()`)
      assert.equal(phase.width, 56)
      assert.ok(Math.abs(phase.opacity - phase.material) < .0001 && Math.abs(phase.opacity - phase.canvasOpacity) < .0001)
      assert.ok(phase.dotAnimations > 0)
      appearance.push(phase)
      if (time === 700 || time === 1400) await b.shot('floating-' + width + '-' + time)
    }
    assert.equal(appearance[0].opacity, 0)
    assert.equal(appearance.at(-1).opacity, 1)
    assert.ok(appearance.every((p, i) => i === 0 || p.opacity > appearance[i - 1].opacity))
    const rise=appearance.map(p=>Number(p.transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([\d.-]+)/)?.[1]||0))
    assert.ok(rise[0]===14&&rise.at(-1)===0&&rise[2]<2,'Entry rise must accelerate and settle')
    const riseFrames=await b.evaluate(`Array.from({length:111},(_,i)=>{riseAnimation.currentTime=i*10;return {time:i*10,y:new DOMMatrix(getComputedStyle(document.querySelector('.dockBar')).transform).m42}})`)
    assert.ok(Math.min(...riseFrames.map(f=>f.y))<-.2&&Math.min(...riseFrames.map(f=>f.y))>-.9,'Entry rise has only a weak subpixel rebound')
    await b.evaluate('floatAnimation.finish();riseAnimation.finish()')
    await b.until(`!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
    for (const requestId of held) await b.send('Fetch.continueRequest', { requestId })
    await b.send('Fetch.disable')
    await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving`)
    for (let i = 0; i < 4; i++) await wheel(width, -120)
    await sleep(280)
    await wake()
    await sleep(500)
    await b.evaluate(`window.inkIdleBefore={raf:__metrics.executed,draws:__metrics.draws}`)
    await sleep(650)
    const inkIdle = await b.evaluate(`({raf:__metrics.executed-inkIdleBefore.raf,draws:__metrics.draws-inkIdleBefore.draws,animations:[...document.querySelectorAll('.dockFill,.dockGlyph')].flatMap(e=>e.getAnimations()).length})`)
    assert.deepEqual(inkIdle, { raf: 0, draws: 0, animations: 0 }, 'An unchanged expanded toolbar must stop colour/shadow animation and sampling')
    const photoInk = await b.evaluate(`document.querySelector('.dockBar').__ink`)
    assert.ok(photoInk.labels.length > 3 && photoInk.values.every(v => v === 0 || v === 255))
    await b.shot('photo-white-' + width)
    // Pause no production code: just feed known colours to the native scene
    // after motion has settled, and call its normal invalidation event.
    await b.evaluate(`window.scene=document.querySelector('[data-glass-scene]');window.sceneContext=scene.getContext('2d');window.saved=sceneContext.getImageData(0,0,scene.width,scene.height)`)
    const fixtures = []
    const colorFades = []
    for (const [name, color, expected] of [['bright', '#eeeeee', 0], ['dark', '#263643', 255], ['mid-blue', '#667a82', 255]]) {
      const ink = await b.evaluate(`(()=>{sceneContext.fillStyle=${JSON.stringify(color)};sceneContext.fillRect(0,0,scene.width,scene.height);document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'));return document.querySelector('.dockBar').__ink})()`)
      assert.ok(ink.values.every(v => v === expected), name + ': ' + ink.values)
      fixtures.push({ name, values: ink.values, labels: ink.labels })
      if (name === 'bright' || name === 'dark') {
        await b.evaluate(`window.inkFades=[...document.querySelectorAll('.dockFill')].flatMap(e=>[...e.getAnimations(),...e.parentElement.getAnimations()]).filter(a=>a.playState!=='finished');inkFades.forEach(a=>{a.pause();a.currentTime=0})`)
        const colors = []
        const shadow = []
        for (const time of [0, 42, 105, 210, 315, 378, 420]) {
          const state = await b.evaluate(`(()=>{inkFades.forEach(a=>a.currentTime=${time});const fill=document.querySelector('.dockFill'),glyph=fill.parentElement;return {tone:+getComputedStyle(glyph).getPropertyValue('--dock-tone'),shadow:getComputedStyle(glyph.querySelector('.dockShadow'),'::before').textShadow,display:getComputedStyle(glyph.querySelector('.dockShadow')).display}})()`)
          colors.push(state.tone); shadow.push({ time, ...state })
          const inverse = Number(state.shadow.match(/rgba?\(([\d.]+)/)?.[1])
          assert.ok(Math.abs(inverse + state.tone - 255) < 1.1, 'Shadow and ink use the same interpolated inverse tone')
          assert.equal(state.display, 'block')
        }
        assert.ok(new Set(colors).size >= 4, 'Ink colour must interpolate through multiple frames')
        assert.notEqual(colors[2], colors[0]); assert.notEqual(colors[2], colors.at(-1))
        colorFades.push({ name, colors, shadow })
        await b.evaluate('inkFades.forEach(a=>a.finish())')
      }
    }
    // A bright local stripe should add dark support only on that patch, while
    // retaining the white fill of the surrounding label.
    const local = await b.evaluate(`(()=>{sceneContext.fillStyle='#263643';sceneContext.fillRect(0,0,scene.width,scene.height);
      const label=document.querySelector('.dockMetaItem .dockFill'),r=label.getBoundingClientRect(),s=scene.getBoundingClientRect();
      sceneContext.fillStyle='#ffffff';sceneContext.fillRect((r.x+r.width/2-s.x)*scene.width/s.width,0,4*scene.width/s.width,scene.height);
      document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'));
      return {ink:document.querySelector('.dockBar').__ink,gradient:getComputedStyle(label).backgroundImage,
        mask:getComputedStyle(label.parentElement.querySelector('.dockShadow')).maskImage,
        source:label.parentElement.style.getPropertyValue('--dock-shadow-mask')};})()`)
    assert.ok(local.ink.values.every(v => v === 255))
    assert.notEqual(local.mask, 'none')
    assert.ok(/--dock-(?:meta-)?shadow-progress/.test(local.source) && local.source.includes('--dock-tone'))
    await b.evaluate(`sceneContext.putImageData(saved,0,0);document.querySelector('.dockInner').dispatchEvent(new Event('glassscene'))`)

    // Measure actual geometry at evenly spaced times, in both directions.
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 30 })
    await b.evaluate('document.activeElement?.blur()')
    await b.until(`document.querySelector('.dockInner').dataset.moving==='closing'`)
    const morphs = []
    for (const direction of ['closing', 'opening']) {
      if (direction === 'opening') {
        const r = await rect('.dockBar')
        await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
        await b.until(`document.querySelector('.dockInner').dataset.moving==='opening'`)
      }
      await b.evaluate(`window.sizeMotions=document.querySelector('.dockBar').getAnimations().filter(a=>a.effect.getKeyframes().some(f=>'width' in f||'height' in f));window.morph=sizeMotions[0];sizeMotions.forEach(a=>{a.pause();a.currentTime=0})`)
      const frames = []
      for (const fraction of Array.from({ length: 91 }, (_, i) => i / 90)) {
        frames.push(await b.evaluate(`(()=>{sizeMotions.forEach(a=>a.currentTime=a.effect.getTiming().duration*${fraction});const r=document.querySelector('.dockBar').getBoundingClientRect();return {fraction:${fraction},width:r.width,height:r.height}})()`))
      }
      const progress = frames.map(f => (f.width - frames[0].width) / (frames.at(-1).width - frames[0].width))
      report.lastMorph = { direction, frames, progress }
      assert.ok(progress[9] > .3 && progress[9] < .6 && progress[45] > .98)
      const widths = frames.map(f => f.width), peak = Math.max(...progress)
      assert.ok(peak > 1.008 && peak < 1.08, 'The toolbar must visibly pass its resting position')
      const turns = []
      let sign = 0
      for (let i = 1; i < widths.length; i++) {
        const delta = widths[i] - widths[i - 1]
        if (Math.abs(delta) < .025) continue
        const next = Math.sign(delta)
        if (sign && sign !== next) turns.push(frames[i - 1])
        sign = next
      }
      assert.ok(turns.length >= 1 && turns.length <= 3, 'At most three damped rebounds')
      assert.ok(Math.min(...widths) >= 43 && Math.max(...widths) <= width - 15)
      const heights=frames.map(f=>f.height)
      const verticalProgress=heights.map(v=>(v-heights[0])/(heights.at(-1)-heights[0]))
      const verticalPeak=Math.max(...verticalProgress)
      assert.ok(direction==='opening' ? verticalPeak>1.01&&verticalPeak<1.10 : verticalPeak>1.05&&verticalPeak<1.26)
      assert.ok(Math.min(...heights)>28&&Math.max(...heights)<(width<=560?80:46))
      assert.ok(Math.abs(verticalProgress[15]-progress[15])>.005, 'Height has its own spring rhythm')
      morphs.push({ direction, frames, progress, verticalProgress, turns, peak })
      await b.evaluate('sizeMotions.forEach(a=>a.finish())')
      await b.until(`!document.querySelector('.dockInner').dataset.moving`)
    }
    await b.evaluate(`hold=false;location.hash='#/'`)
    await b.until(`document.querySelector('.tile')&&!document.documentElement.dataset.photoTransition`)
    await b.evaluate(`scrollTo(0,1200);window.selected=[...document.querySelectorAll('.tile')].find(t=>{const r=t.getBoundingClientRect();return r.y>20&&r.y<600});window.selectedId=selected.dataset.photoId;selected.querySelector('img').loading='eager'`)
    await b.until(`selected.querySelector('img').naturalWidth>0`)
    const galleryScroll = await b.evaluate('scrollY')
    await b.evaluate(`hold=true;selected.click()`)
    await b.until(`document.documentElement.dataset.photoTransition==='open'&&motions.at(-1).direction==='open'`)
    const openBefore = await rect('.photoZoom')
    for (let i = 0; i < 5; i++) await wheel(width, -240)
    await sleep(200)
    same(openBefore, await rect('.photoZoom'))
    await b.evaluate(`motions.at(-1).animations.forEach(a=>a.currentTime=680)`)
    same(await rect('[data-photo-transition-image]'), await rect('.photoZoom'))
    await endMotion()
    await wheel(width, -240)
    await sleep(200)
    const afterWheel = await rect('.photoZoom')
    assert.ok(afterWheel.width > openBefore.width + 10, 'Wheel zoom resumes after opening')
    await b.evaluate(`location.hash='#/'`)
    await b.until(`document.documentElement.dataset.photoTransition==='close'&&motions.at(-1).direction==='close'`)
    const target = () => b.evaluate(`document.querySelector('.tile[data-photo-id="'+selectedId+'"] img').getBoundingClientRect().toJSON()`)
    const closeBefore = await target()
    for (let i = 0; i < 5; i++) await wheel(width, 240)
    await sleep(200)
    same(closeBefore, await target())
    assert.equal(await b.evaluate('scrollY'), galleryScroll)
    await b.evaluate(`motions.at(-1).animations.forEach(a=>a.currentTime=680)`)
    same(await rect('[data-photo-transition-image]'), await target())
    await endMotion()
    await wheel(width, 240)
    await sleep(200)
    assert.ok(await b.evaluate('scrollY') > galleryScroll + 10, 'Gallery scrolling resumes after closing')
    report.sizes.push({ width, entry, appearance, riseFrames, inkIdle, photoInk, fixtures, colorFades, local, morphs, wheel: { galleryScroll, openBefore, afterWheel, closeBefore } })
  }
  assert.deepEqual(b.errors, [])
  report.status = 'passed'
  console.log(JSON.stringify({ status: report.status, widths: report.sizes.map(s => s.width), whitePhotoLabels: report.sizes.map(s => s.photoInk.labels), firstPaint: report.sizes.map(s => s.entry.ready), wheel: 'blocked during both transitions, restored afterwards' }))
} catch (error) { report.status = 'failed'; report.failure = error.stack; console.error(error); process.exitCode = 1 }
finally { await writeFile(b.out + '/results.json', JSON.stringify(report, null, 2)); b.close() }

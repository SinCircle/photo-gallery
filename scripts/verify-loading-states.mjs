import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('loading-states', 9343)
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const report = { sizes: [], errors: b.errors }
const state = () => b.evaluate(`(()=>{
  const root=document.querySelector('.dockInner'),bar=document.querySelector('.dockBar'),button=document.querySelector('.dockDownload');
  const dots=bar.querySelector(':scope > .capsuleDots'),icon=button.querySelector('.downloadLoading');
  return {toolbar:root.dataset.toolbar,loading:bar.hasAttribute('data-loading'),processing:bar.hasAttribute('data-busy'),
    original:document.querySelector('.photoImgHigh').currentSrc.includes('/media/originals/'),metadata:document.querySelector('.dockMeta').textContent,
    central:+getComputedStyle(dots).opacity,centerAnimations:[...dots.children].flatMap(e=>e.getAnimations()).length,
    icon:+getComputedStyle(icon).opacity,iconAnimations:[...icon.children].flatMap(e=>e.getAnimations()).length,
    idleOpacity:+getComputedStyle(bar.querySelector(':scope > .capsuleDot')).opacity,disabled:button.disabled,
    accessibleLabel:button.getAttribute('aria-label'),label:button.querySelector('.capsuleLabel').textContent,
    labelOpacity:+getComputedStyle(button.querySelector('.capsuleLabel')).opacity,
    width:bar.getBoundingClientRect().width};})()`)
const wake = async () => {
  const r = await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 })
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
}
const idle = async () => {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 15, y: 25 })
  await b.evaluate('document.activeElement?.blur()')
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed'&&!document.querySelector('.dockInner').dataset.moving`)
}
try {
  await b.send('Browser.setDownloadBehavior', { behavior: 'deny' })
  for (const width of [1440, 390, 320]) {
    const held = []
    b.on('Fetch.requestPaused', event => held.push(event.requestId))
    await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/media/originals/*', requestStage: 'Request' }] })
    await b.navigate(base + '/?loading-states=' + width + '#/photo/IMG_20260319_235815.jpg', width, 844)
    await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone')&&document.querySelector('.dockBar').hasAttribute('data-expandable')&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
    for (let i = 0; i < 30 && !held.length; i++) await sleep(100)
    assert.ok(held.length, 'Original is requested automatically after the preview')
    const initial = await state()
    assert.ok(initial.loading && !initial.original && initial.metadata.includes('2026年')&&!initial.metadata.includes('日期：')&&!initial.metadata.includes('相机：'))
    assert.equal(initial.toolbar, 'collapsed'); assert.equal(initial.central, 1)
    assert.equal(initial.centerAnimations, 8); assert.equal(initial.idleOpacity, 0)
    await wake()
    const expanded = await state()
    assert.ok(expanded.loading && !expanded.original && expanded.disabled)
    assert.equal(expanded.central, 0); assert.equal(expanded.centerAnimations, 0)
    assert.equal(expanded.icon, 1); assert.equal(expanded.iconAnimations, 8)
    assert.equal(expanded.labelOpacity, 0)
    assert.equal(expanded.accessibleLabel, '正在加载原图')
    const loadingGeometry = await b.evaluate(`(()=>{const icon=document.querySelector('.downloadLoading'),button=icon.parentElement,bar=document.querySelector('.dockBar');
      const animations=[...icon.children].flatMap(e=>e.getAnimations());animations.forEach(a=>{a.pause();a.currentTime=1440});
      const r=icon.getBoundingClientRect(),p=button.getBoundingClientRect(),b=bar.getBoundingClientRect();
      return {icon:r.toJSON(),button:p.toJSON(),bar:b.toJSON(),balls:[...icon.children].map(e=>e.getBoundingClientRect().toJSON())};})()`)
    const visibleBalls=loadingGeometry.balls.filter(r=>r.width>1).toSorted((a,z)=>a.x-z.x)
    assert.equal(visibleBalls.length,3)
    assert.ok(visibleBalls.every(r=>Math.abs(r.width-5)<.03&&Math.abs(r.height-5)<.03))
    assert.ok(visibleBalls.slice(1).every((r,i)=>Math.abs(r.x-visibleBalls[i].x-14)<.03))
    assert.ok(visibleBalls.every(r=>r.x>=loadingGeometry.bar.x&&r.right<=loadingGeometry.bar.right&&r.y>=loadingGeometry.button.y&&r.bottom<=loadingGeometry.button.bottom))
    assert.ok(Math.abs((loadingGeometry.icon.x+loadingGeometry.icon.width/2)-(loadingGeometry.button.x+loadingGeometry.button.width/2))<.02)
    await b.shot('original-pending-expanded-' + width)
    await b.evaluate(`[...document.querySelectorAll('.downloadLoading i')].flatMap(e=>e.getAnimations()).forEach(a=>a.play())`)
    await idle()
    const collapsed = await state()
    assert.ok(collapsed.loading && collapsed.centerAnimations === 8 && collapsed.idleOpacity === 0)
    assert.equal(collapsed.width, 56)
    await b.shot('original-pending-collapsed-' + width)
    await wake()
    await b.evaluate(`window.completedSwap=[];window.completionObserver=new MutationObserver(()=>{if(!document.querySelector('.dockBar').hasAttribute('data-loading')){
      completedSwap=[...document.querySelectorAll('.dockDownload > .capsuleLabel,.dockDownload > .downloadLoading')].flatMap(e=>e.getAnimations());
      completedSwap.forEach(a=>{a.pause();a.currentTime=0});completionObserver.disconnect();
    }});completionObserver.observe(document.querySelector('.dockBar'),{attributes:true,attributeFilter:['data-loading']})`)
    for (const requestId of held) await b.send('Fetch.continueRequest', { requestId })
    await b.send('Fetch.disable')
    await b.until(`document.querySelector('.photoImgHigh').currentSrc.includes('/media/originals/')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving`)
    const completion=[]
    for(const time of [0,84,210,420,630,840]) {
      const frame=await b.evaluate(`(()=>{completedSwap.forEach(a=>a.currentTime=${time});const label=document.querySelector('.dockDownload > .capsuleLabel'),icon=document.querySelector('.downloadLoading');return {time:${time},label:+getComputedStyle(label).opacity,icon:+getComputedStyle(icon).opacity,blur:getComputedStyle(label).filter,balls:[...icon.children].flatMap(e=>e.getAnimations()).length}})()`)
      completion.push(frame)
      if(time===210||time===420||time===840)await b.shot('original-completion-'+width+'-'+time)
    }
    assert.deepEqual(completion.map(f=>f.balls),[8,8,8,8,8,8])
    assert.equal(completion[0].label,0);assert.equal(completion[0].icon,1);assert.equal(completion[0].blur,'blur(6px)')
    assert.ok(completion.slice(1,-1).every(f=>f.label>0&&f.label<1&&f.icon>0&&f.icon<1&&Math.abs(f.label+f.icon-1)<.001))
    assert.ok(completion[2].label<.2&&Number(completion[2].blur.match(/[\d.]+/)[0])>4.8,'Completion blur stays visible beyond the first frames')
    assert.equal(completion.at(-1).label,1);assert.equal(completion.at(-1).icon,0);assert.equal(completion.at(-1).blur,'blur(0px)')
    await b.evaluate('completedSwap.forEach(a=>a.finish())')
    await b.until(`[...document.querySelectorAll('.downloadLoading i')].every(e=>e.getAnimations().length===0)`)
    const original = await state()
    assert.ok(original.original && !original.loading && !original.disabled)
    assert.equal(original.iconAnimations, 0); assert.equal(original.icon, 0)

    // Hold only JPEG encoding in this isolated browser to exercise a long save
    // operation without downloading files or changing production data.
    await b.evaluate(`window.pendingEncodes=[];window.realToBlob=HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob=function(callback,type,...args){
        if(type==='image/jpeg')pendingEncodes.push(()=>realToBlob.call(this,callback,type,...args));
        else realToBlob.call(this,callback,type,...args);
      };document.querySelector('.dockDownload').click()`)
    await b.until(`pendingEncodes.length===1`)
    await wake()
    const savingExpanded = await state()
    assert.ok(savingExpanded.processing && savingExpanded.disabled && savingExpanded.iconAnimations === 8)
    assert.equal(savingExpanded.accessibleLabel, '正在准备图片')
    assert.notEqual(savingExpanded.label, '等待')
    await b.shot('saving-expanded-' + width)
    await idle()
    const savingCollapsed = await state()
    assert.ok(savingCollapsed.processing && savingCollapsed.centerAnimations === 8 && savingCollapsed.idleOpacity === 0)
    await b.shot('saving-collapsed-' + width)
    await b.evaluate('pendingEncodes.shift()();HTMLCanvasElement.prototype.toBlob=realToBlob')
    await b.until(`!document.querySelector('.dockBar').hasAttribute('data-busy')&&!document.querySelector('.dockDownload').disabled`)
    await sleep(900)
    const completed = await state()
    assert.equal(completed.toolbar, 'collapsed'); assert.equal(completed.centerAnimations, 0)
    assert.equal(completed.iconAnimations, 0); assert.equal(completed.idleOpacity, 1)
    report.sizes.push({ width, initial, expanded, loadingGeometry, collapsed, completion, original, savingExpanded, savingCollapsed, completed })
  }
  assert.deepEqual(b.errors, [])
  report.status = 'passed'
  console.log(JSON.stringify({ status: report.status, widths: report.sizes.map(s => s.width), original: 'pending through preview, expandable with metadata', saving: 'button icon and collapsed capsule remain busy until complete' }))
} catch (error) { report.status = 'failed'; report.failure = error.stack; console.error(error); process.exitCode = 1 }
finally { await writeFile(b.out + '/results.json', JSON.stringify(report, null, 2)); b.close() }

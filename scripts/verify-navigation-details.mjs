import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'
const b=await browserSession('transition-details/toolbar',9336)
const report={sizes:[],errors:b.errors}
await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  // A webfont that never resolves must not gate metadata visibility.
  Object.defineProperty(document.fonts,'ready',{get:()=>new Promise(()=>{})});
`})
try{
 for(const width of [1440,390]){
  await b.navigate('http://127.0.0.1:5187/?instant='+width+'#/photo/IMG_20260319_235815.jpg',width,844)
  await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone') && !document.querySelector('.dockBar').hasAttribute('data-loading') && !document.querySelector('.dockInner').hasAttribute('data-glass-appearing') && !document.querySelector('.dockInner').dataset.moving`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:30})
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').dataset.moving`)
  // Record one actual hover-triggered expansion, stopping only its compositor
  // animations to inspect exact phases independent of test-machine timing.
  const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2})
  await b.evaluate(`window.a=[...document.querySelectorAll('.dockBar,.dockBar > *')].flatMap(e=>e.getAnimations());a.forEach(a=>{a.pause();a.currentTime=0})`)
  const phases=[]
  for(const time of [0,40,120,350,700,1050,1400]){
   await b.evaluate(`a.forEach(a=>a.currentTime=${time})`)
   const phase=await b.evaluate(`({time:${time},bar:document.querySelector('.dockBar').getBoundingClientRect().width,items:[...document.querySelectorAll('.dockAction,.dockMeta')].map(e=>({opacity:+getComputedStyle(e).opacity,visibility:getComputedStyle(e).visibility,filter:getComputedStyle(e).filter,delay:e.getAnimations()[0]?.effect.getTiming().delay}))})`)
   phases.push(phase)
   assert.ok(phase.items.every(i=>i.visibility==='visible' && (i.delay??0)===0))
   if(time===40)assert.ok(phase.items.every(i=>i.opacity>.05))
   if(time===1400)assert.ok(phase.items.every(i=>i.opacity===1 && !/blur\([1-9]/.test(i.filter)))
  }
  await b.evaluate('a.forEach(a=>a.finish())')
  await b.until(`!document.querySelector('.dockInner').dataset.moving`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:370,deltaX:0,deltaY:-2000})
  await b.until(`document.querySelector('.photoImgHigh').currentSrc.includes('/media/originals/')`)
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'})
  await b.until(`!document.querySelector('.dockInner').dataset.moving && document.querySelector('.dockInner').dataset.toolbar==='expanded'`)
  const zoom=await b.evaluate(`({rect:document.querySelector('.photoZoom').getBoundingClientRect().toJSON(),buttons:[...document.querySelectorAll('.dockAction')].map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,topmost:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.dockAction')===e}})})`)
  assert.ok(zoom.buttons.every(b=>b.topmost))
  await b.shot('zoom-toolbar-'+width)
  report.sizes.push({width,phases,zoom})
 }
 // Moving over the resting dot and immediately clicking must not navigate
 // through a control that has just appeared beneath the pointer.
 await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:30})
 await b.evaluate('document.activeElement.blur()')
 await b.until(`document.querySelector('.dockInner').dataset.toolbar==='collapsed' && !document.querySelector('.dockInner').dataset.moving`)
 const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
 await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2})
 await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1})
 await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1})
 await sleep(300)
 assert.ok((await b.evaluate('location.hash')).includes('/photo/'))
 report.noClickThrough=true
 assert.deepEqual(b.errors,[])
 report.status='passed';console.log(JSON.stringify(report))
}catch(e){report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1}
finally{await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

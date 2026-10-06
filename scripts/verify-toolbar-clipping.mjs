import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {browserSession,sleep} from './browser-session.mjs'
const sharp=createRequire(new URL('../server/package.json',import.meta.url))('sharp')
const b=await browserSession('toolbar-clipping',9349)
const report={sizes:[],errors:b.errors}
const pixels=async()=>sharp(Buffer.from((await b.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true})
try {
 for(const width of [1440,390,320]) {
  await b.navigate('http://127.0.0.1:5187/?clip-check='+width+'#/photo/IMG_20260327_170359.jpg',width,844)
  await b.until(`document.querySelector('.dockBar')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:20})
  await b.until(`document.querySelector('.dockInner').dataset.moving==='closing'`)
  const phases=[]
  for(const direction of ['closing','opening']) {
   if(direction==='opening') {
    const r=await b.evaluate(`document.querySelector('.dockBar').getBoundingClientRect().toJSON()`)
    await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2})
    await b.until(`document.querySelector('.dockInner').dataset.moving==='opening'`)
   }
   await b.evaluate(`window.frozen=document.getAnimations();frozen.forEach(a=>a.pause());window.hideText=document.createElement('style');document.head.append(hideText)`)
   for(const time of [0,60,120,240,480,900]) {
    const state=await b.evaluate(`(()=>{frozen.forEach(a=>a.currentTime=${time});const bar=document.querySelector('.dockBar'),s=getComputedStyle(bar),r=bar.getBoundingClientRect();return {direction:'${direction}',time:${time},rect:r.toJSON(),radius:Math.min(parseFloat(s.borderRadius),r.height/2,r.width/2),overflow:s.overflow,filter:s.filter}})()`)
    await sleep(100)
    const on=await pixels()
    if(time===120)await b.shot(direction+'-'+width+'-'+time)
    await b.evaluate(`hideText.textContent='.dockBar .dockAction,.dockBar .dockMeta{opacity:0!important}'`)
    const off=await pixels()
    await b.evaluate(`hideText.textContent=''`)
    let outsideChanged=0,insideChanged=0,maxDelta=0
    const r=state.rect,rad=state.radius
    for(let y=Math.max(0,Math.floor(r.top-20));y<Math.min(on.info.height,Math.ceil(r.bottom+20));y++)for(let x=0;x<on.info.width;x++) {
     const k=(y*on.info.width+x)*4,d=Math.max(...[0,1,2].map(c=>Math.abs(on.data[k+c]-off.data[k+c])))
     if(d<4)continue
     const px=x+.5,py=y+.5,cx=Math.max(r.left+rad,Math.min(px,r.right-rad)),cy=Math.max(r.top+rad,Math.min(py,r.bottom-rad))
     const inside=Math.hypot(px-cx,py-cy)<=rad+1.5
     if(inside)insideChanged++;else{outsideChanged++;maxDelta=Math.max(maxDelta,d)}
    }
    phases.push({...state,outsideChanged,insideChanged,maxDelta})
   }
   await b.evaluate('hideText.remove();frozen.forEach(a=>a.finish())')
   await b.until(`!document.querySelector('.dockInner').dataset.moving`)
  }
  report.sizes.push({width,phases})
  console.log(JSON.stringify({width,phases:phases.map(({direction,time,overflow,outsideChanged,insideChanged,maxDelta})=>({direction,time,overflow,outsideChanged,insideChanged,maxDelta}))}))
 }
 assert.ok(report.sizes.every(s=>s.phases.some(p=>p.insideChanged>10)),'Pixel comparison must see actual text')
 assert.ok(report.sizes.every(s=>s.phases.every(p=>p.outsideChanged===0)),'Text pixels must never escape the rounded capsule')
 assert.deepEqual(b.errors,[]);report.status='passed'
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1}
finally{await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

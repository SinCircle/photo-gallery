import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { browserSession, sleep } from './browser-session.mjs'

const sharp=createRequire(new URL('../server/package.json',import.meta.url))('sharp')

const name=process.env.INK_NAME||'loading-ink'
const b=await browserSession(name,Number(process.env.INK_PORT||9357))
const base=process.env.VERIFY_URL||'http://127.0.0.1:5187'
const report={forcedDark:process.env.INK_DARK==='1',cssFallback:process.env.INK_FALLBACK==='1',sizes:[],errors:b.errors}
const dotPixel=async selector=>{
  const box=await b.evaluate(`(()=>{const dots=document.querySelector(${JSON.stringify(selector)});[...dots.children].flatMap(e=>e.getAnimations()).forEach(a=>{a.pause();a.currentTime=1440});return [...dots.children].map(e=>e.getBoundingClientRect().toJSON()).find(r=>r.width>3)})()`)
  const png=await b.send('Page.captureScreenshot',{format:'png',clip:{x:box.x+box.width/2-.5,y:box.y+box.height/2-.5,width:1,height:1,scale:1},captureBeyondViewport:false})
  const {data}=await sharp(Buffer.from(png.data,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true})
  const value=[...data].reduce((sum,n)=>sum+n,0)/data.length
  await b.evaluate(`[...document.querySelector(${JSON.stringify(selector)}).children].flatMap(e=>e.getAnimations()).forEach(a=>a.play())`)
  return value
}
const wake=async()=>{
  await b.evaluate(`document.querySelector('.dockBar').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
  await b.evaluate(`document.querySelector('.dockBack').focus({preventScroll:true})`)
}
const paint=async mode=>{
  await b.evaluate(`(()=>{
    const canvas=window.inkFixture,ctx=canvas.getContext('2d'),bar=document.querySelector('.dockBar').getBoundingClientRect();
    const white=${JSON.stringify(mode)}==='white'||${JSON.stringify(mode)}==='dark-download';
    ctx.fillStyle=white?'#fff':'#080808';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(${JSON.stringify(mode)}.endsWith('download')){
      const r=document.querySelector('.dockDownload').getBoundingClientRect();
      ctx.fillStyle=white?'#080808':'#fff';ctx.fillRect(r.x-8,bar.y,r.width+16,bar.height);
    }
    if(${JSON.stringify(mode)}==='split-rows'){
      const a=document.querySelector('.dockMeta').getBoundingClientRect(),z=document.querySelector('.dockBack').getBoundingClientRect();
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,(a.bottom+z.top)/2);
    }
    document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'));
  })()`)
  await sleep(750)
  return b.evaluate(`(()=>{
    const style=s=>getComputedStyle(document.querySelector(s)),bar=document.querySelector('.dockBar'),root=document.querySelector('.dockInner');
    return {mode:${JSON.stringify(mode)},glass:root.dataset.glass,toolbar:root.dataset.toolbar,
      label:style('.dockDownload .dockFill').color,back:style('.dockBack .dockFill').color,
      metadata:[...document.querySelectorAll('.dockMeta .dockFill')].map(e=>getComputedStyle(e).color),
      download:style('.downloadLoading i').backgroundColor,central:style('.dockBar > .capsuleDots i').backgroundColor,
      idle:style('.capsuleDot').backgroundColor,animations:[...document.querySelector('.downloadLoading').children].flatMap(e=>e.getAnimations()).length};
  })()`)
}
try {
  if(process.env.INK_DARK==='1')await b.send('Emulation.setAutoDarkModeOverride',{enabled:true})
  if(process.env.INK_FALLBACK==='1')await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativeContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:nativeContext.call(this,type,...args)}`})
  const failures=[]
  for(const width of (process.env.INK_WIDTHS||'1440,390').split(',').map(Number)) {
    const held=[]
    b.on('Fetch.requestPaused',event=>held.push(event.requestId))
    await b.send('Fetch.enable',{patterns:[{urlPattern:'*/media/originals/*',requestStage:'Request'}]})
    await b.navigate(base+'/?ink-check='+width+'#/photo/IMG_3512.jpg',width,844)
    if(width===390){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:3,mobile:true})
      await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
    }
    await b.until(`document.querySelector('.photoStage')?.classList.contains('hiDone')&&!document.querySelector('.dockInner').hasAttribute('data-glass-appearing')&&!document.querySelector('.dockInner').dataset.moving`)
    await b.evaluate(`window.inkFixture=document.createElement('canvas');inkFixture.width=innerWidth;inkFixture.height=innerHeight;inkFixture.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none';document.querySelector('.photoShell').append(inkFixture)`)
    const collapsed=[]
    for(const mode of ['white','dark','white']) {
      const state=await paint(mode)
      await b.shot(`${width}-collapsed-${mode}`)
      state.dotPixel=await dotPixel('.dockBar > .capsuleDots')
      if(mode==='white'?state.dotPixel>80:state.dotPixel<180)failures.push({width,mode,kind:'raster-central',actual:state.dotPixel})
      collapsed.push(state)
    }
    await wake()
    const expanded=[]
    for(const mode of ['white','dark','light-download','dark-download',...(width===390?['split-rows']:[])]) {
      const state=await paint(mode);expanded.push(state)
      assert.equal(state.toolbar,'expanded')
      const light=mode==='white'||mode==='light-download'
      const expected=light?'rgb(0, 0, 0)':'rgb(255, 255, 255)'
      if(state.label!==expected)failures.push({width,mode,kind:'label',actual:state.label,expected})
      if(state.download!==expected)failures.push({width,mode,kind:'download',actual:state.download,expected})
      if(mode==='split-rows'&&!state.metadata.every(v=>v==='rgb(0, 0, 0)'))failures.push({width,mode,kind:'metadata',actual:state.metadata})
      await b.shot(`${width}-${mode}`)
      // Auto-dark mode can repaint black text as white without changing its
      // computed CSS colour. Inspect actual pixels, not just the style result.
      if(mode==='white'||mode==='dark') {
        const box=await b.evaluate(`document.querySelector('.dockBack .dockFill').getBoundingClientRect().toJSON()`)
        const png=await b.send('Page.captureScreenshot',{format:'png',clip:{x:box.x,y:box.y,width:box.width,height:box.height,scale:1},captureBeyondViewport:false})
        const {data,info}=await sharp(Buffer.from(png.data,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true})
        let dark=0,light=0
        for(let i=0;i<data.length;i+=info.channels){if(data[i]<60&&data[i+1]<60&&data[i+2]<60)dark++;if(data[i]>220&&data[i+1]>220&&data[i+2]>220)light++}
        state.raster={dark,light,pixels:info.width*info.height}
        if((mode==='white'?dark:light)<5)failures.push({width,mode,kind:'raster-text',actual:state.raster})
        state.dotPixel=await dotPixel('.downloadLoading')
        if(mode==='white'?state.dotPixel>80:state.dotPixel<180)failures.push({width,mode,kind:'raster-download',actual:state.dotPixel})
      }
    }
    for(const state of collapsed){
      const expected=state.mode==='white'?'rgb(0, 0, 0)':'rgb(255, 255, 255)'
      if(state.central!==expected)failures.push({width,mode:state.mode,kind:'central',actual:state.central,expected})
    }
    report.sizes.push({width,mobile:width===390,collapsed,expanded})
    for(const requestId of held)await b.send('Fetch.continueRequest',{requestId})
    await b.send('Fetch.disable')
  }
  report.failures=failures
  console.log(JSON.stringify({widths:report.sizes.map(s=>s.width),forcedDark:report.forcedDark,cssFallback:report.cssFallback,failures}))
  assert.deepEqual(failures,[])
  assert.deepEqual(b.errors,[])
  report.status='passed'
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1}
finally{await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

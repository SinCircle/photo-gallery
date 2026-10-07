import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'
const b=await browserSession('performance-sweep/style-diagnostic',9376)
const results=[]
try {
  await b.send('Performance.enable')
  await b.navigate('http://127.0.0.1:5187/?style-cost#/photo/IMG_20260815_153938.jpg',390,844)
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true})
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
  await b.send('Emulation.setCPUThrottlingRate',{rate:4})
  await b.until(`document.querySelector('.dockBar')&&!document.querySelector('.dockBar').hasAttribute('data-loading')&&!document.querySelector('.dockInner').dataset.moving`)
  await b.evaluate(`document.querySelector('.dockBar').dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));document.querySelector('.dockBack').focus({preventScroll:true})`)
  await b.until(`document.querySelector('.dockInner').dataset.toolbar==='expanded'&&!document.querySelector('.dockInner').dataset.moving`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:195,y:420,deltaX:0,deltaY:-650})
  await sleep(1200)
  const touch=(type,half)=>b.send('Input.dispatchTouchEvent',{type,touchPoints:half===null?[]:[{id:1,x:195-half,y:420},{id:2,x:195+half,y:420}]})
  await touch('touchStart',45)
  for(let half=60;half<=150;half+=15){await touch('touchMove',half);await sleep(50)}
  await touch('touchEnd',null);await sleep(500)
  for(const [name,css] of [
    ['normal',''],
    ['no-mask','.dockShadow{mask-image:none!important}'],
    ['fixed-progress','.dockBar{--dock-shadow-progress:1!important;--dock-meta-shadow-progress:1!important}'],
    ['no-shadow','.dockShadow{display:none!important}'],
    ['normal-repeat',''],
  ]) {
    await b.evaluate(`(()=>{let s=document.getElementById('diagnostic');if(!s){s=document.createElement('style');s.id='diagnostic';document.head.append(s)}s.textContent=${JSON.stringify(css)}})()`)
    await sleep(500)
    await touch('touchStart',45)
    await b.evaluate(`document.querySelector('.dockBar').dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));document.querySelector('.dockBack').focus({preventScroll:true})`)
    const before=(await b.send('Performance.getMetrics')).metrics
    const t=performance.now()
    for(let i=0;i<20;i++)await touch('touchMove',45+Math.sin(i*Math.PI*2/19)*15)
    await touch('touchEnd',null)
    await sleep(500)
    const after=(await b.send('Performance.getMetrics')).metrics
    results.push({name,elapsed:performance.now()-t,...Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','RecalcStyleCount'].map(k=>[k,(k.endsWith('Duration')?1000:1)*(after.find(m=>m.name===k).value-before.find(m=>m.name===k).value)]))})
  }
  console.log(JSON.stringify(results))
}finally{await writeFile(b.out+'/results.json',JSON.stringify(results,null,2));b.close()}

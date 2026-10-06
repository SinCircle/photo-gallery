import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {browserSession,sleep} from './browser-session.mjs'
const b=await browserSession('toolbar-loading-page',9307)
const {send,evaluate,until}=b
try {
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('dockink',e=>e.target.__inkDiagnostic=e.detail)`})
 await send('Emulation.setDeviceMetricsOverride',{width:400,height:240,deviceScaleFactor:1,mobile:false})
 await send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:16000,uploadThroughput:16000})
 // Hold image requests before bytes arrive, so decoding cannot race the
 // empty-photo capture. The full relay test separately uses only throttling.
 await send('Fetch.enable',{patterns:[{urlPattern:'*/media/*',resourceType:'Image',requestStage:'Request'}]})
 await send('Page.navigate',{url:'http://127.0.0.1:5187/?empty-ink=1#/photo/IMG_20260815_153938.jpg'})
 await until(`document.querySelector('.dockBar')?.hasAttribute('data-loading')&&!document.querySelector('.photoImgLow').naturalWidth`)
 await send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:1,uploadThroughput:1})
 await evaluate(`document.querySelector('.capsuleDots').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=300});document.querySelector('.dockInner').dispatchEvent(new Event('glassrefresh'))`)
 await sleep(150)
 const state=await evaluate(`(()=>{const b=document.querySelector('.dockBar');return {rect:b.getBoundingClientRect().toJSON(),loading:b.hasAttribute('data-loading'),low:document.querySelector('.photoImgLow').naturalWidth,ink:b.__inkDiagnostic,dot:getComputedStyle(b.querySelector('.capsuleDots i')).backgroundColor}})()`)
 assert.equal(state.low,0);assert.ok(state.loading);assert.equal(state.ink.source,'page')
 assert.ok(state.ink.sampled.every(v=>v>.89))
 const r=state.rect,clip={x:r.x-4,y:r.y-4,width:r.width+8,height:r.height+8,scale:6}
 const shot=await send('Page.captureScreenshot',{format:'png',clip})
 await writeFile(b.out+'/page-loading-6x.png',Buffer.from(shot.data,'base64'))
 await writeFile(b.out+'/report.json',JSON.stringify(state,null,2))
 console.log(JSON.stringify({source:state.ink.source,luma:state.ink.sampled[0],dot:state.dot,low:state.low}))
}finally{b.close()}

import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession } from './browser-session.mjs'
const b=await browserSession('performance-sweep/display-fonts',9377)
const report={cases:[],errors:b.errors}
const responses=[]
b.on('Network.responseReceived',event=>{if(event.response.url.includes('fonts.googleapis.com'))responses.push({id:event.requestId,status:event.response.status})})
try {
  await b.send('DOM.enable');await b.send('CSS.enable')
  for(const base of ['http://127.0.0.1:5196','http://127.0.0.1:5187']) {
    await b.navigate(base+'/?display-fonts#/')
    await b.until(`document.querySelectorAll('.tile').length===44`)
    await b.evaluate('document.fonts.ready')
    const document=await b.send('DOM.getDocument')
    const node=await b.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'.tileDate'})
    const fonts=(await b.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts
    const resources=await b.evaluate(`performance.getEntriesByType('resource').filter(r=>r.name.includes('/fonts/')||r.name.includes('googleapis')||r.name.includes('gstatic')).map(r=>({url:r.name,status:r.responseStatus}))`)
    if(base.endsWith('5187'))assert.ok(fonts.some(font=>font.familyName==='Cinzel Decorative'),'Intended Latin typeface must actually render')
    report.cases.push({base,fonts,resources})
  }
  for(const response of responses)if(response.status!==200)response.body=(await b.send('Network.getResponseBody',{requestId:response.id})).body.slice(0,1500)
  report.fontCSSResponses=responses
  report.status='passed'
  console.log(JSON.stringify(report))
}catch(error){report.status='failed';report.failure=error.stack;console.error(error);process.exitCode=1}
finally{await writeFile(b.out+'/results.json',JSON.stringify(report,null,2));b.close()}

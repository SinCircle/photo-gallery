import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const out=path.resolve('.superpowers/verification')
await mkdir(out,{recursive:true})
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'
const reference=createServer(async(req,res)=>{
  try{
    const uri=decodeURIComponent((req.url||'/').split('?')[0])
    let file=path.join(out,'reference/dist',uri==='/'?'index.html':uri)
    if(uri.startsWith('/images/')){const rel=uri.slice(8);file=path.join(out,'library',rel.startsWith('thumbs/')?rel:`originals/${rel}`)}
    res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg'}[path.extname(file)]||'application/octet-stream')
    res.end(await readFile(file))
  }catch{res.statusCode=404;res.end()}
})
await new Promise(resolve=>reference.listen(5185,'127.0.0.1',resolve))
const cases=[
  ['cli-gallery','http://127.0.0.1/',1400],
  ['cli-photo','http://127.0.0.1/#/photo/!IMG_20260103_160706.jpg',1000],
  ['cli-reference-gallery','http://127.0.0.1:5185/',1400],
  ['cli-reference-photo','http://127.0.0.1:5185/#/photo/!IMG_20260103_160706.jpg',1000],
]
try{
for(const [name,url,height] of cases){
  assert.equal((await fetch(url)).status,200,`Page unavailable: ${url}`)
  const args=['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--hide-scrollbars',
    '--enable-unsafe-swiftshader','--force-device-scale-factor=1',`--window-size=1440,${height}`,
    '--virtual-time-budget=45000',`--screenshot=${path.join(out,name+'.png')}`,
    `--user-data-dir=${path.join(out,'cli-profile')}`,url]
  const proc=spawn(chrome,args,{windowsHide:true,stdio:'ignore'})
  const code=await new Promise(r=>proc.once('exit',r))
  if(code!==0)throw Error(`Chrome exited ${code}: ${name}`)
  assert.ok((await readFile(path.join(out,name+'.png'))).length>10000,'Screenshot must contain rendered content')
  console.log(`PASS screenshot: ${name}.png; --virtual-time-budget=45000; 1440x${height}`)
}
}finally{reference.close()}

import { spawn } from 'node:child_process'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const out=path.resolve('.superpowers/verification')
await mkdir(out,{recursive:true})
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'
const cases=[
  ['cli-gallery','http://127.0.0.1/',1400],
  ['cli-photo','http://127.0.0.1/#/photo/!IMG_20260103_160706.jpg',1000],
  ['cli-reference-gallery','http://127.0.0.1:5175/',1400],
  ['cli-reference-photo','http://127.0.0.1:5175/#/photo/!IMG_20260103_160706.jpg',1000],
]
for(const [name,url,height] of cases){
  const args=['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--hide-scrollbars',
    '--enable-unsafe-swiftshader','--force-device-scale-factor=1',`--window-size=1440,${height}`,
    '--virtual-time-budget=45000',`--screenshot=${path.join(out,name+'.png')}`,
    `--user-data-dir=${path.join(out,'cli-profile')}`,url]
  const proc=spawn(chrome,args,{windowsHide:true,stdio:'ignore'})
  const code=await new Promise(r=>proc.once('exit',r))
  if(code!==0)throw Error(`Chrome exited ${code}: ${name}`)
  console.log(`PASS screenshot: ${name}.png; --virtual-time-budget=45000; 1440x${height}`)
}

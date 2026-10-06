// Pin Google's Noto Serif SC SemiBold subsets locally. Unicode-range lets the
// browser fetch only the glyph groups a page actually uses, without contacting
// a font CDN at runtime. Re-run deliberately to update the pinned assets.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const directory='public/fonts/noto-serif-sc'
await mkdir(directory,{recursive:true})
const source='https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600&display=swap'
const response=await fetch(source,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'}})
if(!response.ok)throw Error('Font CSS: '+response.status)
let css=await response.text()
const urls=[...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m=>m[1]))]
let bytes=0
for(let start=0;start<urls.length;start+=8)await Promise.all(urls.slice(start,start+8).map(async(url,index)=>{
  const file=`semibold-${String(start+index).padStart(3,'0')}.woff2`
  const asset=await fetch(url)
  if(!asset.ok)throw Error('Font subset: '+asset.status)
  const data=new Uint8Array(await asset.arrayBuffer())
  if(String.fromCharCode(...data.slice(0,4))!=='wOF2')throw Error('Expected WOFF2 '+url)
  bytes+=data.length
  await writeFile(path.join(directory,file),data)
  css=css.split(url).join('./'+file)
}))
const license=await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt')
if(!license.ok)throw Error('Font license: '+license.status)
await writeFile(path.join(directory,'OFL.txt'),await license.text())
await writeFile(path.join(directory,'font.css'),`/* Noto Serif SC SemiBold. Source: ${source}\n   Copyright Google Inc.; SIL Open Font License 1.1, see OFL.txt. */\n`+css)
await writeFile(path.join(directory,'source.json'),JSON.stringify({source,weight:600,urls,bytes},null,2))
console.log(JSON.stringify({subsets:urls.length,bytes}))

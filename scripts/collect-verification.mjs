import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from '../server/node_modules/sharp/lib/index.js'

const scratch=path.resolve('.superpowers/verification')
const destination=path.resolve('docs/verification/2026-10-05')
await mkdir(destination,{recursive:true})
const read=async name=>JSON.parse(await readFile(path.join(scratch,name),'utf8'))
const browser=await read('results.json')
const admin=await read('admin-results.json')
const development=await read('dev-without-docker-results.json')
for(const record of [browser,admin,development])assert.equal(record.status,'passed')
await writeFile(path.join(destination,'results.json'),JSON.stringify({
  reference:execFileSync('git',['rev-parse','68e64de^'],{encoding:'utf8'}).trim(),
  implementation:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  browser,admin,development:{status:development.status,...development.checks.development},
},null,2))
for(const name of ['gallery-first','gallery-middle','photo']){
  const images=await Promise.all([`reference-${name}`,name].map(async file=>{
    const {data,info}=await sharp(path.join(scratch,`${file}.png`)).resize({width:700}).png().toBuffer({resolveWithObject:true})
    return {data,info}
  }))
  await sharp({create:{width:1400,height:Math.max(...images.map(i=>i.info.height)),channels:3,background:'#f4f4f4'}})
    .composite(images.map((i,n)=>({input:i.data,left:n*700,top:0}))).jpeg({quality:92}).toFile(path.join(destination,`${name}.jpg`))
}
for(const [source,target] of [['target-0.jpg','target-gallery.jpg'],['target-1.jpg','target-photo.jpg']])
  await copyFile(path.join(scratch,source),path.join(destination,target))
for(const name of ['admin','mobile-save-fallback','photo-reduced-motion'])
  await sharp(path.join(scratch,`${name}.png`)).resize({width:700,withoutEnlargement:true}).jpeg({quality:92}).toFile(path.join(destination,`${name}.jpg`))
console.log('PASS evidence: three legacy/current comparison images + confirmation targets + measured results archived')

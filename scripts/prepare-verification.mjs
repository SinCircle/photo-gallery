import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'

const root=path.resolve('.superpowers/verification/reference')
const files=execFileSync('git',['ls-tree','-r','--name-only','68e64de^','src'],{encoding:'utf8'}).trim().split('\n')
files.push('index.html','tsconfig.json')
for(const file of files){
  await mkdir(path.dirname(path.join(root,file)),{recursive:true})
  await writeFile(path.join(root,file),execFileSync('git',['show',`68e64de^:${file}`]))
}
const photos=(await(await fetch(process.env.VERIFY_URL?`${process.env.VERIFY_URL}/api/photos`:'http://127.0.0.1/api/photos')).json()).photos
await mkdir(path.join(root,'public'),{recursive:true})
await writeFile(path.join(root,'public/images-manifest.json'),JSON.stringify({images:photos.map(p=>({path:p.id,thumb:`thumbs/${p.id}`,date:p.takenAt,fields:p.exif}))}))
await writeFile(path.join(root,'package.json'),'{"type":"module"}')
const exifr=path.resolve('server/node_modules/exifr/dist/full.esm.mjs').replaceAll('\\','/')
await writeFile(path.join(root,'vite.config.ts'),`import { defineConfig } from 'vite'
export default defineConfig({resolve:{alias:{exifr:${JSON.stringify(exifr)}}},server:{proxy:{'/images/thumbs/':{target:'http://127.0.0.1',rewrite:p=>p.replace('/images/thumbs/','/media/thumbs/')},'/images/':{target:'http://127.0.0.1',rewrite:p=>p.replace('/images/','/media/originals/')}}}})
`)
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build',root,'--config',path.join(root,'vite.config.ts')],{stdio:'inherit'})
// The actual confirmation material is decoded without alteration.
try{
  const html=await readFile('.superpowers/brainstorm/7910-1791175090/content/target-design.html','utf8')
  let i=0
  for(const m of html.matchAll(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/g))await writeFile(path.join(root,'..',`target-${i++}.jpg`),Buffer.from(m[1],'base64'))
}catch{
  // A clean checkout has the archived targets, without the brainstorm scratch directory.
  await copyFile('docs/verification/2026-10-05/target-gallery.jpg',path.join(root,'..','target-0.jpg'))
  await copyFile('docs/verification/2026-10-05/target-photo.jpg',path.join(root,'..','target-1.jpg'))
}
console.log('PASS reference: unmodified 68e64de^ sources built; manifest only in isolated verification root')

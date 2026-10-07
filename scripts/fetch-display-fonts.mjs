// Pin the existing display typefaces. No third-party font request at runtime.
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const directory = 'public/fonts/display'
const source = 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@500;600&family=Cormorant+Garamond:wght@400;500;600&family=Cormorant+SC:wght@400;600&display=swap'
const response = await fetch(source, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' } })
if (!response.ok) throw Error('Font CSS: ' + response.status)
let css = await response.text()
const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))]
await mkdir(directory, { recursive: true })
let bytes = 0
const files = []
for (const url of urls) {
  if (new URL(url).hostname !== 'fonts.gstatic.com') throw Error('Unexpected font host')
  const asset = await fetch(url)
  if (!asset.ok) throw Error('Font: ' + asset.status)
  const data = new Uint8Array(await asset.arrayBuffer())
  if (String.fromCharCode(...data.slice(0, 4)) !== 'wOF2') throw Error('Expected WOFF2')
  const file = createHash('sha256').update(data).digest('hex').slice(0, 16) + '.woff2'
  bytes += data.length
  await writeFile(path.join(directory, file), data)
  css = css.split(url).join('./' + file)
  files.push({ url, file, bytes: data.length })
}
for (const family of ['cinzel', 'cinzeldecorative', 'cormorantgaramond', 'cormorantsc']) {
  const license = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${family}/OFL.txt`)
  if (!license.ok) throw Error('Font license: ' + license.status)
  await writeFile(path.join(directory, `${family}-OFL.txt`), (await license.text()).replace(/[ \t]+$/gm, ''))
}
await writeFile(path.join(directory, 'font.css'), `/* Pinned from ${source}\n   SIL Open Font License 1.1; see family OFL files. */\n` + css)
await writeFile(path.join(directory, 'source.json'), JSON.stringify({ source, files, bytes }, null, 2) + '\n')
console.log(JSON.stringify({ subsets: files.length, bytes }))

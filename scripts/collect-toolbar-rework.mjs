import assert from 'node:assert/strict'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const source = path.resolve('.superpowers/verification/toolbar-rework')
const target = path.resolve('docs/verification/2026-10-05-toolbar-rework')
const report = JSON.parse(await readFile(path.join(source, 'results.json'), 'utf8'))
assert.equal(report.status, 'passed')
assert.equal(Object.keys(report.phases).length, 6)
assert.ok(['', '80'].includes(new URL(report.base).port), 'Collect the production run, not the dev server')
await mkdir(target, { recursive: true })
const names = { motion: 'motion-production', refraction: 'refraction-production', photos: 'contrast-production', original: 'original-load-production', fallback: 'fallback-production', admin: 'admin-production' }
for (const [phase, name] of Object.entries(names)) {
  assert.equal(report.phases[phase].status, 'passed')
  await writeFile(path.join(target, name + '.json'), JSON.stringify({ servedModule: report.servedModule, ...report.phases[phase] }, null, 2))
}
await copyFile(path.join(source, 'results.json'), path.join(target, 'ui-production.json'))
let images = 0
for (const name of await readdir(source)) if (name.endsWith('.png')) { await copyFile(path.join(source, name), path.join(target, name)); images++ }
console.log(`PASS archived ${images} screenshots and 6 production checks (${report.servedModule})`)

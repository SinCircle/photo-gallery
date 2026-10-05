import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from '../server/node_modules/sharp/lib/index.js'

const scratch = path.resolve('.superpowers/verification')
const destination = path.resolve('docs/verification/2026-10-05-glass')
await mkdir(destination, { recursive: true })
const read = async file => JSON.parse(await readFile(path.join(scratch, file), 'utf8'))
const evidence = {
  refraction: await read('glass/results.json'),
  toolbar: await read('toolbar/results.json'),
  performance: await read('performance/results.json'),
  regression: await read('results.json'),
  administration: await read('admin-results.json'),
  development: await read('dev-without-docker-results.json'),
}
for (const record of Object.values(evidence)) assert.equal(record.status, 'passed')
evidence.adminScroll = await read('performance-admin/results.json')
assert.equal(evidence.adminScroll.status, 'measured')
const sourceHashes = {}
for (const file of ['src/utils/glass.ts', 'src/utils/glassRenderer.ts', 'src/utils/glassScene.ts', 'src/utils/idleToolbar.ts', 'src/views/photo.ts', 'src/views/admin.ts', 'src/style.css']) {
  sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
}
const reference = execFileSync('git', ['rev-parse', '68e64de^'], { encoding: 'utf8' }).trim()
for (const file of ['src/style.css', 'src/views/gallery.ts', 'src/views/photo.ts', 'index.html']) {
  assert.deepEqual(await readFile(path.join(scratch, 'reference', file)), execFileSync('git', ['show', `68e64de^:${file}`]))
}
const image = execFileSync('docker', ['inspect', '--format', '{{.Image}}', 'photogallery-gallery-1'], { encoding: 'utf8' }).trim()
const health = await (await fetch('http://127.0.0.1/api/health')).json()
assert.equal(health.status, 'ok')
const assets = {}
const html = await readFile('dist/index.html', 'utf8')
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
  const local = await readFile(path.join('dist', match[1]))
  const served = Buffer.from(await (await fetch('http://127.0.0.1' + match[1])).arrayBuffer())
  assert.deepEqual(served, local, 'Docker must serve the current compiled assets')
  assets[match[1]] = createHash('sha256').update(local).digest('hex')
}
await writeFile(path.join(destination, 'results.json'), JSON.stringify({ reference, sourceHashes, docker: { command: 'docker compose up -d --build', image, health, assets }, ...evidence }, null, 2))
const table = (summary, labels) => [
  '| 分组 | FPS 中位数 | 五轮/三轮范围 | 最大 P95 帧间隔 | 主文档长任务 ≥50 ms |',
  '|---|---:|---:|---:|---:|',
  ...Object.entries(summary).map(([name, s]) => `| ${labels[name]} | ${s.medianFPS.toFixed(3)} | ${s.minFPS.toFixed(3)}–${s.maxFPS.toFixed(3)} | ${s.maxP95FrameMs.toFixed(2)} ms | ${s.totalLongTasks} / ${s.totalLongTaskMs} ms |`),
].join('\n')
const adminDelta = (evidence.adminScroll.summary['glass-on'].medianFPS / evidence.adminScroll.summary['glass-off'].medianFPS - 1) * 100
await writeFile(path.join(destination, 'measurements.md'), `# 最终构建的量化数据\n\n单张页：实际平移矩阵变化已断言；三组各五轮、交错顺序。\n\n${table(evidence.performance.summary, { legacy: '68e64de^，无 WebGL', 'glass-off': '新版，关闭 WebGL', 'glass-on': '新版，Regular Glass' })}\n\n相对旧版 ${evidence.performance.acceptance.legacyDeltaPercent.toFixed(3)}%；相对关闭玻璃 ${evidence.performance.acceptance.glassOffDeltaPercent.toFixed(3)}%。\n\n管理页：44 张缩略图先解码，三轮实际滚动，结束后实际折射图片更新已断言。旧视觉基准没有管理实现，本表对比当前关闭玻璃的页面。\n\n${table(evidence.adminScroll.summary, { 'glass-off': '管理，关闭 WebGL', 'glass-on': '管理，Regular Glass' })}\n\n管理开启相对关闭 ${adminDelta.toFixed(3)}%。${adminDelta < 0 ? '这组滚动中位帧率仍较低，不能据此宣称管理页不降帧。' : '这组三轮滚动的中位帧率没有降低。'}\n\nGPU：${evidence.performance.graphics.renderer}。浏览器：${evidence.performance.browser}。原始每轮数据和完整方法见 [results.json](results.json)。FPS 是实际 rAF 时间戳统计的浏览器回调频率，不是物理显示器呈现频率；长任务由主文档 PerformanceObserver 记录，不声称统计了所有浏览器进程。\n`)

for (const name of ['gallery-first', 'gallery-middle', 'photo']) {
  const images = await Promise.all([`reference-${name}`, name].map(async file => {
    const { data, info } = await sharp(path.join(scratch, `${file}.png`)).resize({ width: 700 }).png().toBuffer({ resolveWithObject: true })
    return { data, info }
  }))
  await sharp({ create: { width: 1400, height: Math.max(...images.map(i => i.info.height)), channels: 3, background: '#f4f4f4' } })
    .composite(images.map((i, n) => ({ input: i.data, left: n * 700, top: 0 })))
    .jpeg({ quality: 92 }).toFile(path.join(destination, `${name}.jpg`))
}
for (const file of ['photo-expanded', 'photo-collapsed', 'admin-expanded', 'admin-collapsed']) {
  await sharp(path.join(scratch, 'toolbar', file + '.png')).resize({ width: 1000 }).jpeg({ quality: 92 }).toFile(path.join(destination, file + '.jpg'))
}
await sharp(path.join(scratch, 'admin.png')).resize({ width: 1000 }).jpeg({ quality: 92 }).toFile(path.join(destination, 'admin-authenticated.jpg'))
await sharp(path.join(scratch, 'dev-without-docker.png')).resize({ width: 1000 }).jpeg({ quality: 92 }).toFile(path.join(destination, 'dev-without-docker.jpg'))
await sharp(path.join(scratch, 'glass/photo-behind-glass.png')).resize({ width: 1000 }).jpeg({ quality: 92 }).toFile(path.join(destination, 'photo-behind-glass.jpg'))
const crop = { left: 150, top: 860, width: 1140, height: 140 }
const pair = await Promise.all(['unrefracted', 'refracted'].map(name => sharp(path.join(scratch, 'glass', name + '.png')).extract(crop).png().toBuffer()))
await sharp({ create: { width: 2280, height: 140, channels: 3, background: '#f4f4f4' } })
  .composite(pair.map((input, n) => ({ input, left: n * 1140, top: 0 })))
  .png().toFile(path.join(destination, 'refraction-comparison.png'))
const diagnostics = path.join(destination, 'performance-diagnostics')
await mkdir(diagnostics, { recursive: true })
for (const name of await readdir(path.join(scratch, 'performance'))) {
  if (name.endsWith('.json') && name !== 'results.json') await copyFile(path.join(scratch, 'performance', name), path.join(diagnostics, name))
}
console.log('PASS evidence: actual refraction comparison, toolbar states, three legacy comparisons, management and quantitative results archived')

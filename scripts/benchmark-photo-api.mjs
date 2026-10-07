import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import express from '../server/node_modules/express/index.js'
import { photosRouter } from '../server/src/routes/photos.js'

const require = createRequire(new URL('../server/package.json', import.meta.url))
const baseline = process.env.PERF_BASE_REF || '80b6ddd'
const source = execFileSync('git', ['show', `${baseline}:server/src/routes/photos.js`], { encoding: 'utf8' })
  .replace("'express'", JSON.stringify(pathToFileURL(require.resolve('express')).href))
  .replace("'../photos/store.js'", JSON.stringify(new URL('../server/src/photos/store.js', import.meta.url).href))
const old = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const temporary = await mkdtemp(path.join(os.tmpdir(), 'gallery-api-benchmark-'))
const report = { baseline, method: 'Isolated synthetic indexes; sequential localhost HTTP requests, cold first request and 15 subsequent requests. No production data changes.', cases: [] }
try {
  for (const count of [44, 10000]) {
    const photos = Array.from({ length: count }, (_, i) => ({ id: `IMG_${(i * 7919) % count}.jpg`, takenAt: i % 3 ? null : '2026-10-01T00:00:00Z', width: 6000, height: 4000, title: '', description: '', exif: [], derived: { thumb: true, web: true } }))
    const indexPath = path.join(temporary, 'index.json')
    await writeFile(indexPath, JSON.stringify({ version: 1, photos }))
    let expected
    for (const [name, router] of [['before', old.photosRouter], ['after', photosRouter]]) {
      const server = express().use('/api', router({ indexPath })).listen(0, '127.0.0.1')
      await new Promise(resolve => server.once('listening', resolve))
      const url = `http://127.0.0.1:${server.address().port}/api/photos`
      try {
        const samples = []
        let etag
        for (let i = 0; i < 16; i++) {
          const t = performance.now(), response = await fetch(url), body = await response.text()
          samples.push(performance.now() - t)
          assert.equal(response.status, 200)
          const hash = createHash('sha256').update(body).digest('hex')
          expected ??= hash
          assert.equal(hash, expected, 'Optimization must preserve the entire response and ordering')
          etag = response.headers.get('etag')
        }
        const revalidated = await fetch(url, { cache: 'no-cache', headers: { 'If-None-Match': etag } })
        assert.equal(revalidated.status, 304)
        const cold = samples.shift(), ordered = samples.toSorted((a, b) => a - b)
        report.cases.push({ count, name, cold, median: ordered[7], p95: ordered.at(-1), revalidated: revalidated.status, samples })
      } finally { await new Promise(resolve => server.close(resolve)) }
    }
  }
  await mkdir('docs/verification/2026-10-07-performance', { recursive: true })
  await writeFile('docs/verification/2026-10-07-performance/api.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.cases.map(({ samples, ...result }) => result)))
} finally {
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gallery-api-benchmark-'))
  await rm(temporary, { recursive: true, force: true })
}

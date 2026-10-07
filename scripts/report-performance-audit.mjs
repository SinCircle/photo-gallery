import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const input = process.env.PERF_NAME || 'performance-20261007-release-abba'
const audit = JSON.parse(await readFile(`.superpowers/verification/${input}/results.json`, 'utf8'))
assert.equal(audit.status, 'measured')
assert.deepEqual(audit.errors, [])
const runs = audit.runs.map(r => ({ base: r.base, repeat: r.repeat, mobile: r.mobile,
  cold: { fcp: r.cold.fcp, lcp: r.cold.lcp, ready: r.cold.ready, cls: r.cold.cls,
    transferBytes: r.cold.resources.reduce((sum, item) => sum + item.bytes, 0),
    thirdPartyRequests: r.cold.resources.filter(item => new URL(item.url).origin !== new URL(r.base).origin).length },
  phases: r.phases, idle: r.idle,
  warm: { ready: r.warm.ready, fcp: r.warm.fcp, bytes: r.warm.bytes },
}))
const mean = numbers => numbers.reduce((a, b) => a + b, 0) / numbers.length
const summary = []
for (const mobile of [false, true]) {
  const before = runs.filter(r => r.base.endsWith(':5196') && r.mobile === mobile)
  const after = runs.filter(r => r.base.endsWith(':5187') && r.mobile === mobile)
  assert.equal(before.length, 2); assert.equal(after.length, 2)
  const metrics = { fcp: r => r.cold.fcp, lcp: r => r.cold.lcp, warm: r => r.warm.ready }
  for (const phase of Object.keys(before[0].phases)) {
    metrics[phase + 'CPU'] = r => r.phases[phase].cpu.TaskDuration
    metrics[phase + 'Style'] = r => r.phases[phase].cpu.RecalcStyleDuration
    metrics[phase + 'LongTasks'] = r => r.phases[phase].longTasks.total
    metrics[phase + 'FrameP95'] = r => r.phases[phase].frames.p95
  }
  summary.push({ mobile, metrics: Object.fromEntries(Object.entries(metrics).map(([key, get]) => {
    const a = before.map(get), z = after.map(get), old = mean(a), current = mean(z)
    return [key, { before: old, after: current, reductionPercent: old ? 100 * (1 - current / old) : null, beforeSamples: a, afterSamples: z }]
  })) })
}
const bundles = []
for (const directory of ['.superpowers/performance-2026-10-07/baseline-80b6ddd', 'dist']) {
  const html = await readFile(directory + '/index.html', 'utf8')
  const source = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1]
  const bytes = await readFile(directory + source)
  bundles.push({ directory, source, bytes: bytes.length, gzip: gzipSync(bytes).length })
}
const output = 'docs/verification/2026-10-07-performance'
await mkdir(output, { recursive: true })
await writeFile(output + '/browser.json', JSON.stringify({ method: audit.method, browser: audit.browser, graphics: audit.graphics,
  baseline: '80b6ddd', order: 'A desktop/mobile, B desktop/mobile, B desktop/mobile, A desktop/mobile', bundles, summary, runs }, null, 2) + '\n')
console.log(JSON.stringify({ bundles, summary }))

import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { browserSession, sleep } from './browser-session.mjs'

const b = await browserSession('performance-sweep/routes', 9374)
const base = process.env.VERIFY_URL || 'http://127.0.0.1:5187'
const report = { errors: b.errors }
let held
b.on('Fetch.requestPaused', event => { held = event.requestId })
try {
  await b.navigate(base + '/?route-split#/')
  await b.until(`document.querySelectorAll('.tile').length===44`)
  report.initial = await b.evaluate(`performance.getEntriesByType('resource').map(r=>r.name)`)
  assert.ok(!report.initial.some(url => /\/assets\/admin-/.test(url)), 'Gallery must not request admin JS or CSS')
  assert.ok(report.initial.every(url => new URL(url).origin === new URL(base).origin), 'Fonts must load from this origin')
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/assets/admin-*.js', requestStage: 'Request' }] })
  await b.evaluate(`location.hash='#/admin'`)
  for (let i = 0; i < 50 && !held; i++) await sleep(100)
  assert.ok(held, 'Admin code must load on demand')
  await b.evaluate(`location.hash='#/'`)
  await b.until(`document.querySelectorAll('.tile').length===44`)
  await b.send('Fetch.continueRequest', { requestId: held })
  await b.send('Fetch.disable')
  await sleep(350)
  assert.equal(await b.evaluate(`document.querySelectorAll('.tile').length===44&&!document.querySelector('.adminShell')`), true)
  await b.evaluate(`location.hash='#/admin'`)
  await b.until(`!!document.querySelector('input[type=password]')`)
  report.loaded = await b.evaluate(`performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/admin-')).map(r=>r.name)`)
  assert.ok(report.loaded.some(url => url.endsWith('.js')) && report.loaded.some(url => url.endsWith('.css')))
  assert.deepEqual(b.errors, [])
  report.status = 'passed'
  console.log('PASS deferred admin JS/CSS, cancelled navigation, later login render, local fonts')
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error) }
finally { await writeFile(b.out + '/results.json', JSON.stringify(report, null, 2)); b.close() }

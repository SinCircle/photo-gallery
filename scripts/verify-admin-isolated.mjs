import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import express from '../server/node_modules/express/index.js'
import { createApp } from '../server/src/index.js'
import { loadConfig } from '../server/src/config.js'

const parent = path.resolve('.superpowers/verification')
await mkdir(parent, { recursive: true })
const library = await mkdtemp(path.join(parent, 'admin-library-'))
const cfg = loadConfig({ PHOTOS_DIR: library, ADMIN_PASSWORD_HASH: createHash('sha256').update('gallery-verification-only').digest('hex') })
const app = createApp(cfg)
app.use('/media', express.static(library))
app.use(express.static(path.resolve('dist')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
try {
  const child = spawn(process.execPath, ['scripts/verify-admin.mjs'], { windowsHide: true, stdio: 'inherit', env: {
    ...process.env, VERIFY_ADMIN_URL: `http://127.0.0.1:${server.address().port}`, VERIFY_PHOTOS_DIR: library,
  } })
  assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) }), 0)
} finally {
  await new Promise(resolve => server.close(resolve))
  assert.ok(path.resolve(library).startsWith(parent + path.sep + 'admin-library-'))
  await rm(library, { recursive: true, force: true })
}

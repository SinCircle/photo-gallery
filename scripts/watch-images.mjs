import { watch } from 'node:fs'
import path from 'node:path'
import { syncImages } from './sync-images.mjs'

const root = process.cwd()
const sourceDir = path.join(root, 'images')

let timer = null
let running = false
let queued = false

async function runSync() {
  if (running) {
    queued = true
    return
  }

  running = true
  try {
    await syncImages()
    // Keep logs minimal; this is a long-running watcher.
    console.log('[images] synced')
  } catch (err) {
    console.error('[images] sync failed', err)
  } finally {
    running = false
    if (queued) {
      queued = false
      await runSync()
    }
  }
}

function scheduleSync() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runSync()
  }, 220)
}

// Initial sync
await runSync()

// Watch for changes; recursive watch works on Windows/macOS.
watch(sourceDir, { recursive: true }, () => {
  scheduleSync()
})

// Keep process alive.
process.stdin.resume()

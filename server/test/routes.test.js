import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/index.js'
import { writeIndex } from '../src/photos/store.js'

let photosDir
let cfg
let server
let baseUrl

beforeEach(async () => {
  photosDir = await fs.mkdtemp(path.join(os.tmpdir(), 'routes-'))
  cfg = {
    photosDir,
    originalsDir: path.join(photosDir, 'originals'),
    thumbsDir: path.join(photosDir, 'thumbs'),
    webDir: path.join(photosDir, 'web'),
    indexPath: path.join(photosDir, 'index.json'),
    adminPasswordHash: 'unused-in-this-task',
  }
  const app = createApp(cfg)
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  await new Promise((r) => server.close(r))
  await fs.rm(photosDir, { recursive: true, force: true })
})

describe('GET /api/health', () => {
  it('返回 ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})

describe('GET /api/photos', () => {
  it('索引为空时返回空数组', async () => {
    const res = await fetch(`${baseUrl}/api/photos`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ photos: [] })
  })

  it('按拍摄时间倒序返回', async () => {
    await writeIndex(cfg.indexPath, {
      version: 1,
      photos: [
        { id: 'old.jpg', takenAt: '2020-01-01T00:00:00.000Z' },
        { id: 'new.jpg', takenAt: '2026-01-01T00:00:00.000Z' },
        { id: 'mid.jpg', takenAt: '2023-01-01T00:00:00.000Z' },
      ],
    })
    const res = await fetch(`${baseUrl}/api/photos`)
    const body = await res.json()
    expect(body.photos.map((p) => p.id)).toEqual(['new.jpg', 'mid.jpg', 'old.jpg'])
  })

  it('缺失拍摄时间的排在最后，按文件名倒序', async () => {
    await writeIndex(cfg.indexPath, {
      version: 1,
      photos: [
        { id: 'a.jpg', takenAt: null },
        { id: 'c.jpg', takenAt: null },
        { id: 'with-date.jpg', takenAt: '2026-01-01T00:00:00.000Z' },
        { id: 'b.jpg', takenAt: null },
      ],
    })
    const res = await fetch(`${baseUrl}/api/photos`)
    const body = await res.json()
    expect(body.photos.map((p) => p.id)).toEqual(['with-date.jpg', 'c.jpg', 'b.jpg', 'a.jpg'])
  })

  it('索引损坏时返回 500 而非空列表', async () => {
    await fs.writeFile(cfg.indexPath, '{ broken')
    const res = await fetch(`${baseUrl}/api/photos`)
    expect(res.status).toBe(500)
  })
})

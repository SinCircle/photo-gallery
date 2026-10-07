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

  it('未修改的索引支持 304，原子替换后立即返回新内容', async () => {
    await writeIndex(cfg.indexPath, { photos: [{ id: 'IMG_2.jpg' }, { id: 'IMG_10.jpg' }] })
    const first = await fetch(`${baseUrl}/api/photos`)
    const etag = first.headers.get('etag')
    expect(first.headers.get('cache-control')).toBe('no-cache')
    expect((await first.json()).photos.map(p => p.id)).toEqual(['IMG_10.jpg', 'IMG_2.jpg'])
    const unchanged = await fetch(`${baseUrl}/api/photos`, { cache: 'no-cache', headers: { 'If-None-Match': etag } })
    expect(unchanged.status).toBe(304)
    await writeIndex(cfg.indexPath, { photos: [{ id: 'changed.jpg' }] })
    const changed = await fetch(`${baseUrl}/api/photos`, { cache: 'no-cache', headers: { 'If-None-Match': etag } })
    expect(changed.status).toBe(200)
    expect((await changed.json()).photos).toEqual([{ id: 'changed.jpg' }])
  })

  it('缓存后外部同长度改写、损坏、删除和重建都可见', async () => {
    const raw = JSON.stringify({ photos: [{ id: 'a.jpg' }] })
    await fs.writeFile(cfg.indexPath, raw)
    await fetch(`${baseUrl}/api/photos`)
    await fs.writeFile(cfg.indexPath, raw.replace('a.jpg', 'b.jpg'))
    expect((await (await fetch(`${baseUrl}/api/photos`)).json()).photos[0].id).toBe('b.jpg')
    await fs.writeFile(cfg.indexPath, '{ broken')
    expect((await fetch(`${baseUrl}/api/photos`)).status).toBe(500)
    await fs.rm(cfg.indexPath)
    expect(await (await fetch(`${baseUrl}/api/photos`)).json()).toEqual({ photos: [] })
    await writeIndex(cfg.indexPath, { photos: [{ id: 'restored.jpg' }] })
    expect((await (await fetch(`${baseUrl}/api/photos`)).json()).photos[0].id).toBe('restored.jpg')
  })
})

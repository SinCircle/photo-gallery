import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readIndex, writeIndex, upsertPhoto, removePhoto } from '../src/photos/store.js'

let dir
let indexPath

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'))
  indexPath = path.join(dir, 'index.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('readIndex', () => {
  it('文件不存在时返回空索引', async () => {
    const idx = await readIndex(indexPath)
    expect(idx).toEqual({ version: 1, updatedAt: null, photos: [] })
  })

  it('文件损坏时抛错，不静默返回空索引', async () => {
    await fs.writeFile(indexPath, '{ this is not json')
    await expect(readIndex(indexPath)).rejects.toThrow()
  })
})

describe('writeIndex', () => {
  it('写入后可读回', async () => {
    const idx = { version: 1, updatedAt: null, photos: [{ id: 'a.jpg' }] }
    await writeIndex(indexPath, idx)
    const back = await readIndex(indexPath)
    expect(back.photos).toHaveLength(1)
    expect(back.photos[0].id).toBe('a.jpg')
  })

  it('写入会更新 updatedAt', async () => {
    const idx = { version: 1, updatedAt: null, photos: [] }
    await writeIndex(indexPath, idx)
    const back = await readIndex(indexPath)
    expect(back.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('不留下临时文件', async () => {
    await writeIndex(indexPath, { version: 1, photos: [] })
    const entries = await fs.readdir(dir)
    expect(entries.filter((f) => f.includes('tmp'))).toHaveLength(0)
  })

  it('写入中途失败时原文件保持完好', async () => {
    await writeIndex(indexPath, { version: 1, photos: [{ id: 'original.jpg' }] })
    const bad = { version: 1, photos: [] }
    // 用一个不可序列化的值触发 JSON.stringify 失败
    bad.photos.push({ id: 'x', circular: (() => { const o = {}; o.self = o; return o })() })
    await expect(writeIndex(indexPath, bad)).rejects.toThrow()
    const back = await readIndex(indexPath)
    expect(back.photos[0].id).toBe('original.jpg')
  })
})

describe('upsertPhoto', () => {
  it('新增照片', async () => {
    await upsertPhoto(indexPath, { id: 'a.jpg', width: 100 })
    const idx = await readIndex(indexPath)
    expect(idx.photos).toHaveLength(1)
  })

  it('同 id 覆盖而不重复', async () => {
    await upsertPhoto(indexPath, { id: 'a.jpg', width: 100 })
    await upsertPhoto(indexPath, { id: 'a.jpg', width: 200 })
    const idx = await readIndex(indexPath)
    expect(idx.photos).toHaveLength(1)
    expect(idx.photos[0].width).toBe(200)
  })

  it('保留其它记录', async () => {
    await upsertPhoto(indexPath, { id: 'a.jpg' })
    await upsertPhoto(indexPath, { id: 'b.jpg' })
    const idx = await readIndex(indexPath)
    expect(idx.photos.map((p) => p.id).sort()).toEqual(['a.jpg', 'b.jpg'])
  })
})

describe('removePhoto', () => {
  it('按 id 删除', async () => {
    await upsertPhoto(indexPath, { id: 'a.jpg' })
    await upsertPhoto(indexPath, { id: 'b.jpg' })
    await removePhoto(indexPath, 'a.jpg')
    const idx = await readIndex(indexPath)
    expect(idx.photos.map((p) => p.id)).toEqual(['b.jpg'])
  })

  it('删除不存在的 id 不报错', async () => {
    await expect(removePhoto(indexPath, 'nope.jpg')).resolves.not.toThrow()
  })
})

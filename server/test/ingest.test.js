import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { ingestFile } from '../src/photos/ingest.js'
import { readIndex } from '../src/photos/store.js'

let photosDir
let cfg
let counter = 0

beforeEach(async () => {
  photosDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-'))
  cfg = {
    photosDir,
    originalsDir: path.join(photosDir, 'originals'),
    thumbsDir: path.join(photosDir, 'thumbs'),
    webDir: path.join(photosDir, 'web'),
    indexPath: path.join(photosDir, 'index.json'),
  }
  await fs.mkdir(cfg.originalsDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(photosDir, { recursive: true, force: true })
})

async function writeSource(sidePx = 800) {
  const p = path.join(cfg.originalsDir, `src-${counter++}.jpg`)
  const buf = await sharp({
    create: {
      width: sidePx,
      height: Math.round(sidePx * 1.5),
      channels: 3,
      background: { r: 100, g: 120, b: 140 },
    },
  }).jpeg().toBuffer()
  await fs.writeFile(p, buf)
  return p
}

describe('ingestFile', () => {
  it('生成 720 与 1920 两档衍生图', async () => {
    const src = await writeSource(800)
    const id = 'photo1.jpg'
    const record = await ingestFile(cfg, { sourcePath: src, id })

    const thumb = await fs.stat(path.join(cfg.thumbsDir, id))
    const web = await fs.stat(path.join(cfg.webDir, id))
    expect(thumb.size).toBeGreaterThan(0)
    expect(web.size).toBeGreaterThan(0)
    expect(await fs.readdir(cfg.thumbsDir)).toEqual([id])
    expect(await fs.readdir(cfg.webDir)).toEqual([id])

    expect(record.derived).toEqual({ thumb: true, web: true })
  })

  it('缩略图不超过 720px，网页图不超过 1920px', async () => {
    const src = await writeSource(3000)
    const id = 'big.jpg'
    await ingestFile(cfg, { sourcePath: src, id })

    const thumbMeta = await sharp(path.join(cfg.thumbsDir, id)).metadata()
    const webMeta = await sharp(path.join(cfg.webDir, id)).metadata()
    expect(Math.max(thumbMeta.width, thumbMeta.height)).toBeLessThanOrEqual(720)
    expect(Math.max(webMeta.width, webMeta.height)).toBeLessThanOrEqual(1920)
  })

  it('小图不被放大', async () => {
    const src = await writeSource(300)
    const id = 'small.jpg'
    await ingestFile(cfg, { sourcePath: src, id })

    const thumbMeta = await sharp(path.join(cfg.thumbsDir, id)).metadata()
    expect(thumbMeta.width).toBe(300)
  })

  it('把记录写进索引', async () => {
    const src = await writeSource(800)
    const id = 'indexed.jpg'
    await ingestFile(cfg, { sourcePath: src, id })

    const index = await readIndex(cfg.indexPath)
    expect(index.photos).toHaveLength(1)
    expect(index.photos[0].id).toBe(id)
    expect(index.photos[0].width).toBe(800)
    expect(index.photos[0].height).toBe(1200)
  })

  it('原图移动到 originals 下的目标文件名', async () => {
    const src = await writeSource(800)
    const id = 'moved.jpg'
    await ingestFile(cfg, { sourcePath: src, id })

    const stat = await fs.stat(path.join(cfg.originalsDir, id))
    expect(stat.size).toBeGreaterThan(0)
  })

  it('标题与描述初始为空字符串', async () => {
    const src = await writeSource(800)
    const record = await ingestFile(cfg, { sourcePath: src, id: 'blank.jpg' })
    expect(record.title).toBe('')
    expect(record.description).toBe('')
  })
})

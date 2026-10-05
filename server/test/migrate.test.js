import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { migrateDirectory } from '../scripts/migrate.js'
import { readIndex } from '../src/photos/store.js'

let root
let sourceDir
let cfg
let counter = 0

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-'))
  sourceDir = path.join(root, 'images')
  await fs.mkdir(sourceDir, { recursive: true })

  const photosDir = path.join(root, 'library')
  cfg = {
    photosDir,
    originalsDir: path.join(photosDir, 'originals'),
    thumbsDir: path.join(photosDir, 'thumbs'),
    webDir: path.join(photosDir, 'web'),
    indexPath: path.join(photosDir, 'index.json'),
  }
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function addSource(name, sidePx = 400) {
  const buf = await sharp({
    create: {
      width: sidePx,
      height: sidePx,
      channels: 3,
      background: { r: 90, g: 90, b: 90 },
    },
  }).jpeg().toBuffer()
  await fs.writeFile(path.join(sourceDir, name), buf)
}

describe('migrateDirectory', () => {
  it('导入所有图片', async () => {
    await addSource('a.jpg')
    await addSource('b.jpg')
    const result = await migrateDirectory(cfg, sourceDir)
    expect(result.imported).toHaveLength(2)
    const index = await readIndex(cfg.indexPath)
    expect(index.photos).toHaveLength(2)
  })

  it('为每张图生成衍生图', async () => {
    await addSource('a.jpg')
    await migrateDirectory(cfg, sourceDir)
    await fs.access(path.join(cfg.thumbsDir, 'a.jpg'))
    await fs.access(path.join(cfg.webDir, 'a.jpg'))
  })

  it('重复运行不产生重复条目', async () => {
    await addSource('a.jpg')
    await migrateDirectory(cfg, sourceDir)
    const second = await migrateDirectory(cfg, sourceDir)
    expect(second.imported).toHaveLength(0)
    expect(second.skipped).toHaveLength(1)
    const index = await readIndex(cfg.indexPath)
    expect(index.photos).toHaveLength(1)
  })

  it('跳过不支持的文件类型', async () => {
    await addSource('a.jpg')
    await fs.writeFile(path.join(sourceDir, 'notes.txt'), 'hello')
    const result = await migrateDirectory(cfg, sourceDir)
    expect(result.imported).toHaveLength(1)
  })

  it('单张失败不中断整批', async () => {
    await addSource('good.jpg')
    await fs.writeFile(path.join(sourceDir, 'broken.jpg'), 'not an image')
    const result = await migrateDirectory(cfg, sourceDir)
    expect(result.imported).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].id).toBe('broken.jpg')
  })

  it('源目录不存在时返回空结果而非抛错', async () => {
    const result = await migrateDirectory(cfg, path.join(root, 'nope'))
    expect(result.imported).toEqual([])
    expect(result.failed).toEqual([])
  })
})

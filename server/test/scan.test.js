import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listImageFiles, reconcile } from '../src/photos/scan.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function touch(name) {
  await fs.writeFile(path.join(dir, name), 'x')
}

describe('listImageFiles', () => {
  it('只返回允许的扩展名', async () => {
    await touch('a.jpg')
    await touch('b.JPEG')
    await touch('c.png')
    await touch('d.txt')
    await touch('e.heic')
    const files = await listImageFiles(dir)
    expect(files.sort()).toEqual(['a.jpg', 'b.JPEG', 'c.png'])
  })

  it('目录不存在时返回空数组', async () => {
    const files = await listImageFiles(path.join(dir, 'nope'))
    expect(files).toEqual([])
  })

  it('结果已排序', async () => {
    await touch('c.jpg')
    await touch('a.jpg')
    await touch('b.jpg')
    const files = await listImageFiles(dir)
    expect(files).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })
})

describe('reconcile', () => {
  it('找出磁盘上有但索引里没有的', () => {
    const onDisk = ['a.jpg', 'b.jpg', 'c.jpg']
    const indexed = ['a.jpg']
    const result = reconcile(onDisk, indexed)
    expect(result.missingFromIndex.sort()).toEqual(['b.jpg', 'c.jpg'])
  })

  it('找出索引里有但磁盘上已删除的', () => {
    const onDisk = ['a.jpg']
    const indexed = ['a.jpg', 'b.jpg']
    const result = reconcile(onDisk, indexed)
    expect(result.missingFromDisk).toEqual(['b.jpg'])
  })

  it('两边一致时两个列表都为空', () => {
    const result = reconcile(['a.jpg'], ['a.jpg'])
    expect(result.missingFromIndex).toEqual([])
    expect(result.missingFromDisk).toEqual([])
  })

  it('找出衍生物缺失的条目', () => {
    const onDisk = ['a.jpg', 'b.jpg']
    const indexed = ['a.jpg', 'b.jpg']
    const hasThumb = (id) => id === 'a.jpg'
    const hasWeb = (id) => false
    const result = reconcile(onDisk, indexed, { hasThumb, hasWeb })
    expect(result.missingThumb).toEqual(['b.jpg'])
    expect(result.missingWeb.sort()).toEqual(['a.jpg', 'b.jpg'])
  })
})

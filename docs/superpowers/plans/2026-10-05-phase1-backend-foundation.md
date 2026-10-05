# 第一期：后端地基 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个可持续运行的 Node 后端，能索引宿主机目录中的照片、生成衍生图、通过 HTTP 提供列表接口，并能在 Docker 容器中与 Nginx 一同运行。

**Architecture:** 单容器双进程。Nginx 直接发送静态文件与图片，Node 只处理 `/api/`。照片存放在宿主机的挂载目录中，不由镜像承载。索引是单个 `index.json` 文件，采用原子写入（临时文件 + rename）。

**Tech Stack:** Node 24、Express 5、sharp、exifr、vitest、Docker

**前置说明：** 本计划只覆盖第一期。第二期（管理端）和第三期（展示端重构）在本期完成、接口稳定后另行编写，以免接口未定就先写下游计划。

---

## 文件结构

```
server/
  src/
    index.js              ← 进程入口：装配 Express、挂载路由、启动监听
    config.js             ← 环境变量读取与校验，导出配置对象
    photos/
      store.js            ← index.json 的读写；原子写入；查询
      scan.js             ← 扫描 originals/ 目录，与索引比对
      ingest.js           ← 单张照片的完整摄取流程（衍生图 + 元数据）
      metadata.js         ← 用 exifr 提取拍摄时间与 EXIF 字段
    routes/
      photos.js           ← GET /api/photos
      health.js           ← GET /api/health
  test/
    store.test.js
    metadata.test.js
    ingest.test.js
    scan.test.js
    routes.test.js
  package.json
  vitest.config.js
nginx/
  nginx.conf              ← 容器内 Nginx 配置
Dockerfile                ← 改为双进程镜像
docker-compose.yml        ← 本地与部署用的编排定义
.env.example              ← 环境变量样例（不含真实密码）
```

**职责边界：**

- `config.js` 是唯一读取 `process.env` 的地方，其余模块从它导入。
- `store.js` 是唯一接触 `index.json` 的地方，其余模块通过它读写索引。
- `ingest.js` 编排：调用 `metadata.js` 取元数据、调用 sharp 生成衍生图、调用 `store.js` 落索引。它自己不实现这些细节。
- 路由层只做参数校验和调用，不含业务逻辑。

---

## Task 1：搭建 server 包与测试设施

**Files:**
- Create: `server/package.json`
- Create: `server/vitest.config.js`
- Create: `server/src/config.js`
- Test: `server/test/config.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `server/test/config.test.js`：

```js
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('给定时返回照片根目录与端口', () => {
    const cfg = loadConfig({
      PHOTOS_DIR: '/data/photos',
      PORT: '8080',
      ADMIN_PASSWORD_HASH: 'x',
    })
    expect(cfg.photosDir).toBe('/data/photos')
    expect(cfg.port).toBe(8080)
  })

  it('PORT 缺失时默认 3000', () => {
    const cfg = loadConfig({ PHOTOS_DIR: '/data/photos', ADMIN_PASSWORD_HASH: 'x' })
    expect(cfg.port).toBe(3000)
  })

  it('PHOTOS_DIR 缺失时抛错', () => {
    expect(() => loadConfig({ ADMIN_PASSWORD_HASH: 'x' })).toThrow(/PHOTOS_DIR/)
  })

  it('ADMIN_PASSWORD_HASH 缺失时抛错', () => {
    expect(() => loadConfig({ PHOTOS_DIR: '/data/photos' })).toThrow(/ADMIN_PASSWORD_HASH/)
  })

  it('导出衍生图目录路径', () => {
    const cfg = loadConfig({ PHOTOS_DIR: '/data/photos', ADMIN_PASSWORD_HASH: 'x' })
    expect(cfg.originalsDir).toBe('/data/photos/originals')
    expect(cfg.thumbsDir).toBe('/data/photos/thumbs')
    expect(cfg.webDir).toBe('/data/photos/web')
    expect(cfg.indexPath).toBe('/data/photos/index.json')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run test/config.test.js`
Expected: FAIL — 找不到模块 `../src/config.js`

- [ ] **Step 3: 创建 `server/package.json`**

```json
{
  "name": "photo-gallery-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^5.1.0",
    "exifr": "^7.1.3",
    "sharp": "^0.34.1"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: 创建 `server/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
})
```

- [ ] **Step 5: 实现 `server/src/config.js`**

```js
import path from 'node:path'

/**
 * 拼接照片库内的子路径。
 * 这些路径会原样出现在 URL 中（/media/originals/...），必须始终使用正斜杠，
 * 不能用 path.join——它在 Windows 上会产生反斜杠，导致 URL 与磁盘路径不一致。
 */
function joinUrlPath(base, ...segments) {
  return [base.replace(/[\\/]+$/, ''), ...segments].join('/')
}

/**
 * 从环境变量读取配置。这是全项目唯一读取 process.env 的地方。
 * 传入 env 参数以便测试，默认取 process.env。
 */
export function loadConfig(env = process.env) {
  const photosDir = env.PHOTOS_DIR
  if (!photosDir) {
    throw new Error('缺少必需的环境变量 PHOTOS_DIR')
  }

  const adminPasswordHash = env.ADMIN_PASSWORD_HASH
  if (!adminPasswordHash) {
    throw new Error('缺少必需的环境变量 ADMIN_PASSWORD_HASH')
  }

  const port = env.PORT ? Number.parseInt(env.PORT, 10) : 3000
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT 不是合法端口号：${env.PORT}`)
  }

  return {
    photosDir,
    originalsDir: joinUrlPath(photosDir, 'originals'),
    thumbsDir: joinUrlPath(photosDir, 'thumbs'),
    webDir: joinUrlPath(photosDir, 'web'),
    indexPath: joinUrlPath(photosDir, 'index.json'),
    adminPasswordHash,
    port,
  }
}
```

- [ ] **Step 6: 安装依赖并运行测试**

Run: `cd server && npm install && npx vitest run test/config.test.js`
Expected: PASS — 5 个测试全部通过

- [ ] **Step 7: 提交**

```bash
git add server/
git commit -m "feat(server): scaffold package and config loading"
```

---

## Task 2：实现索引存储（含原子写入）

**Files:**
- Create: `server/src/photos/store.js`
- Test: `server/test/store.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `server/test/store.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run test/store.test.js`
Expected: FAIL — 找不到模块 `../src/photos/store.js`

- [ ] **Step 3: 实现 `server/src/photos/store.js`**

```js
import fs from 'node:fs/promises'
import path from 'node:path'

const EMPTY_INDEX = () => ({ version: 1, updatedAt: null, photos: [] })

/**
 * 读取索引。文件不存在返回空索引；文件损坏则抛错。
 * 损坏时必须抛错而非静默返回空索引——否则一次 parse 失败会让整个
 * 照片库看起来像空的，并把空索引写回去覆盖掉真实数据。
 */
export async function readIndex(indexPath) {
  let raw
  try {
    raw = await fs.readFile(indexPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY_INDEX()
    throw err
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`索引文件损坏，无法解析：${indexPath}（${err.message}）`)
  }

  if (!parsed || !Array.isArray(parsed.photos)) {
    throw new Error(`索引文件结构不合法：${indexPath}`)
  }

  return {
    version: parsed.version ?? 1,
    updatedAt: parsed.updatedAt ?? null,
    photos: parsed.photos,
  }
}

/**
 * 原子写入索引：先写同目录下的临时文件，再 rename 覆盖。
 * rename 在同一文件系统内是原子操作，因此读方永远不会看到半个文件。
 * 先做序列化再写盘，保证 JSON 非法时不会破坏已有文件。
 */
export async function writeIndex(indexPath, index) {
  const next = {
    version: index.version ?? 1,
    updatedAt: new Date().toISOString(),
    photos: index.photos ?? [],
  }

  // 序列化放在写入之前：若数据无法序列化，此处抛出，磁盘上的旧文件不受影响。
  const payload = JSON.stringify(next, null, 2)

  await fs.mkdir(path.dirname(indexPath), { recursive: true })
  const tmpPath = `${indexPath}.tmp`
  await fs.writeFile(tmpPath, payload, 'utf8')

  try {
    await fs.rename(tmpPath, indexPath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true })
    throw err
  }

  return next
}

/** 按 id 新增或覆盖一条记录，返回写入后的记录。 */
export async function upsertPhoto(indexPath, photo) {
  return withLock(indexPath, async () => {
    const index = await readIndex(indexPath)
    const photos = index.photos.filter((p) => p.id !== photo.id)
    photos.push(photo)
    await writeIndex(indexPath, { ...index, photos })
    return photo
  })
}

/** 按 id 删除一条记录。id 不存在时静默成功。 */
export async function removePhoto(indexPath, id) {
  return withLock(indexPath, async () => {
    const index = await readIndex(indexPath)
    const photos = index.photos.filter((p) => p.id !== id)
    if (photos.length === index.photos.length) return false
    await writeIndex(indexPath, { ...index, photos })
    return true
  })
}
```

- [ ] **Step 4: 补上并发串行化**

**背景：** 上面的 `withLock` 是必需的，不是可选项。多个 `upsertPhoto` 并发执行时，
它们各自读出同一份索引、各自写入，后写的会覆盖先写的——丢更新。
更严重的是所有写入共用同一个 `.tmp` 文件名，并发时会互相 rename/删除，直接抛 `ENOENT` 崩溃。

实测复现（20 个并发 upsert）：

```
Error: ENOENT: no such file or directory, rename '...\index.json.tmp' -> '...\index.json'
```

在 `server/src/photos/store.js` 末尾追加：

```js
/**
 * 把针对同一个索引文件的写操作串行化。
 *
 * 为什么必需：index.json 是「整个文件读-改-写」。两个写操作并发时，
 * 后一个会基于旧快照覆盖前一个的结果，造成丢更新；且它们共用同一个
 * .tmp 文件名，互相 rename/删除会直接抛 ENOENT。
 *
 * 实现：按索引路径维护一条 Promise 链，新的写操作排在链尾。
 * 用链而不是锁标志，是为了保证同一次操作抛错不会卡死后续操作。
 */
const writeChains = new Map()

function withLock(indexPath, fn) {
  const prev = writeChains.get(indexPath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // 无论成功失败都让链条继续，错误由调用方通过 next 感知。
  writeChains.set(
    indexPath,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}
```

- [ ] **Step 5: 写并发测试**

在 `server/test/store.test.js` 末尾追加：

```js
describe('并发写入', () => {
  it('20 个并发 upsert 全部保留，一条不丢', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => upsertPhoto(indexPath, { id: `p${i}.jpg` })),
    )
    const idx = await readIndex(indexPath)
    expect(idx.photos).toHaveLength(20)
  })

  it('并发 upsert 同一 id 只留一条', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => upsertPhoto(indexPath, { id: 'same.jpg', n: i })),
    )
    const idx = await readIndex(indexPath)
    expect(idx.photos).toHaveLength(1)
  })

  it('并发的 upsert 与 remove 不互相破坏', async () => {
    await upsertPhoto(indexPath, { id: 'keep.jpg' })
    await Promise.all([
      removePhoto(indexPath, 'keep.jpg'),
      upsertPhoto(indexPath, { id: 'new.jpg' }),
    ])
    const idx = await readIndex(indexPath)
    expect(idx.photos.map((p) => p.id)).toEqual(['new.jpg'])
  })

  it('链条中的失败不影响后续写入', async () => {
    await upsertPhoto(indexPath, { id: 'a.jpg' })
    const circular = {}
    circular.self = circular
    const failed = upsertPhoto(indexPath, { id: 'bad.jpg', circular })
    await expect(failed).rejects.toThrow()
    await upsertPhoto(indexPath, { id: 'b.jpg' })
    const idx = await readIndex(indexPath)
    expect(idx.photos.map((p) => p.id).sort()).toEqual(['a.jpg', 'b.jpg'])
  })
})
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cd server && npx vitest run test/store.test.js`
Expected: PASS — 15 个测试全部通过

- [ ] **Step 7: 提交**

```bash
git add server/src/photos/store.js server/test/store.test.js
git commit -m "feat(server): add atomic JSON index store"
```

---

## Task 3：EXIF 与尺寸提取

**Files:**
- Create: `server/src/photos/metadata.js`
- Test: `server/test/metadata.test.js`
- Create: `server/test/fixtures/make-fixture.js`

**说明：** 测试需要一个带 EXIF 的真实 JPEG。用 sharp 现场生成，避免把二进制固件提交进仓库。

- [ ] **Step 1: 创建测试固件生成器**

创建 `server/test/fixtures/make-fixture.js`：

```js
import sharp from 'sharp'

/**
 * 生成一张纯色 JPEG 用于测试。size 为像素边长。
 * 不写入 EXIF——EXIF 相关的行为用「无 EXIF 的文件」和「模拟返回」分别覆盖。
 */
export async function makeJpeg(sidePx = 64) {
  return sharp({
    create: {
      width: sidePx,
      height: Math.round(sidePx * 0.75),
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .jpeg()
    .toBuffer()
}
```

- [ ] **Step 2: 写失败的测试**

创建 `server/test/metadata.test.js`：

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extractDimensions, formatExposureTime, buildExifFields } from '../src/photos/metadata.js'
import { makeJpeg } from './fixtures/make-fixture.js'

describe('extractDimensions', () => {
  it('返回图片的宽高', async () => {
    const buf = await makeJpeg(200)
    const dims = await extractDimensions(buf)
    expect(dims.width).toBe(200)
    expect(dims.height).toBe(150)
  })

  it('对损坏的输入抛错', async () => {
    await expect(extractDimensions(Buffer.from('not an image'))).rejects.toThrow()
  })
})

describe('formatExposureTime', () => {
  it('小于一秒显示为分数', () => {
    expect(formatExposureTime(1 / 4600)).toBe('1/4600s')
  })

  it('大于一秒显示秒', () => {
    expect(formatExposureTime(2.5)).toBe('3s')
  })

  it('1.5 秒保留一位小数', () => {
    expect(formatExposureTime(1.5)).toBe('1.5s')
  })

  it('非法值返回 null', () => {
    expect(formatExposureTime(0)).toBeNull()
    expect(formatExposureTime(-1)).toBeNull()
    expect(formatExposureTime(NaN)).toBeNull()
  })
})

describe('buildExifFields', () => {
  it('只输出存在的字段', () => {
    const fields = buildExifFields({
      Make: 'HUAWEI',
      Model: 'Pura 70 Ultra',
      FNumber: 2.1,
      ExposureTime: 1 / 4600,
      FocalLength: 15,
      ISO: 50,
    })
    expect(fields).toEqual([
      { label: '相机', value: 'HUAWEI Pura 70 Ultra' },
      { label: '光圈', value: 'f/2.1' },
      { label: '快门', value: '1/4600s' },
      { label: '焦距', value: '15mm' },
      { label: 'ISO', value: '50' },
    ])
  })

  it('无 EXIF 时返回空数组', () => {
    expect(buildExifFields({})).toEqual([])
    expect(buildExifFields(null)).toEqual([])
  })

  it('镜头单独成项', () => {
    const fields = buildExifFields({ LensModel: 'XF 35mm F1.4' })
    expect(fields).toEqual([{ label: '镜头', value: 'XF 35mm F1.4' }])
  })

  it('焦距取整', () => {
    expect(buildExifFields({ FocalLength: 15.4 })).toEqual([{ label: '焦距', value: '15mm' }])
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd server && npx vitest run test/metadata.test.js`
Expected: FAIL — 找不到模块 `../src/photos/metadata.js`

- [ ] **Step 4: 实现 `server/src/photos/metadata.js`**

```js
import sharp from 'sharp'
import exifr from 'exifr'

/** 读取图片像素尺寸。失败时抛错，由调用方决定如何处理。 */
export async function extractDimensions(input) {
  const meta = await sharp(input).metadata()
  if (!meta.width || !meta.height) {
    throw new Error('无法读取图片尺寸')
  }
  return { width: meta.width, height: meta.height }
}

/** 把快门秒数格式化成人类可读的字符串。非法值返回 null。 */
export function formatExposureTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds >= 1) {
    return seconds < 2 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
  }
  const denom = Math.round(1 / seconds)
  return denom > 0 ? `1/${denom}s` : null
}

/**
 * 把 exifr 的原始输出整理成前端直接可显示的 label/value 列表。
 * 只输出实际存在的字段，顺序固定以便前端稳定排版。
 */
export function buildExifFields(raw) {
  if (!raw || typeof raw !== 'object') return []

  const fields = []

  const camera = [raw.Make, raw.Model].filter(Boolean).join(' ')
  if (camera) fields.push({ label: '相机', value: camera })
  if (raw.LensModel) fields.push({ label: '镜头', value: String(raw.LensModel) })
  if (typeof raw.FNumber === 'number') fields.push({ label: '光圈', value: `f/${raw.FNumber}` })

  if (typeof raw.ExposureTime === 'number') {
    const t = formatExposureTime(raw.ExposureTime)
    if (t) fields.push({ label: '快门', value: t })
  }

  if (typeof raw.FocalLength === 'number') {
    fields.push({ label: '焦距', value: `${Math.round(raw.FocalLength)}mm` })
  }
  if (typeof raw.ISO === 'number') fields.push({ label: 'ISO', value: String(raw.ISO) })

  return fields
}

/** 提取拍摄时间。找不到合法时间返回 null。 */
export async function extractTakenAt(input) {
  let raw
  try {
    raw = await exifr.parse(input, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
  } catch {
    return null
  }
  const candidate = raw?.DateTimeOriginal ?? raw?.CreateDate ?? raw?.ModifyDate
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate.toISOString()
  }
  return null
}

/**
 * 一次性提取一条照片记录所需的全部元数据。
 * 尺寸提取失败视为致命错误（没有尺寸就无法正确排版），向上抛出。
 * EXIF 提取失败视为非致命，返回空字段。
 */
export async function extractMetadata(filePath) {
  const { width, height } = await extractDimensions(filePath)

  let exif = []
  try {
    const raw = await exifr.parse(filePath, [
      'DateTimeOriginal', 'CreateDate', 'ModifyDate',
      'Make', 'Model', 'LensModel',
      'FNumber', 'ExposureTime', 'FocalLength', 'ISO',
    ])
    exif = buildExifFields(raw)
  } catch {
    exif = []
  }

  const takenAt = await extractTakenAt(filePath)

  return { width, height, takenAt, exif }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd server && npx vitest run test/metadata.test.js`
Expected: PASS — 10 个测试全部通过

- [ ] **Step 6: 提交**

```bash
git add server/src/photos/metadata.js server/test/metadata.test.js server/test/fixtures/make-fixture.js
git commit -m "feat(server): add EXIF and dimension extraction"
```

---

## Task 4：单张照片的摄取流程

**Files:**
- Create: `server/src/photos/ingest.js`
- Test: `server/test/ingest.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `server/test/ingest.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run test/ingest.test.js`
Expected: FAIL — 找不到模块 `../src/photos/ingest.js`

- [ ] **Step 3: 实现 `server/src/photos/ingest.js`**

```js
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { extractMetadata } from './metadata.js'
import { upsertPhoto } from './store.js'

const THUMB_MAX = 720
const WEB_MAX = 1920
const JPEG_QUALITY = 85

/**
 * 把一张源文件摄取进照片库：移入 originals、生成两档衍生图、提取元数据、写入索引。
 *
 * 失败策略（对应设计文档第五节）：
 * - 原图已落盘即视为上传成功，不因衍生失败而回滚，避免用户重复上传。
 * - 衍生图失败时对应 derived 字段标为 false，前端对该条目回退用原图。
 * - 尺寸提取失败是致命的（没有宽高就无法排版），向上抛出，但仍保留原图。
 */
export async function ingestFile(cfg, { sourcePath, id }) {
  await fs.mkdir(cfg.originalsDir, { recursive: true })
  await fs.mkdir(cfg.thumbsDir, { recursive: true })
  await fs.mkdir(cfg.webDir, { recursive: true })

  const originalPath = path.join(cfg.originalsDir, id)
  if (path.resolve(sourcePath) !== path.resolve(originalPath)) {
    await fs.rename(sourcePath, originalPath)
  }

  let width = null
  let height = null
  let takenAt = null
  let exif = []
  try {
    const meta = await extractMetadata(originalPath)
    width = meta.width
    height = meta.height
    takenAt = meta.takenAt
    exif = meta.exif
  } catch (err) {
    throw new Error(`无法读取图片元数据：${id}（${err.message}）`)
  }

  const derived = { thumb: false, web: false }
  const warnings = []

  try {
    await sharp(originalPath)
      .rotate()
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(path.join(cfg.thumbsDir, id))
    derived.thumb = true
  } catch (err) {
    warnings.push(`缩略图生成失败：${err.message}`)
  }

  try {
    await sharp(originalPath)
      .rotate()
      .resize({ width: WEB_MAX, height: WEB_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(path.join(cfg.webDir, id))
    derived.web = true
  } catch (err) {
    warnings.push(`网页图生成失败：${err.message}`)
  }

  const record = {
    id,
    width,
    height,
    takenAt,
    title: '',
    description: '',
    exif,
    derived,
  }

  await upsertPhoto(cfg.indexPath, record)

  return { ...record, warnings }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run test/ingest.test.js`
Expected: PASS — 6 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add server/src/photos/ingest.js server/test/ingest.test.js
git commit -m "feat(server): add photo ingest pipeline"
```

---

## Task 5：目录扫描与索引对账

**Files:**
- Create: `server/src/photos/scan.js`
- Test: `server/test/scan.test.js`

**说明：** 这一组函数供第一期的一次性迁移脚本（Task 7）和以后的完整性检查使用。它们不做任何写入，只回答「磁盘上有什么、索引里缺什么」。

- [ ] **Step 1: 写失败的测试**

创建 `server/test/scan.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run test/scan.test.js`
Expected: FAIL — 找不到模块 `../src/photos/scan.js`

- [ ] **Step 3: 实现 `server/src/photos/scan.js`**

```js
import fs from 'node:fs/promises'

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

/** 列出目录下所有受支持的图片文件名，已排序。目录不存在时返回空数组。 */
export async function listImageFiles(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }

  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => {
      const dot = name.lastIndexOf('.')
      if (dot < 0) return false
      return ALLOWED_EXT.has(name.slice(dot).toLowerCase())
    })
    .sort()
}

/**
 * 比对磁盘与索引，报告四类差异。
 * 纯函数，不接触文件系统——衍生物的存在性由调用方通过 hasThumb/hasWeb 注入。
 */
export function reconcile(onDisk, indexed, probes = {}) {
  const diskSet = new Set(onDisk)
  const indexSet = new Set(indexed)

  const missingFromIndex = onDisk.filter((id) => !indexSet.has(id))
  const missingFromDisk = indexed.filter((id) => !diskSet.has(id))

  const missingThumb = []
  const missingWeb = []
  if (probes.hasThumb || probes.hasWeb) {
    for (const id of indexed) {
      if (!diskSet.has(id)) continue
      if (probes.hasThumb && !probes.hasThumb(id)) missingThumb.push(id)
      if (probes.hasWeb && !probes.hasWeb(id)) missingWeb.push(id)
    }
  }

  return { missingFromIndex, missingFromDisk, missingThumb, missingWeb }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run test/scan.test.js`
Expected: PASS — 7 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add server/src/photos/scan.js server/test/scan.test.js
git commit -m "feat(server): add directory scanning and index reconcile"
```

---

## Task 6：HTTP 服务与只读路由

**Files:**
- Create: `server/src/routes/photos.js`
- Create: `server/src/routes/health.js`
- Create: `server/src/index.js`
- Test: `server/test/routes.test.js`

- [ ] **Step 1: 写失败的测试**

创建 `server/test/routes.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run test/routes.test.js`
Expected: FAIL — 找不到模块 `../src/index.js`

- [ ] **Step 3: 实现 `server/src/routes/health.js`**

```js
import { Router } from 'express'

export function healthRouter() {
  const router = Router()
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  return router
}
```

- [ ] **Step 4: 实现 `server/src/routes/photos.js`**

```js
import { Router } from 'express'
import { readIndex } from '../photos/store.js'

/**
 * 排序规则（设计文档第四节）：
 * 1. 有拍摄时间的在前，按时间倒序；
 * 2. 无拍摄时间的在后，按文件名倒序（numeric 保证 IMG_2 < IMG_10 的直觉顺序）。
 */
export function sortPhotos(photos) {
  const dated = photos.filter((p) => p.takenAt)
  const undated = photos.filter((p) => !p.takenAt)

  dated.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt))
  undated.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))

  return [...dated, ...undated]
}

export function photosRouter(cfg) {
  const router = Router()

  router.get('/photos', async (_req, res) => {
    try {
      const index = await readIndex(cfg.indexPath)
      res.json({ photos: sortPhotos(index.photos) })
    } catch (err) {
      // 索引损坏属于服务端错误，必须暴露成 500，不能返回空列表冒充「没有照片」。
      console.error('[api] 读取索引失败', err)
      res.status(500).json({ error: '索引读取失败' })
    }
  })

  return router
}
```

- [ ] **Step 5: 实现 `server/src/index.js`**

```js
import express from 'express'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.js'
import { healthRouter } from './routes/health.js'
import { photosRouter } from './routes/photos.js'

/**
 * 装配 Express 应用。导出以便测试直接注入配置并用临时端口启动。
 */
export function createApp(cfg) {
  const app = express()

  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  api.use(healthRouter())
  api.use(photosRouter(cfg))
  app.use('/api', api)

  return app
}

// 仅在被直接执行时启动监听；被测试 import 时不启动。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig()
  const app = createApp(cfg)
  app.listen(cfg.port, () => {
    console.log(`[server] 监听 ${cfg.port}，照片目录 ${cfg.photosDir}`)
  })
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cd server && npx vitest run test/routes.test.js`
Expected: PASS — 5 个测试全部通过

- [ ] **Step 7: 运行全部测试**

Run: `cd server && npm test`
Expected: PASS — 全部 48 个测试通过

- [ ] **Step 8: 验证入口能真正启动（单元测试无法覆盖这一条）**

**为什么必须单独验证：** 路由测试导入的是导出的 `createApp`，不经过文件末尾的入口判断。
因此入口判断写错（例如用了 `file://${process.argv[1]}` 而不是 `pathToFileURL`）时，
所有测试仍然全绿，但 `npm start` 永远不会监听端口——这是只在部署后才暴露的错误。

Run:

```bash
cd server
PHOTOS_DIR=/tmp/pg-smoke ADMIN_PASSWORD_HASH=x PORT=3999 timeout 5 node src/index.js &
sleep 2
curl -s http://127.0.0.1:3999/api/health
```

Expected: 输出 `{"status":"ok"}`

若没有输出（连不上），说明入口判断有问题，必须先修好再继续。

- [ ] **Step 9: 提交**

```bash
git add server/src/index.js server/src/routes/ server/test/routes.test.js
git commit -m "feat(server): add express app with health and photos routes"
```

---

## Task 7：一次性迁移脚本（导入现有 44 张照片）

**Files:**
- Create: `server/scripts/migrate.js`
- Create: `server/test/migrate.test.js`

**说明：** 把仓库里现有的 `images/*.jpg` 导入到新的照片库结构。这个脚本是幂等的——重复运行只会补齐缺失的条目，不会重复摄取。

- [ ] **Step 1: 写失败的测试**

创建 `server/test/migrate.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run test/migrate.test.js`
Expected: FAIL — 找不到模块 `../scripts/migrate.js`

- [ ] **Step 3: 实现 `server/scripts/migrate.js`**

```js
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../src/config.js'
import { listImageFiles } from '../src/photos/scan.js'
import { ingestFile } from '../src/photos/ingest.js'
import { readIndex } from '../src/photos/store.js'

/**
 * 把 sourceDir 中的图片批量导入照片库。幂等：已在索引中的文件会被跳过。
 *
 * 单张失败不中断整批——损坏的文件记录到 failed 并继续。
 * 这样一次迁移里有一个坏文件不会让其余 43 张全部白做。
 */
export async function migrateDirectory(cfg, sourceDir) {
  const files = await listImageFiles(sourceDir)
  const index = await readIndex(cfg.indexPath)
  const known = new Set(index.photos.map((p) => p.id))

  const result = { imported: [], skipped: [], failed: [] }

  for (const name of files) {
    if (known.has(name)) {
      result.skipped.push(name)
      continue
    }

    const sourcePath = path.join(sourceDir, name)
    // 摄取过程会把源文件移进 originals/，因此先复制到临时位置，
    // 保留仓库里的原文件不被破坏（迁移是复制，不是剪切）。
    const stagingPath = path.join(cfg.photosDir, `.staging-${name}`)
    try {
      await fs.mkdir(cfg.photosDir, { recursive: true })
      await fs.copyFile(sourcePath, stagingPath)
      await ingestFile(cfg, { sourcePath: stagingPath, id: name })
      result.imported.push(name)
    } catch (err) {
      await fs.rm(stagingPath, { force: true })
      result.failed.push({ id: name, error: err.message })
    }
  }

  return result
}

/** 命令行入口：node scripts/migrate.js <源目录> */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourceDir = process.argv[2]
  if (!sourceDir) {
    console.error('用法：node scripts/migrate.js <图片源目录>')
    process.exit(1)
  }
  const cfg = loadConfig()
  const result = await migrateDirectory(cfg, path.resolve(sourceDir))
  console.log(`导入 ${result.imported.length} 张`)
  console.log(`跳过 ${result.skipped.length} 张（已在索引中）`)
  if (result.failed.length > 0) {
    console.error(`失败 ${result.failed.length} 张：`)
    for (const f of result.failed) console.error(`  ${f.id} — ${f.error}`)
    process.exit(1)
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run test/migrate.test.js`
Expected: PASS — 6 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add server/scripts/migrate.js server/test/migrate.test.js
git commit -m "feat(server): add idempotent migration script"
```

---

## Task 8：容器化（Nginx + Node 双进程）

**Files:**
- Create: `nginx/nginx.conf`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `Dockerfile`
- Delete: `Dockerfile` 原内容（整体替换）

- [ ] **Step 1: 创建 `nginx/nginx.conf`**

```nginx
worker_processes auto;

events {
  worker_connections 1024;
}

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;

  sendfile        on;
  tcp_nopush      on;
  keepalive_timeout 65;

  # 图片是不可变的：文件名即内容标识，改图必然换文件名。
  # 因此可以长时间缓存，大幅减少重复传输。
  map $uri $cache_control {
    default                       "no-cache";
    ~^/media/                     "public, max-age=31536000, immutable";
    ~^/assets/                    "public, max-age=31536000, immutable";
  }

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
  gzip_min_length 1024;

  server {
    listen 80;
    server_name _;

    root /srv/www;
    index index.html;

    add_header Cache-Control $cache_control always;

    # API 交给 Node。图片请求绝不经过应用进程。
    location /api/ {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 300s;
      client_max_body_size 64m;
    }

    # 照片文件由 Nginx 直接读挂载目录发送，零应用开销。
    location /media/ {
      alias /data/photos/;
      try_files $uri =404;
    }

    # 前端是单页应用：未命中的路径一律回落到 index.html。
    location / {
      try_files $uri $uri/ /index.html;
    }
  }
}
```

- [ ] **Step 2: 创建 `.env.example`**

```dotenv
# 宿主机上存放照片库的目录（会被挂载进容器）
PHOTOS_HOST_DIR=/srv/photos

# 容器内照片库路径，必须与 compose 里的挂载目标一致。
# config.js 要求这个变量，缺失时后端启动即报错。
PHOTOS_DIR=/data/photos

# Node 监听端口（容器内部）
PORT=3000

# 管理端密码的哈希。生成方式见 README。
# 绝不要把真实值提交进仓库。
ADMIN_PASSWORD_HASH=
```

- [ ] **Step 3: 替换 `Dockerfile` 内容**

```dockerfile
# ---------- 构建前端 ----------
FROM node:24-slim AS web-build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 安装后端依赖 ----------
FROM node:24-slim AS server-deps
WORKDIR /srv/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---------- 运行镜像 ----------
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx supervisor \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# 前端静态文件
COPY --from=web-build /src/dist /srv/www

# 后端代码与生产依赖
COPY server/ /srv/server/
COPY --from=server-deps /srv/server/node_modules /srv/server/node_modules

# Nginx 配置
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# supervisord 配置——CMD 要用它启动，必须复制进镜像，否则容器起不来
COPY supervisord.conf /srv/supervisord.conf

# 照片库挂载点（运行时由 compose 挂载宿主机目录）
RUN mkdir -p /data/photos/originals /data/photos/thumbs /data/photos/web

EXPOSE 80

CMD ["supervisord", "-c", "/srv/supervisord.conf"]
```

- [ ] **Step 4: 创建 `supervisord.conf`**

```ini
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0

[program:nginx]
command=nginx -g "daemon off;"
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:node]
command=node /srv/server/src/index.js
directory=/srv/server
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

- [ ] **Step 5: 创建 `docker-compose.yml`**

```yaml
services:
  gallery:
    build: .
    image: photo-gallery:latest
    ports:
      - "80:80"
    env_file:
      - .env
    environment:
      # 显式声明，避免 .env 缺失该项时后端启动即报错。
      # 必须与下面 volumes 的挂载目标一致。
      PHOTOS_DIR: /data/photos
    volumes:
      # 照片放在宿主机上，容器只是读写它。重建镜像不影响照片。
      - ${PHOTOS_HOST_DIR}:/data/photos
    restart: unless-stopped
```

- [ ] **Step 6: 验证镜像能构建**

Run: `docker build -t photo-gallery:test .`
Expected: 构建成功，无报错

- [ ] **Step 7: 验证容器能起来并响应**

```bash
mkdir -p /tmp/pg-photos
docker run --rm -d --name pg-test -p 8080:80 \
  -e PHOTOS_DIR=/data/photos \
  -e ADMIN_PASSWORD_HASH=placeholder \
  -v /tmp/pg-photos:/data/photos \
  photo-gallery:test
sleep 3
curl -s http://127.0.0.1:8080/api/health
docker rm -f pg-test
```

Expected: 输出 `{"status":"ok"}`

- [ ] **Step 8: 提交**

```bash
git add Dockerfile supervisord.conf nginx/ docker-compose.yml .env.example
git commit -m "feat: containerize with nginx + node dual process"
```

---

## Task 9：清理历史包袱

**Files:**
- Delete: `src/transitions.ts`
- Delete: `src/counter.ts`
- Delete: `src/typescript.svg`
- Delete: `public/debug-info.json`
- Delete: `images/generate_thumbs.py`
- Delete: `images/copy_metadata.py`
- Delete: `images/fill_missing_dates.py`
- Delete: `scripts/sync-images.mjs`
- Delete: `scripts/watch-images.mjs`
- Delete: `.github/workflows/deploy.yml`
- Delete: `public/.nojekyll`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `.gitignore`
- Modify: `index.html`

**说明：** 这一期后端已能独立工作，旧的同步脚本与 Python 缩略图管线不再需要。第三期会重写前端，但第一期就可以先把与它无关的死代码和部署残留清掉。

- [ ] **Step 1: 删除死代码与残留文件**

```bash
git rm src/transitions.ts src/counter.ts src/typescript.svg
git rm public/debug-info.json public/.nojekyll
git rm images/generate_thumbs.py images/copy_metadata.py images/fill_missing_dates.py
git rm scripts/sync-images.mjs scripts/watch-images.mjs
git rm -r .github/workflows
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 2: 修改 `package.json` 移除已失效的脚本与依赖**

把 `scripts` 改为：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

把 `devDependencies` 中的 `concurrently` 移除（`dev` 不再需要它）。

- [ ] **Step 3: 修改 `vite.config.ts` 去掉 GitHub Pages 的 base**

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  // 自建服务器挂在根路径，不需要 GH Pages 时代的相对路径。
})
```

- [ ] **Step 4: 修改 `.gitignore`**

把「Generated by image sync scripts」一节整体替换为：

```
# 同步脚本已移除；照片库不在仓库内
public/images/
public/images-manifest.json
```

同时在该节末尾补上照片库目录本身（防止有人误把宿主机目录建在仓库里）：

```
/photos-library/
```

- [ ] **Step 5: 修改 `index.html` 移除无效的图标引用**

把这一行：

```html
<link rel="icon" type="image/svg+xml" href="/vite.svg" />
```

改为：

```html
<link rel="icon" href="data:," />
```

（`/vite.svg` 本来就不存在，是脚手架残留，会产生 404。）

- [ ] **Step 6: 验证前端仍能构建**

Run: `npm install && npm run build`
Expected: 构建成功，`dist/` 生成

- [ ] **Step 7: 验证后端测试仍然全绿**

Run: `cd server && npm test`
Expected: PASS — 全部 48 个测试通过

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "chore: remove dead code, python pipeline, and GitHub Pages artifacts"
```

---

## Task 10：编写 README 运行说明

**Files:**
- Modify: `README.md`
- Delete: `THUMBNAIL_OPTIMIZATION.md`

- [ ] **Step 1: 用以下内容替换 `README.md`**

````markdown
# Photo Gallery

个人摄影展示站。Node + Nginx 后端，照片存放在宿主机目录中。

## 架构

单容器双进程：

- **Nginx**：发送前端静态文件；直接读挂载目录发送照片；把 `/api/` 反向代理给 Node。
- **Node**：只处理 `/api/`——健康检查、照片列表（后续的管理接口）。

照片不进入镜像，加照片不需要重建容器。

## 目录结构

```
photos/                  ← 宿主机目录，挂载进容器
  originals/             ← 原图
  thumbs/                ← 720px 衍生图
  web/                   ← 1920px 衍生图
  index.json             ← 索引（唯一真相来源）
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 |
|---|---|
| `PHOTOS_HOST_DIR` | 宿主机上照片库的绝对路径 |
| `PORT` | Node 监听端口，默认 3000 |
| `ADMIN_PASSWORD_HASH` | 管理端密码的哈希（第二期使用） |

生成密码哈希：

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" '你的密码'
```

## 运行

```bash
docker compose up --build -d
```

访问 `http://<服务器地址>/`。

## 导入既有照片

把图片放进一个目录，然后：

```bash
docker compose exec gallery node /srv/server/scripts/migrate.js /path/to/images
```

幂等——重复运行只补齐缺失的条目。

## 开发

后端：

```bash
cd server && npm install && npm test
PHOTOS_DIR=/tmp/pg-dev ADMIN_PASSWORD_HASH=dev npm run dev
```

前端：

```bash
npm install && npm run dev
```

## 已知限制

- 原图公开可访问，任何人知道文件名即可获取。
- 索引为单个 JSON 文件，写入是整体的；照片量达到数万张前无需更换。
````

- [ ] **Step 2: 删除已过时的文档**

```bash
git rm THUMBNAIL_OPTIMIZATION.md
```

该文档描述的 Python/Pillow 缩略图管线已被删除。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: rewrite README for self-hosted deployment"
```

---

## 第一期完成标准

- [ ] `cd server && npm test` 全部通过
- [ ] `npm run build` 能产出前端 `dist/`
- [ ] `docker compose up` 能启动服务
- [ ] `GET /api/health` 返回 `{"status":"ok"}`
- [ ] 迁移脚本能把现有 44 张照片导入并生成两档衍生图
- [ ] `GET /api/photos` 返回按拍摄时间倒序的照片列表
- [ ] `/media/thumbs/*.jpg` 能通过 Nginx 直接访问

## 不在本期范围内

- 管理端（登录、上传、删除）——第二期
- 前端重写、视觉、液态玻璃、动效——第三期
- 索引文件损坏时的自动恢复
- git 历史中 387MB 原图的清理

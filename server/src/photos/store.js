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

/** 在同一条写锁内更新已有照片，防止并发删除与编辑互相覆盖。 */
export async function updatePhoto(indexPath, id, fields) {
  return withLock(indexPath, async () => {
    const index = await readIndex(indexPath)
    const position = index.photos.findIndex((photo) => photo.id === id)
    if (position < 0) return null

    const updated = { ...index.photos[position], ...fields }
    const photos = [...index.photos]
    photos[position] = updated
    await writeIndex(indexPath, { ...index, photos })
    return updated
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

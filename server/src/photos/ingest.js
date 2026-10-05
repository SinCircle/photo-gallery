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
      .toFile(path.join(cfg.thumbsDir, `${id}.jpg`))
    derived.thumb = true
  } catch (err) {
    warnings.push(`缩略图生成失败：${err.message}`)
  }

  try {
    await sharp(originalPath)
      .rotate()
      .resize({ width: WEB_MAX, height: WEB_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(path.join(cfg.webDir, `${id}.jpg`))
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

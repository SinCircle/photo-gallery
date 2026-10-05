import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { ingestFile } from './ingest.js'
import { imageExtension } from './scan.js'
import { readIndex, removePhoto, updatePhoto } from './store.js'

const MIME_BY_EXTENSION = {
  '.jpg': { mime: 'image/jpeg', format: 'jpeg' },
  '.jpeg': { mime: 'image/jpeg', format: 'jpeg' },
  '.png': { mime: 'image/png', format: 'png' },
  '.webp': { mime: 'image/webp', format: 'webp' },
  '.avif': { mime: 'image/avif', format: 'heif' },
  '.gif': { mime: 'image/gif', format: 'gif' },
}

export const MAX_UPLOAD_BYTES = Math.floor(14.7 * 1024 * 1024)

const uploadChains = new Map()

export class PhotoRequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** 从浏览器可能提交的本地路径中只取文件名，再清除控制字符与系统保留符号。 */
export function sanitizeOriginalName(originalName) {
  if (typeof originalName !== 'string') return ''
  let decodedName = originalName
  if (/^[\u0000-\u00ff]*$/.test(originalName) && /[\u0080-\u00ff]/.test(originalName)) {
    const utf8Name = Buffer.from(originalName, 'latin1').toString('utf8')
    if (!utf8Name.includes('\uFFFD')) decodedName = utf8Name
  }
  const leaf = decodedName.replaceAll('\\', '/').split('/').pop() ?? ''
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .trim()

  const extension = path.extname(cleaned)
  if (!extension) return ''
  const stem = cleaned.slice(0, -extension.length)
  if (!stem) return ''
  const shortenedStem = Array.from(stem).slice(0, 160).join('')
  return `${shortenedStem}${extension}`
}

/** Multer 收到文件头后立即拒绝扩展名与浏览器 MIME 不一致的请求。 */
export function validateUploadFile(file) {
  const safeName = sanitizeOriginalName(file?.originalname)
  const extension = imageExtension(safeName)
  const expected = MIME_BY_EXTENSION[extension]
  if (!expected) throw new PhotoRequestError(415, '不支持这种图片格式')
  if (file.mimetype !== expected.mime) throw new PhotoRequestError(415, '文件类型与扩展名不一致')
  return { safeName, extension, expectedFormat: expected.format }
}

function isSafePhotoId(id) {
  return typeof id === 'string'
    && id.length > 0
    && id !== '.'
    && id !== '..'
    && !/[\\/\u0000-\u001f\u007f]/.test(id)
    && path.basename(id) === id
}

async function allocatePhotoId(cfg, safeName) {
  const index = await readIndex(cfg.indexPath)
  const knownIds = new Set(index.photos.map((photo) => photo.id))
  const timestamp = Date.now()

  // 时间戳仍放在原文件名前；撞名时递增毫秒，防止重复上传覆盖原图。
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const id = `${timestamp + attempt}_${safeName}`
    if (knownIds.has(id)) continue
    try {
      await fs.access(path.join(cfg.originalsDir, id))
    } catch (err) {
      if (err.code === 'ENOENT') return id
      throw err
    }
  }
  throw new Error('无法为上传文件分配唯一名称')
}

export async function uploadPhoto(cfg, file) {
  const previous = uploadChains.get(cfg.indexPath) ?? Promise.resolve()
  const pending = previous.then(() => performUpload(cfg, file), () => performUpload(cfg, file))
  uploadChains.set(cfg.indexPath, pending.then(() => undefined, () => undefined))
  return pending
}

async function performUpload(cfg, file) {
  const { safeName, expectedFormat } = validateUploadFile(file)
  let actual
  try {
    actual = await sharp(file.path).metadata()
  } catch {
    throw new PhotoRequestError(400, '无法读取图片文件')
  }
  if (!actual.width || !actual.height || actual.format !== expectedFormat) {
    throw new PhotoRequestError(400, '图片内容与声明的类型不一致')
  }

  const id = await allocatePhotoId(cfg, safeName)
  return ingestFile(cfg, { sourcePath: file.path, id })
}

export async function deletePhoto(cfg, id) {
  if (!isSafePhotoId(id)) throw new PhotoRequestError(400, '照片编号不合法')

  // 索引先移除，避免删图成功而索引损坏时仍向访客返回失效记录。
  const removed = await removePhoto(cfg.indexPath, id)
  await Promise.all([
    fs.rm(path.join(cfg.originalsDir, id), { force: true }),
    fs.rm(path.join(cfg.thumbsDir, id), { force: true }),
    fs.rm(path.join(cfg.webDir, id), { force: true }),
  ])
  return removed
}

export async function updatePhotoMetadata(cfg, id, { title, description }) {
  if (!isSafePhotoId(id)) throw new PhotoRequestError(400, '照片编号不合法')
  return updatePhoto(cfg.indexPath, id, { title, description })
}

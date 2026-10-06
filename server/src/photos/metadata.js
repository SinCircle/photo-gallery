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

  const make = String(raw.Make ?? '').trim().replace(/\s+/g, ' ')
  const model = String(raw.Model ?? '').trim().replace(/\s+/g, ' ')
  const includesMake = model.toLowerCase() === make.toLowerCase() || model.toLowerCase().startsWith(make.toLowerCase() + ' ')
  const camera = make && includesMake ? model : [make, model].filter(Boolean).join(' ')
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

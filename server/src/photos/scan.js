import fs from 'node:fs/promises'

const ALLOWED_EXT = Object.freeze(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

/** 统一扫描与上传的扩展名白名单，避免两条入口逐渐接受不同格式。 */
export function imageExtension(name) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  const extension = name.slice(dot).toLowerCase()
  return ALLOWED_EXT.includes(extension) ? extension : ''
}

export function isSupportedImageName(name) {
  return Boolean(imageExtension(name))
}

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
    .filter(isSupportedImageName)
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

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

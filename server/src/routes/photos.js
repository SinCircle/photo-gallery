import { Router } from 'express'
import { stat } from 'node:fs/promises'
import { readIndex } from '../photos/store.js'

const fileOrder = new Intl.Collator(undefined, { numeric: true })

/**
 * 排序规则（设计文档第四节）：
 * 1. 有拍摄时间的在前，按时间倒序；
 * 2. 无拍摄时间的在后，按文件名倒序（numeric 保证 IMG_2 < IMG_10 的直觉顺序）。
 */
export function sortPhotos(photos) {
  const dated = photos.filter((p) => p.takenAt)
  const undated = photos.filter((p) => !p.takenAt)

  dated.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt))
  undated.sort((a, b) => fileOrder.compare(b.id, a.id))

  return [...dated, ...undated]
}

export function photosRouter(cfg) {
  const router = Router()
  let cached

  router.get('/photos', async (_req, res) => {
    try {
      // Check the file on every request so admin edits, external scans, removal
      // and corruption remain visible. Atomic replacements change inode/ctime.
      const file = await stat(cfg.indexPath, { bigint: true }).catch(err => {
        if (err.code === 'ENOENT') return undefined
        throw err
      })
      const stamp = file && `${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`
      if (!stamp || cached?.stamp !== stamp) {
        const index = await readIndex(cfg.indexPath)
        cached = { stamp, body: JSON.stringify({ photos: sortPhotos(index.photos) }) }
      }
      res.set('Cache-Control', 'no-cache').type('json').send(cached.body)
    } catch (err) {
      // 索引损坏属于服务端错误，必须暴露成 500，不能返回空列表冒充「没有照片」。
      console.error('[api] 读取索引失败', err)
      res.status(500).json({ error: '索引读取失败' })
    }
  })

  return router
}

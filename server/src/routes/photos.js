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

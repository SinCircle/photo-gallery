import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { Router } from 'express'
import { requireAuth } from '../auth/sessions.js'
import { deletePhoto, MAX_UPLOAD_BYTES, PhotoRequestError, updatePhotoMetadata, uploadPhoto, validateUploadFile } from '../photos/admin.js'

function sendUploadError(err, res) {
  if (err instanceof PhotoRequestError) return res.status(err.status).json({ error: err.message })
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '原图不能超过 14.7 MiB' })
    return res.status(400).json({ error: '上传表单不合法' })
  }
  console.error('[api] 图片上传失败', err)
  return res.status(500).json({ error: '图片上传失败' })
}

export function adminRouter(cfg) {
  const router = Router()
  const uploadDirectory = path.join(cfg.photosDir, '.uploads')
  const parser = multer({
    storage: multer.diskStorage({
      destination(_req, _file, callback) {
        fs.mkdir(uploadDirectory, { recursive: true }).then(() => callback(null, uploadDirectory), callback)
      },
      filename(_req, _file, callback) {
        callback(null, `${randomUUID()}.upload`)
      },
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter(_req, file, callback) {
      try {
        validateUploadFile(file)
        callback(null, true)
      } catch (err) {
        callback(err)
      }
    },
  })

  router.post('/upload', requireAuth, (req, res) => {
    parser.single('file')(req, res, async (parseError) => {
      if (parseError) return sendUploadError(parseError, res)
      if (!req.file) return res.status(400).json({ error: '请选择一张图片' })

      try {
        const photo = await uploadPhoto(cfg, req.file)
        res.status(201).json(photo)
      } catch (err) {
        sendUploadError(err, res)
      } finally {
        await fs.rm(req.file.path, { force: true }).catch((err) => {
          console.error('[api] 清理上传暂存文件失败', err)
        })
      }
    })
  })

  router.post('/delete', requireAuth, async (req, res) => {
    try {
      await deletePhoto(cfg, req.body?.id)
      res.json({ deleted: true })
    } catch (err) {
      if (err instanceof PhotoRequestError) return res.status(err.status).json({ error: err.message })
      console.error('[api] 删除照片失败', err)
      res.status(500).json({ error: '照片删除失败' })
    }
  })

  router.patch('/photo/:id', requireAuth, async (req, res) => {
    const { title, description } = req.body ?? {}
    if (typeof title !== 'string' || typeof description !== 'string') {
      return res.status(400).json({ error: '标题和描述都必须是文本' })
    }

    try {
      const photo = await updatePhotoMetadata(cfg, req.params.id, { title, description })
      if (!photo) return res.status(404).json({ error: '没有找到这张照片' })
      res.json(photo)
    } catch (err) {
      if (err instanceof PhotoRequestError) return res.status(err.status).json({ error: err.message })
      console.error('[api] 更新照片信息失败', err)
      res.status(500).json({ error: '照片信息更新失败' })
    }
  })

  return router
}

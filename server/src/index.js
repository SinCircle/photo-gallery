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

import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const contentTypes: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
}

function developmentMedia(photosDir: string): Plugin {
  return {
    name: 'development-media',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/media/')) return next()
        try {
          const match = req.url.split('?')[0].match(/^\/media\/(originals|thumbs|web)\/([^/]+)$/)
          if (!match || !photosDir) { res.statusCode = 404; res.end(); return }
          const id = decodeURIComponent(match[2])
          if (!id || /[/\\\x00-\x1f]/.test(id) || id === '.' || id === '..') {
            res.statusCode = 404; res.end(); return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405; res.end(); return
          }
          const root = await realpath(photosDir)
          const file = await realpath(path.join(root, match[1], id))
          const relative = path.relative(root, file)
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            res.statusCode = 404; res.end(); return
          }
          const details = await stat(file)
          if (!details.isFile()) { res.statusCode = 404; res.end(); return }
          res.setHeader('Content-Type', contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream')
          res.setHeader('Content-Length', details.size)
          if (req.method === 'HEAD') { res.end(); return }
          const stream = createReadStream(file)
          stream.on('error', () => res.destroy())
          stream.pipe(res)
        } catch {
          res.statusCode = 404
          res.end()
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Explicit host PHOTOS_DIR wins; compose's /data/photos maps to PHOTOS_HOST_DIR.
  const photosDir = process.env.PHOTOS_DIR || env.PHOTOS_HOST_DIR || env.PHOTOS_DIR || ''
  return {
    plugins: [developmentMedia(photosDir)],
    server: {
      proxy: { '/api': 'http://127.0.0.1:3000' },
      watch: { ignored: ['**/.superpowers/**', ...(photosDir ? [`${path.resolve(photosDir).replaceAll('\\', '/')}/**`] : [])] },
    },
  }
})

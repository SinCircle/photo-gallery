import http from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

// Review the built candidate without replacing the accepted port-80 stack.
// Read-only API/media requests use that same stack and photo library.
const root = path.resolve(process.env.VERIFY_DIST || 'dist')
const port = Number(process.env.VERIFY_PORT || 5187)
const upstreamUrl = process.env.VERIFY_UPSTREAM || 'http://127.0.0.1'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return }
  if (/^\/(api|media)\//.test(req.url)) {
    const upstream = http.request(new URL(req.url, upstreamUrl), { method: req.method }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res)
    })
    upstream.on('error', () => res.writeHead(502).end())
    upstream.end(); return
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    const info = await stat(file)
    if (!info.isFile()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file).on('error', () => res.destroy()).pipe(res)
  } catch { res.writeHead(404).end() }
}).listen(port, '127.0.0.1', () => console.log(`Candidate production build: http://127.0.0.1:${port}`))

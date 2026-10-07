import http from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createGzip } from 'node:zlib'
import path from 'node:path'

// Local read-only benchmark server. Both builds use identical gzip, cache and
// photo responses; API requests use the development backend, never production.
const root=path.resolve(process.env.VERIFY_DIST||'dist')
const photos=path.resolve(process.env.PERF_PHOTOS||'D:/tmp/pg-verify-lib')
const port=Number(process.env.VERIFY_PORT||5187)
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'}
http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return}
  if(req.url.startsWith('/api/')) {
    const upstream=http.request(new URL(req.url,'http://127.0.0.1:3000'),{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res)})
    upstream.on('error',()=>res.writeHead(502).end());upstream.end();return
  }
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const base=pathname.startsWith('/media/')?photos:root
    const local=base===photos?pathname.slice(7):pathname==='/'?'index.html':pathname.slice(1)
    const file=path.resolve(base,local)
    if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return}
    const details=await stat(file)
    if(!details.isFile()){res.writeHead(404).end();return}
    const type=types[path.extname(file)]||'application/octet-stream'
    const etag=`"${details.size.toString(16)}-${Math.trunc(details.mtimeMs).toString(16)}"`
    res.setHeader('ETag',etag)
    const gzip=details.size>1024&&/css|javascript|json|svg/.test(type)&&req.headers['accept-encoding']?.includes('gzip')
    res.setHeader('Content-Type',type)
    res.setHeader('Cache-Control',/^\/(assets|media)\//.test(pathname)?'public, max-age=31536000, immutable':'no-cache')
    if(req.headers['if-none-match']===etag){res.writeHead(304).end();return}
    if(gzip){res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding')}
    else res.setHeader('Content-Length',details.size)
    res.writeHead(200)
    if(req.method==='HEAD'){res.end();return}
    const stream=createReadStream(file)
    stream.on('error',()=>res.destroy())
    if(gzip)stream.pipe(createGzip()).pipe(res);else stream.pipe(res)
  }catch{res.writeHead(404).end()}
}).listen(port,'127.0.0.1',()=>console.log(`Performance build ${root} at http://127.0.0.1:${port}`))

const THUMB_CACHE = 'thumbs-v1'
const mem = new Map<string, string>()

async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) throw new Error('Failed to fetch image')
  const blob = await res.blob()
  return await createImageBitmap(blob)
}

function chooseThumbSize(bitmap: ImageBitmap): { w: number; h: number } {
  const maxW = 720
  const maxH = 720
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
  return { w: Math.max(1, Math.round(bitmap.width * scale)), h: Math.max(1, Math.round(bitmap.height * scale)) }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/webp', 0.82),
  )
  if (webp) return webp
  const jpeg: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.84),
  )
  if (!jpeg) throw new Error('Failed to create thumbnail')
  return jpeg
}

function thumbRequestKey(originalUrl: string): Request {
  // Cache key needs to be stable; we use a query marker.
  return new Request(`${originalUrl}?__thumb=1`)
}

export async function getThumbnailObjectUrl(originalUrl: string): Promise<string> {
  const cachedMem = mem.get(originalUrl)
  if (cachedMem) return cachedMem

  const cache = await caches.open(THUMB_CACHE)
  const key = thumbRequestKey(originalUrl)
  const hit = await cache.match(key)
  if (hit) {
    const blob = await hit.blob()
    const obj = URL.createObjectURL(blob)
    mem.set(originalUrl, obj)
    return obj
  }

  const bmp = await loadImageBitmap(originalUrl)
  const { w, h } = chooseThumbSize(bmp)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()

  const blob = await canvasToBlob(canvas)
  const headers = new Headers({ 'content-type': blob.type })
  await cache.put(key, new Response(blob, { headers }))

  const obj = URL.createObjectURL(blob)
  mem.set(originalUrl, obj)
  return obj
}

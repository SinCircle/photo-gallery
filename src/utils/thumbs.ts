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

export async function getThumbnailObjectUrl(originalUrl: string, pregenThumbUrl: string): Promise<string> {
  if (!pregenThumbUrl) {
    throw new Error('Pre-generated thumbnail URL is required.');
  }

  try {
    const res = await fetch(pregenThumbUrl, { cache: 'force-cache' })
    if (!res.ok) {
      throw new Error(`Failed to fetch pre-generated thumbnail: ${res.statusText}`)
    }

    const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    mem.set(originalUrl, obj)
    return obj
  } catch (err) {
    console.error('Error loading pre-generated thumbnail:', err)
    throw new Error('Unable to load pre-generated thumbnail.')
  }
}

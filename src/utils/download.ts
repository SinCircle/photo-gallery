import { CONFIG } from '../config'

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

/** Phone/tablet detection used to switch the button to "save to album". */
export function isMobileDevice(): boolean {
  // A coarse primary pointer (touch) is the most reliable phone/tablet signal.
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true
  } catch {
    // ignore
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/**
 * On mobile the button is always "保存" and always goes down the save-to-album
 * path, regardless of whether the Web Share API happens to be present. Desktop
 * always keeps a plain browser download.
 */
export function supportsAlbumSave(): boolean {
  return isMobileDevice()
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

function generateTimestampFileName(): string {
  const now = new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}.jpg`
}

/**
 * Renders the bordered/stamped JPEG into a Blob. This is the expensive step,
 * so the photo view prepares it in advance (and caches it) — see photo.ts.
 */
export async function generateBorderedBlob(params: {
  url: string
  borderPx?: number
  stampText?: string
}): Promise<Blob> {
  const borderPx = Math.max(
    0,
    Math.floor(params.borderPx ?? CONFIG.downloadBorderPx),
  )
  const img = await loadImage(params.url)

  const width = img.naturalWidth
  const height = img.naturalHeight

  // Avoid creating absurdly large canvases for huge files.
  // This cap is conservative for stability.
  const maxSide = 12000
  const scale = Math.min(1, maxSide / Math.max(width, height))

  const scaledW = Math.round(width * scale)
  const scaledH = Math.round(height * scale)
  const scaledBorder = Math.round(borderPx * scale)

  const canvas = document.createElement('canvas')
  canvas.width = scaledW + scaledBorder * 2
  canvas.height = scaledH + scaledBorder * 2

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Blurred matte border (similar to the in-app blurred preview background).
  // 1) Draw a blurred, cover-fitted version of the image as the matte.
  // 2) Add a light veil on top to keep it airy.
  // 3) Draw the original image centered inside the matte.
  {
    const coverScale = Math.max(canvas.width / width, canvas.height / height)
    const coverW = Math.round(width * coverScale)
    const coverH = Math.round(height * coverScale)
    const coverX = Math.round((canvas.width - coverW) / 2)
    const coverY = Math.round((canvas.height - coverH) / 2)

    const blurPx = Math.max(8, Math.round(scaledBorder * 0.38))
    ctx.filter = `blur(${blurPx}px)`
    ctx.drawImage(img, coverX, coverY, coverW, coverH)
    ctx.filter = 'none'

    ctx.fillStyle = 'rgba(244, 244, 244, 0.75)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  ctx.drawImage(img, scaledBorder, scaledBorder, scaledW, scaledH)

  if (params.stampText && params.stampText.trim().length > 0 && scaledBorder > 0) {
    // Font size is proportional to border thickness (fixed ratio).
    const fontSize = Math.round(scaledBorder * 0.22)
    ctx.fillStyle = 'rgba(17, 17, 17, 0.62)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${fontSize}px ${CONFIG.stampFontFamilyCanvas}`
    ctx.fillText(params.stampText.trim(), canvas.width / 2, canvas.height - scaledBorder * 0.52)
  }

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95),
  )
  if (!blob) throw new Error('Failed to generate download')
  return blob
}

/**
 * Persist an already-generated bordered image. On mobile this ALWAYS goes
 * down the save-to-album path — no browser-download fallback, since the
 * point of the button on a phone is to land in the photo album, not Downloads.
 * Web Share is the only way to reach the album; if it's absent we throw so the
 * caller can surface the failure instead of silently downloading. Desktop
 * always does a plain browser download.
 */
export async function saveBorderedImage(blob: Blob): Promise<void> {
  const fileName = generateTimestampFileName()
  if (!isMobileDevice()) {
    downloadBlob(blob, fileName)
    return
  }

  if (typeof navigator.share !== 'function') {
    const err = new Error('当前浏览器不支持保存到相册')
    err.name = 'NoShareAPI'
    throw err
  }

  const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })
  try {
    await navigator.share({ files: [file] })
  } catch (err) {
    // User dismissed the share sheet — nothing to save.
    if (err instanceof DOMException && err.name === 'AbortError') return
    throw err
  }
}


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

/** Phone/tablet detection used to switch the download button to "save to album". */
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
 * True when the download button can actually save straight into the photo
 * album (mobile + Web Share with file support). The label and the save path
 * must both use this, so an unsupported browser never promises an album save
 * it cannot deliver.
 */
export function supportsAlbumSave(): boolean {
  if (!isMobileDevice()) return false
  if (typeof navigator.share !== 'function') return false
  // canShare isn't present on every browser that has share() (e.g. some iOS
  // Safari / Android builds). When it's missing we assume file sharing works
  // and let a runtime NotSupportedError fall back to a plain download.
  if (typeof navigator.canShare === 'function') {
    const probe = new File([new Uint8Array(1)], 'probe.jpg', { type: 'image/jpeg' })
    try {
      return navigator.canShare({ files: [probe] })
    } catch {
      return false
    }
  }
  return true
}

/**
 * Hand the image to the native share sheet, where "保存图像 / Save Image"
 * saves straight into the photo album — a plain browser `download` would land
 * in the Downloads folder instead.
 *
 * Returns true when the blob was given to the share sheet (including the user
 * dismissing it), false when the caller should fall back to a browser download.
 */
async function shareToAlbum(blob: Blob, fileName: string): Promise<boolean> {
  if (!supportsAlbumSave()) return false

  const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })
  try {
    await navigator.share({ files: [file] })
    return true
  } catch (err) {
    // User dismissed the sheet — nothing to save. Not an error.
    if (err instanceof DOMException && err.name === 'AbortError') return true
    // Otherwise (e.g. transient user-activation expired) let the caller fall back.
    return false
  }
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
 * Persist an already-generated bordered image: on mobile it goes to the photo
 * album via the share sheet, everywhere else it's a normal browser download.
 */
export async function saveBorderedImage(blob: Blob): Promise<void> {
  const fileName = generateTimestampFileName()
  if (await shareToAlbum(blob, fileName)) return
  downloadBlob(blob, fileName)
}


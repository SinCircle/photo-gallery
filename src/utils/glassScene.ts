// Capture only pixels under the control from measured image rectangles.
// No full-tree DOM rasterisation, observers or EXIF parsing.
import { GLASS_BLUR_PX } from './glassConfig'
const backgrounds = new WeakMap<HTMLElement, { key: string; canvas: HTMLCanvasElement }>()
const rawScenes = new WeakMap<HTMLElement, HTMLCanvasElement>()

// drawImage snaps its outer image rectangle to pixel centres. A photograph
// edge crossing a glyph band can therefore add/remove a whole row at once.
// Paint disjoint pixel-aligned patches through a fractional rectangle clip:
// boundary patches cover full pixels, and the clip supplies their actual area.
function drawCoveredImage(ctx: CanvasRenderingContext2D, media: CanvasImageSource,
  left: number, top: number, right: number, bottom: number,
  imageLeft: number, imageTop: number, scaleX: number, scaleY: number, dpr: number) {
  const cuts = (a: number, b: number) => [...new Set([
    Math.floor(a * dpr) / dpr, Math.ceil(a * dpr) / dpr,
    Math.floor(b * dpr) / dpr, Math.ceil(b * dpr) / dpr,
  ])].sort((x, y) => x - y)
  const xs = cuts(left, right), ys = cuts(top, bottom)
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, right - left, bottom - top)
  ctx.clip()
  for (let row = 1; row < ys.length; row++) for (let col = 1; col < xs.length; col++) {
    const x0 = Math.max(left, xs[col - 1]), x1 = Math.min(right, xs[col])
    const y0 = Math.max(top, ys[row - 1]), y1 = Math.min(bottom, ys[row])
    if (x1 <= x0 || y1 <= y0) continue
    ctx.drawImage(media, (x0 - imageLeft) * scaleX, (y0 - imageTop) * scaleY,
      (x1 - x0) * scaleX, (y1 - y0) * scaleY,
      xs[col - 1], ys[row - 1], xs[col] - xs[col - 1], ys[row] - ys[row - 1])
  }
  ctx.restore()
}

export function captureGlassScene(root: HTMLElement, glass: HTMLElement) {
  const nativeCapsules = glass.hasAttribute('data-capsule-root')
  const rootBox = glass.getBoundingClientRect()
  // Keep the shared region/buffers stable while the capsules appear/disappear.
  // The reserved root contains every visible panel and its motion envelope.
  const box = rootBox
  if (!box.width || !box.height) return null
  const x = box.left - 20, y = box.top - 20
  const width = box.width + 40, height = box.height + 40
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const color = getComputedStyle(document.body).backgroundColor
  const key: unknown[] = [x, y, width, height, dpr, color]
  const paint: Array<(ctx: CanvasRenderingContext2D) => void> = []

  const background = root.querySelector<HTMLElement>('.photoBg')
  const low = root.querySelector<HTMLImageElement>('.photoImgLow')
  if (background && low?.naturalWidth) {
    const rect = background.getBoundingClientRect()
    const css = getComputedStyle(background)
    const after = getComputedStyle(background, '::after')
    const scale = Math.max(rect.width / low.naturalWidth, rect.height / low.naturalHeight)
    const w = low.naturalWidth * scale, h = low.naturalHeight * scale
    const left = rect.x + (rect.width - w) / 2, top = rect.y + (rect.height - h) / 2
    // Four blur radii around the local strip preserve the visible convolution
    // while avoiding a viewport-sized blurred bitmap for a tiny toolbar.
    const pad = Math.ceil(4 * (parseFloat(css.filter.match(/blur\(([^)]+)/)?.[1] || '0') || 0) + 4)
    const backgroundKey = JSON.stringify([low.currentSrc, left, top, w, h, x, y, width, height, dpr, color, css.filter, css.opacity, after.backgroundColor])
    key.push(backgroundKey)
    paint.push(ctx => {
      let cached = backgrounds.get(root)
      if (cached?.key !== backgroundKey) {
        const bitmap = document.createElement('canvas')
        bitmap.width = Math.ceil((width + pad * 2) * dpr)
        bitmap.height = Math.ceil((height + pad * 2) * dpr)
        const buffer = bitmap.getContext('2d', { willReadFrequently: true })!
        buffer.scale(dpr, dpr)
        buffer.fillStyle = color
        buffer.fillRect(0, 0, width + pad * 2, height + pad * 2)
        buffer.globalAlpha = Number(css.opacity)
        buffer.filter = css.filter
        buffer.drawImage(low, left - x + pad, top - y + pad, w, h)
        buffer.filter = 'none'
        buffer.fillStyle = after.backgroundColor
        buffer.fillRect(0, 0, width + pad * 2, height + pad * 2)
        cached = { key: backgroundKey, canvas: bitmap }
        backgrounds.set(root, cached)
      }
      ctx.save()
      ctx.drawImage(cached.canvas, pad * dpr, pad * dpr, width * dpr, height * dpr, 0, 0, width, height)
      ctx.restore()
    })
  }

  for (const image of root.querySelectorAll('img, canvas')) {
    if (glass.contains(image)) continue
    const rect = image.getBoundingClientRect()
    if (rect.right <= x || rect.left >= x + width || rect.bottom <= y || rect.top >= y + height) continue
    if (image instanceof HTMLImageElement && !image.naturalWidth) continue
    const css = getComputedStyle(image)
    if (css.visibility === 'hidden' || Number(css.opacity) === 0) continue
    const tile = image.closest('.tile')
    const opacity = Number(css.opacity) * (tile ? Number(getComputedStyle(tile).opacity) : 1)
    const clip = image.closest<HTMLElement>('.photoStage, .tileMedia')
    const bounds = clip?.getBoundingClientRect()
    const radius = clip ? parseFloat(getComputedStyle(clip).borderRadius) || 0 : 0
    key.push(image instanceof HTMLImageElement ? image.currentSrc : image.outerHTML,
      rect.x, rect.y, rect.width, rect.height, opacity, bounds?.toJSON(), radius)
    paint.push(ctx => {
      ctx.save()
      ctx.globalAlpha = opacity
      if (bounds) {
        ctx.beginPath()
        ctx.roundRect(bounds.x - x, bounds.y - y, bounds.width, bounds.height, radius)
        ctx.clip()
      }
      const media = image as HTMLImageElement | HTMLCanvasElement
      const naturalW = media instanceof HTMLImageElement ? media.naturalWidth : media.width
      const naturalH = media instanceof HTMLImageElement ? media.naturalHeight : media.height
      // Crop in source coordinates before resampling. Downscaling a whole
      // original (often 24MP) just to clip a narrow strip can stall the first
      // interactive frame; only the pixels actually behind the glass are used.
      const left = Math.max(x, rect.left), top = Math.max(y, rect.top)
      const right = Math.min(x + width, rect.right), bottom = Math.min(y + height, rect.bottom)
      drawCoveredImage(ctx, media, left - x, top - y, right - x, bottom - y,
        rect.left - x, rect.top - y, naturalW / rect.width, naturalH / rect.height, dpr)
      ctx.restore()
    })
  }
  return { key: JSON.stringify(key), x, y, width, height, draw: (canvas = document.createElement('canvas')) => {
    if (canvas.width !== Math.ceil(width * dpr)) canvas.width = Math.ceil(width * dpr)
    if (canvas.height !== Math.ceil(height * dpr)) canvas.height = Math.ceil(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    if (nativeCapsules) {
      canvas.style.left = `${x - rootBox.left}px`
      canvas.style.top = `${y - rootBox.top}px`
    }
    let target = canvas
    if (nativeCapsules && GLASS_BLUR_PX > 0) {
      let raw = rawScenes.get(glass)
      if (!raw) { raw = document.createElement('canvas'); rawScenes.set(glass, raw) }
      if (raw.width !== canvas.width) raw.width = canvas.width
      if (raw.height !== canvas.height) raw.height = canvas.height
      target = raw
    }
    const ctx = target.getContext('2d', { willReadFrequently: true })!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    for (const layer of paint) layer(ctx)
    if (target !== canvas) {
      const output = canvas.getContext('2d')!
      output.setTransform(1, 0, 0, 1, 0, 0)
      output.clearRect(0, 0, canvas.width, canvas.height)
      output.filter = `blur(${GLASS_BLUR_PX * dpr}px)`
      output.drawImage(target, 0, 0)
      output.filter = 'none'
    }
    return canvas
  } }
}

// Capture only pixels under the control from measured image rectangles.
// No full-tree DOM rasterisation, observers or EXIF parsing.
const backgrounds = new WeakMap<HTMLElement, { key: string; canvas: HTMLCanvasElement }>()

export function captureGlassScene(root: HTMLElement, glass: HTMLElement) {
  const box = glass.getBoundingClientRect()
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
    const left = rect.x + (rect.width - w) / 2 - x, top = rect.y + (rect.height - h) / 2 - y
    key.push(low.currentSrc, left, top, w, h, css.filter, css.opacity, after.backgroundColor)
    const backgroundKey = JSON.stringify(key)
    paint.push(ctx => {
      let cached = backgrounds.get(root)
      if (cached?.key !== backgroundKey) {
        const bitmap = document.createElement('canvas')
        bitmap.width = Math.ceil(width * dpr)
        bitmap.height = Math.ceil(height * dpr)
        const buffer = bitmap.getContext('2d')!
        buffer.scale(dpr, dpr)
        buffer.fillStyle = color
        buffer.fillRect(0, 0, width, height)
        buffer.globalAlpha = Number(css.opacity)
        buffer.filter = css.filter
        buffer.drawImage(low, left, top, w, h)
        buffer.filter = 'none'
        buffer.fillStyle = after.backgroundColor
        buffer.fillRect(0, 0, width, height)
        cached = { key: backgroundKey, canvas: bitmap }
        backgrounds.set(root, cached)
      }
      ctx.save()
      ctx.drawImage(cached.canvas, 0, 0, width, height)
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
      ctx.drawImage(image as HTMLImageElement | HTMLCanvasElement, rect.x - x, rect.y - y, rect.width, rect.height)
      ctx.restore()
    })
  }
  return { key: JSON.stringify(key), x, y, width, height, draw: () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
    canvas.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px;`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    for (const layer of paint) layer(ctx)
    return canvas
  } }
}

// Capture only pixels under the control from measured image rectangles.
// No full-tree DOM rasterisation, observers or EXIF parsing.
export function captureGlassScene(root: HTMLElement, glass: HTMLElement) {
  const box = glass.getBoundingClientRect()
  if (!box.width || !box.height) return null
  const x = box.left - 20, y = box.top - 20
  const width = box.width + 40, height = box.height + 40
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * dpr)
  canvas.height = Math.ceil(height * dpr)
  canvas.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px;`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor
  ctx.fillRect(0, 0, width, height)
  const key: unknown[] = [x, y, width, height, dpr, ctx.fillStyle]

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
    ctx.save()
    ctx.globalAlpha = Number(css.opacity)
    ctx.filter = css.filter
    ctx.drawImage(low, left, top, w, h)
    ctx.filter = 'none'
    ctx.fillStyle = after.backgroundColor
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }

  for (const image of root.querySelectorAll('img, canvas')) {
    if (glass.contains(image)) continue
    const rect = image.getBoundingClientRect()
    if (rect.right <= x || rect.left >= x + width || rect.bottom <= y || rect.top >= y + height) continue
    if (image instanceof HTMLImageElement && !image.naturalWidth) continue
    const css = getComputedStyle(image)
    if (css.visibility === 'hidden' || Number(css.opacity) === 0) continue
    key.push(image instanceof HTMLImageElement ? image.currentSrc : image.outerHTML,
      rect.x, rect.y, rect.width, rect.height, css.opacity)
    ctx.save()
    ctx.globalAlpha = Number(css.opacity)
    const clip = image.closest<HTMLElement>('.photoStage, .tileMedia')
    if (clip) {
      const bounds = clip.getBoundingClientRect()
      ctx.beginPath()
      ctx.roundRect(bounds.x - x, bounds.y - y, bounds.width, bounds.height,
        parseFloat(getComputedStyle(clip).borderRadius) || 0)
      ctx.clip()
    }
    ctx.drawImage(image as HTMLImageElement | HTMLCanvasElement, rect.x - x, rect.y - y, rect.width, rect.height)
    ctx.restore()
  }
  return { canvas, key: JSON.stringify(key), x, y, width, height }
}

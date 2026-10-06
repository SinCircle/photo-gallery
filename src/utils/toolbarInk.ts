export const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
export const srgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055
export const contrast = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
export const veiled = (y: number) => linear(.9 * srgb(y) + .1)
const channels = Float64Array.from({ length: 256 }, (_, i) => linear(i / 255))
const luminance = (data: Uint8ClampedArray, p: number) =>
  .2126 * channels[data[p]] + .7152 * channels[data[p + 1]] + .0722 * channels[data[p + 2]]

// Read at the scene's native resolution. Each source pixel contributes its
// actual intersection area, including fractional top/bottom and bin boundaries.
// drawImage(..., 24, 1) is interpolation, not an area integral.
export function sampleInkBand(scene: HTMLCanvasElement, band: { left: number, top: number, right: number, bottom: number }, count: number) {
  const box = scene.getBoundingClientRect()
  const sx = scene.width / box.width, sy = scene.height / box.height
  const left = Math.max(0, (band.left - box.left) * sx)
  const right = Math.min(scene.width, (band.right - box.left) * sx)
  const top = Math.max(0, (band.top - box.top) * sy)
  const bottom = Math.min(scene.height, (band.bottom - box.top) * sy)
  if (right <= left || bottom <= top) return
  const x = Math.floor(left), y = Math.floor(top)
  const width = Math.ceil(right) - x, height = Math.ceil(bottom) - y
  const data = scene.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, width, height).data
  const columns = new Float64Array(width)
  for (let row = 0; row < height; row++) {
    const weight = Math.min(y + row + 1, bottom) - Math.max(y + row, top)
    for (let col = 0; col < width; col++) columns[col] += weight * luminance(data, (row * width + col) * 4)
  }
  const sampled = Array.from({ length: count }, (_, i) => {
    const a = left + i * (right - left) / count, b = left + (i + 1) * (right - left) / count
    let sum = 0
    for (let col = Math.floor(a); col < Math.ceil(b); col++) {
      sum += columns[col - x] * (Math.min(col + 1, b) - Math.max(col, a))
    }
    return sum / ((b - a) * (bottom - top))
  })
  return { sampled, data, x, y, width, height, sx, sy, box }
}

// A continuous, per-position response. A hard light/dark threshold necessarily
// jumps even with perfect sampling. The transition needs outline support where
// the fill alone cannot reach the contrast floor; never average neighbouring inks.
export function inkForBackdrop(y: number) {
  if (y <= .1) return 255 * srgb(Math.min(1, 9.5 * (y + .05) - .05))
  if (y >= .3) return 255 * srgb(Math.max(0, (y + .05) / 9.5 - .05))
  const t = (y - .1) / .2
  return 255 * (1 - t * t * (3 - 2 * t))
}

export function backdropAt(sampled: number[], fraction: number) {
  const t = Math.max(0, Math.min(sampled.length - 1, fraction * sampled.length - .5))
  const low = Math.floor(t), high = Math.min(sampled.length - 1, low + 1)
  return veiled(sampled[low] + (sampled[high] - sampled[low]) * (t - low))
}

export { luminance }

export function attachToolbarInk(root: HTMLElement, bar: HTMLElement, signal: AbortSignal) {
  const filters = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  filters.setAttribute('width', '0')
  filters.setAttribute('height', '0')
  filters.setAttribute('aria-hidden', 'true')
  filters.style.position = 'absolute'
  // Subtract the original alpha, so this layer contains ONLY the outline.
  // Painting a complete stroked clone behind background-clip:text can still
  // tint nearly opaque antialiased core pixels by one channel value.
  filters.innerHTML = `<defs><filter id="dock-outline-ring" x="-10%" y="-50%" width="120%" height="200%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="outer"/>
    <feMorphology in="SourceAlpha" operator="dilate" radius=".5" result="inner"/>
    <feComposite in="outer" in2="inner" operator="out" result="outerRing"/>
    <feComposite in="inner" in2="SourceAlpha" operator="out" result="innerRing"/>
    <feFlood flood-color="white"/><feComposite in2="outerRing" operator="in" result="whiteRing"/>
    <feFlood flood-color="black"/><feComposite in2="innerRing" operator="in" result="blackRing"/>
    <feMerge><feMergeNode in="whiteRing"/><feMergeNode in="blackRing"/></feMerge>
  </filter></defs>`
  root.append(filters)
  const readInk = () => {
    const barBox = bar.getBoundingClientRect()
    if (!barBox.width) return
    const targets = [...bar.querySelectorAll<HTMLElement>('.dockAction, .dockMetaItem')]
    for (const target of targets) {
      const glyph = target.querySelector<HTMLElement>('.capsuleLabel') || target
      if (glyph.querySelector('.dockFill')) continue
      const text = glyph.textContent || ''
      const fill = document.createElement('span')
      fill.className = 'dockFill'
      fill.textContent = text
      const outline = document.createElement('span')
      outline.className = 'dockOutline'
      outline.dataset.label = text
      outline.setAttribute('aria-hidden', 'true')
      glyph.classList.add('dockGlyph')
      glyph.replaceChildren(outline, fill)
    }
    const textBoxes = targets.map(target => {
      const range = document.createRange()
      range.selectNodeContents(target.querySelector('.dockFill')!)
      return range.getBoundingClientRect()
    }).filter(box => box.width && box.height)
    const expanded = root.dataset.toolbar === 'expanded'
    const band = {
      left: barBox.left, right: barBox.right,
      top: expanded && textBoxes.length ? Math.max(barBox.top, Math.min(...textBoxes.map(b => b.top))) : barBox.top + barBox.height / 2 - 3,
      bottom: expanded && textBoxes.length ? Math.min(barBox.bottom, Math.max(...textBoxes.map(b => b.bottom))) : barBox.top + barBox.height / 2 + 3,
    }
    const scene = root.querySelector<HTMLCanvasElement>('canvas[data-glass-scene]')
    // Before the thumbnail loads the scene is empty, but the visible backdrop
    // is the page. Apply the same response to that colour, never to empty black.
    const ready = !!document.querySelector<HTMLImageElement>('.photoImgLow')?.naturalWidth
    const strip = ready && scene?.width ? sampleInkBand(scene, band, 24) : undefined
    const bg = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) || [244, 244, 244]
    const pageLuma = .2126 * linear(bg[0] / 255) + .7152 * linear(bg[1] / 255) + .0722 * linear(bg[2] / 255)
    const sampled = strip?.sampled || Array<number>(24).fill(pageLuma)
    const values = Array.from({ length: 48 }, (_, i) => inkForBackdrop(backdropAt(sampled, i / 47)))
    const stops = values.map((v, i) => `rgb(${v.toFixed(3)},${v.toFixed(3)},${v.toFixed(3)}) ${(i / 47 * 100).toFixed(4)}%`)
    bar.style.setProperty('--dock-ink-gradient', `linear-gradient(90deg, ${stops.join(', ')})`)
    bar.style.setProperty('--dock-ink-size', `${barBox.width}px 100%`)
    bar.dataset.tone = backdropAt(sampled, .5) < .18 ? 'dark' : 'light'
    bar.dataset.ink = 'gradient'
    const dotInk = inkForBackdrop(backdropAt(sampled, .5)).toFixed(3)
    bar.style.setProperty('--dock-dot-ink', `rgb(${dotInk},${dotInk},${dotInk})`)
    const labels = []
    for (const [index, target] of targets.entries()) {
      const fill = target.querySelector<HTMLElement>('.dockFill')!
      const box = fill.getBoundingClientRect()
      fill.style.backgroundPosition = `${-(box.left - barBox.left)}px 0`
      // Test local pixels, not the average of a label (which hides failing
      // strokes on a hard edge). Keep each label's own vertical text range.
      let minimum = Infinity
      if (strip && expanded) {
        const text = textBoxes[index]
        if (text) for (let row = 0; row < strip.height; row++) {
          const py = strip.box.top + (strip.y + row + .5) / strip.sy
          if (py < text.top || py > text.bottom) continue
          for (let col = 0; col < strip.width; col++) {
            const px = strip.box.left + (strip.x + col + .5) / strip.sx
            if (px < Math.max(box.left, barBox.left) || px > Math.min(box.right, barBox.right)) continue
            const t = Math.max(0, Math.min(47, (px - barBox.left) / barBox.width * 47))
            const low = Math.floor(t), high = Math.min(47, low + 1)
            const ink = linear((values[low] + (values[high] - values[low]) * (t - low)) / 255)
            const backdrop = veiled(luminance(strip.data, (row * strip.width + col) * 4))
            minimum = Math.min(minimum, contrast(ink, backdrop))
          }
        }
      }
      target.toggleAttribute('data-halo', minimum < 5)
      labels.push({ text: fill.textContent, minimum, halo: minimum < 5 })
    }
    // The probe listens to this event to check the real sampler against an
    // independent pixel-area oracle, rather than duplicating our algorithm.
    bar.dispatchEvent(new CustomEvent('dockink', { bubbles: true, detail: { sampled, values, band, labels, source: strip ? 'photo' : 'page' } }))
  }
  // Consume each new scene immediately; a 480ms polling window otherwise turns
  // even a continuous colour function into visible steps during a live drag.
  root.addEventListener('glassscene', readInk, { signal })
  return readInk
}

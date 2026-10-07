import { captureGlassScene } from './glassScene'
import { EASE_IN_OUT, EASE_OUT } from './motion'

export const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
export const srgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055
export const contrast = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
export const veiled = (y: number, veil = .1) => linear((1 - veil) * srgb(y) + veil)
const channels = Float64Array.from({ length: 256 }, (_, i) => linear(i / 255))
const luminance = (data: Uint8ClampedArray, p: number) =>
  .2126 * channels[data[p]] + .7152 * channels[data[p + 1]] + .0722 * channels[data[p + 2]]
type InkBand = { left: number; top: number; right: number; bottom: number }
type InkPixels = { data: Uint8ClampedArray; x: number; y: number; stride: number; box: DOMRect }

function readInkPixels(scene: HTMLCanvasElement, bands: InkBand[]): InkPixels | undefined {
  const box = scene.getBoundingClientRect()
  const sx = scene.width / box.width, sy = scene.height / box.height
  const x = Math.max(0, Math.floor((Math.min(...bands.map(b => b.left)) - box.left) * sx))
  const y = Math.max(0, Math.floor((Math.min(...bands.map(b => b.top)) - box.top) * sy))
  const right = Math.min(scene.width, Math.ceil((Math.max(...bands.map(b => b.right)) - box.left) * sx))
  const bottom = Math.min(scene.height, Math.ceil((Math.max(...bands.map(b => b.bottom)) - box.top) * sy))
  if (right <= x || bottom <= y) return
  return { data: scene.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, right - x, bottom - y).data,
    x, y, stride: (right - x) * 4, box }
}

// Read at the scene's native resolution. Each source pixel contributes its
// actual intersection area, including fractional top/bottom and bin boundaries.
// drawImage(..., 24, 1) is interpolation, not an area integral.
export function sampleInkBand(scene: HTMLCanvasElement, band: InkBand, count: number, pixels?: InkPixels, extrema = false) {
  const box = pixels?.box ?? scene.getBoundingClientRect()
  const sx = scene.width / box.width, sy = scene.height / box.height
  const left = Math.max(0, (band.left - box.left) * sx)
  const right = Math.min(scene.width, (band.right - box.left) * sx)
  const top = Math.max(0, (band.top - box.top) * sy)
  const bottom = Math.min(scene.height, (band.bottom - box.top) * sy)
  if (right <= left || bottom <= top) return
  const x = Math.floor(left), y = Math.floor(top)
  const width = Math.ceil(right) - x, height = Math.ceil(bottom) - y
  const data = pixels?.data ?? scene.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, width, height).data
  const stride = pixels?.stride ?? width * 4
  const offset = pixels ? (y - pixels.y) * stride + (x - pixels.x) * 4 : 0
  const columns = new Float64Array(width)
  const low = extrema ? new Float64Array(width).fill(Infinity) : undefined
  const high = extrema ? new Float64Array(width).fill(-Infinity) : undefined
  for (let row = 0; row < height; row++) {
    const weight = Math.min(y + row + 1, bottom) - Math.max(y + row, top)
    for (let col = 0, p = offset + row * stride; col < width; col++, p += 4) {
      const value = luminance(data, p)
      columns[col] += weight * value
      if (low && high) {
        if (value < low[col]) low[col] = value
        if (value > high[col]) high[col] = value
      }
    }
  }
  const sampled = Array.from({ length: count }, (_, i) => {
    const a = left + i * (right - left) / count, b = left + (i + 1) * (right - left) / count
    let sum = 0
    for (let col = Math.floor(a); col < Math.ceil(b); col++) {
      sum += columns[col - x] * (Math.min(col + 1, b) - Math.max(col, a))
    }
    return sum / ((b - a) * (bottom - top))
  })
  return { sampled, data, x, y, width, height, sx, sy, box, stride, offset, low, high }
}

// Keep the fill crisp. Mid-tone glass favours white, with local dark support;
// bright glass uses black. Hysteresis avoids toggling around a single threshold.
// Blending these two choices would produce grey with almost no contrast.
export function inkForBackdrop(y: number, previous?: number) {
  const threshold = previous === 255 ? .30 : previous === 0 ? .24 : .27
  return y <= threshold ? 255 : 0
}

export function backdropAt(sampled: number[], fraction: number, veil = .1) {
  const t = Math.max(0, Math.min(sampled.length - 1, fraction * sampled.length - .5))
  const low = Math.floor(t), high = Math.min(sampled.length - 1, low + 1)
  return veiled(sampled[low] + (sampled[high] - sampled[low]) * (t - low), veil)
}

export { luminance }

// White contrast decreases with luminance; black contrast increases. Preserve
// the exact per-pixel minima by converting just each cell's extrema. Walking
// the RGBA buffer in row order also avoids strided reads through tall bands.
const veilTables = new Map<number, Float64Array>()
export function cellContrastMinima(strip: NonNullable<ReturnType<typeof sampleInkBand>>, left: number, width: number, count: number, veil: number) {
  const low = new Float64Array(count).fill(Infinity)
  const high = new Float64Array(count).fill(-Infinity)
  const cells = new Uint32Array(strip.width)
  for (let col = 0; col < strip.width; col++) {
    const px = strip.box.left + (strip.x + col + .5) / strip.sx
    cells[col] = Math.min(count - 1, Math.floor(clamp((px - left) / width) * count))
  }
  if (strip.low && strip.high) {
    for (let col = 0; col < strip.width; col++) {
      const cell = cells[col]
      if (strip.low[col] < low[cell]) low[cell] = strip.low[col]
      if (strip.high[col] > high[cell]) high[cell] = strip.high[col]
    }
  } else {
    for (let row = 0; row < strip.height; row++) {
      for (let col = 0, p = strip.offset + row * strip.stride; col < strip.width; col++, p += 4) {
        const y = luminance(strip.data, p), cell = cells[col]
        if (y < low[cell]) low[cell] = y
        if (y > high[cell]) high[cell] = y
      }
    }
  }
  let lookup = veilTables.get(veil)
  if (!lookup) { lookup = Float64Array.from({ length: 4097 }, (_, i) => veiled(i / 4096, veil)); veilTables.set(veil, lookup) }
  const whiteMinima = new Float64Array(count).fill(Infinity)
  const blackMinima = new Float64Array(count).fill(Infinity)
  for (let cell = 0; cell < count; cell++) {
    if (low[cell] === Infinity) continue
    whiteMinima[cell] = contrast(1, lookup[Math.round(high[cell] * 4096)])
    blackMinima[cell] = contrast(0, lookup[Math.round(low[cell] * 4096)])
  }
  return { whiteMinima, blackMinima }
}
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t) }
type MaskState = { from: [number[], number[]]; to: [number[], number[]]; fade?: Animation }

export function attachToolbarInk(root: HTMLElement, bar: HTMLElement, signal: AbortSignal) {
  let fallback: HTMLCanvasElement | undefined
  let pending = 0
  let lastMotionSample = -Infinity
  const tones = new WeakMap<HTMLElement, number>()
  const paintedTones = new WeakMap<HTMLElement, number>()
  const fades = new Map<HTMLElement, Animation>()
  const masks: MaskState[] = []
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const cancelFades = () => {
    for (const fade of fades.values()) fade.cancel()
    fades.clear()
    for (const mask of masks) { mask.fade?.cancel(); mask.fade = undefined }
  }
  reduced.addEventListener('change', () => { if (reduced.matches) cancelFades() }, { signal })
  const set = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
  }
  const readTone = (element: HTMLElement, ink: number, key = element) =>
    paintedTones.get(key) !== ink && element.style.getPropertyValue('--dock-tone')
      ? getComputedStyle(element).getPropertyValue('--dock-tone') : String(ink)
  const paintTone = (element: HTMLElement, ink: number, current: string, key = element) => {
    if (paintedTones.get(key) === ink) return
    paintedTones.set(key, ink)
    const previous = element.style.getPropertyValue('--dock-tone')
    fades.get(key)?.cancel()
    set(element, '--dock-tone', String(ink))
    if (previous && !reduced.matches) {
      const fade = element.animate([{ '--dock-tone': current }, { '--dock-tone': String(ink) }],
        { duration: 420, easing: EASE_IN_OUT, fill: 'backwards' })
      fades.set(key, fade)
      void fade.finished.catch(() => {}).then(() => {
        if (fades.get(key) === fade) { fades.delete(key); schedule() }
      })
    }
  }
  const readInk = () => {
    cancelAnimationFrame(pending)
    pending = 0
    if (signal.aborted || !root.isConnected || root.closest('.photoShell[data-entering]')) return
    // The geometry and glass keep their full-rate animation. Colour/support
    // already interpolate for 280–420ms, so resampling them every geometry
    // frame only invalidates the same styles again before that fade can move.
    const now = performance.now()
    if (root.dataset.moving !== undefined && bar.dataset.ink && now - lastMotionSample < 80) return
    lastMotionSample = now
    const expanded = root.dataset.toolbar === 'expanded'
    // Prepare glyph nodes while the loading capsule is still closed, rather
    // than adding every shadow/fill at the first visible expansion frame.
    const allTargets = [...bar.querySelectorAll<HTMLElement>('.dockAction, .dockMetaItem')]
    const allFills = allTargets.map(target => {
      const glyph = target.querySelector<HTMLElement>('.capsuleLabel') || target
      let fill = glyph.querySelector<HTMLElement>('.dockFill')
      if (!fill) {
        const text = glyph.textContent || ''
        fill = document.createElement('span')
        fill.className = 'dockFill'
        fill.textContent = text
        const shadow = document.createElement('span')
        shadow.className = 'dockShadow'
        shadow.dataset.label = text
        shadow.setAttribute('aria-hidden', 'true')
        glyph.classList.add('dockGlyph')
        glyph.replaceChildren(shadow, fill)
      }
      return fill
    })
    // Automatic dark themes can recolour CSS backgrounds after sampling. Tiny
    // static bitmaps preserve the chosen ink; only their CSS opacity changes.
    for (const dot of bar.querySelectorAll<HTMLElement>('.capsuleDots i, .capsuleDot')) {
      if (dot.querySelector('.dockDotInk')) continue
      for (const ink of [0, 255]) {
        const canvas = document.createElement('canvas')
        canvas.className = `dockDotInk${ink ? ' dockDotLight' : ''}`
        canvas.width = canvas.height = 1
        canvas.setAttribute('aria-hidden', 'true')
        const context = canvas.getContext('2d')!
        context.fillStyle = ink ? '#fff' : '#000'
        context.fillRect(0, 0, 1, 1)
        dot.append(canvas)
      }
    }
    const targets = expanded ? allTargets : []
    const fills = expanded ? allFills : []
    // Finish DOM writes before taking all geometry reads together.
    const barBox = bar.getBoundingClientRect()
    if (!barBox.width) return
    const boxes = fills.map(fill => fill.getBoundingClientRect())
    const dots = [...bar.querySelectorAll<HTMLElement>('.capsuleDots, .capsuleDot')]
    const dotBands = dots.map(dot => {
      const box = dot.getBoundingClientRect()
      // The loader travels across 56px even when its absolute container fills
      // the expanded bar. Sample its actual path, never that container's width.
      const halfWidth = dot.classList.contains('capsuleDot') ? 3 : 28
      const x = box.left + box.width / 2, y = box.top + box.height / 2
      return { left: Math.max(barBox.left, x - halfWidth), right: Math.min(barBox.right, x + halfWidth), top: y - 3, bottom: y + 3 }
    })
    const visible = boxes.filter(box => box.width && box.height)
    const bandFor = (visible: DOMRect[]) => ({
      left: barBox.left, right: barBox.right,
      top: expanded && visible.length ? Math.max(barBox.top, Math.min(...visible.map(b => b.top))) : barBox.top + barBox.height / 2 - 3,
      bottom: expanded && visible.length ? Math.min(barBox.bottom, Math.max(...visible.map(b => b.bottom))) : barBox.top + barBox.height / 2 + 3,
    })
    const band = bandFor(visible)
    const twoRows = expanded && matchMedia('(max-width: 560px)').matches
    const rowFor = (i: number) => twoRows && targets[i].matches('.dockMetaItem') ? 1 : 0
    const bands = twoRows ? [0, 1].map(row => bandFor(boxes.filter((box, i) => rowFor(i) === row && box.width && box.height))) : [band]
    const scene = root.querySelector<HTMLCanvasElement>('canvas[data-glass-scene]')
    const nativeReady = scene?.dataset.ready !== undefined
    // A temporary CSS source must not remain a second native scene contributor.
    if (nativeReady && fallback) { fallback.remove(); fallback = undefined }
    const ready = !!root.closest('.photoShell')?.querySelector<HTMLImageElement>('.photoImgLow')?.naturalWidth
    let source = nativeReady ? scene : undefined
    if (ready && !nativeReady) {
      if (!fallback) {
        fallback = document.createElement('canvas')
        fallback.getContext('2d', { willReadFrequently: true })
        fallback.style.cssText = 'position:absolute;opacity:0;pointer-events:none'
        root.append(fallback)
      }
      const shell = root.closest<HTMLElement>('.photoShell')
      if (shell) source = captureGlassScene(shell, root)?.draw(fallback)
    }
    // All bands share one native-resolution readback; their fractional area
    // integrals and extrema still use the original source pixels.
    const pixels = ready && source?.width ? readInkPixels(source, [...bands, ...dotBands]) : undefined
    const strips = bands.map(band => pixels && source ? sampleInkBand(source, band, expanded ? 24 : 1, pixels, expanded) : undefined)
    const strip = strips[0]
    const veil = nativeReady && root.dataset.glass === 'webgl' ? .1 : .415
    const bg = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) || [244, 244, 244]
    const pageLuma = .2126 * linear(bg[0] / 255) + .7152 * linear(bg[1] / 255) + .0722 * linear(bg[2] / 255)
    const samples = strips.map(strip => strip?.sampled || Array<number>(expanded ? 24 : 1).fill(pageLuma))
    const sampled = samples[0]
    const chooseRegion = (element: HTMLElement, region: number[]) => {
      region.sort((a, b) => a - b)
      const ink = inkForBackdrop(region[Math.floor(region.length / 2)], tones.get(element))
      tones.set(element, ink)
      return ink
    }
    const choose = (element: HTMLElement, left: number, right: number, row = 0) => {
      // A small bright/dark patch must not flip an entire label. The median
      // chooses its main fill; per-cell contrast below handles the exceptions.
      const region = Array.from({ length: 11 }, (_, i) => backdropAt(samples[row],
        ((left + (right - left) * (i + .5) / 11) - barBox.left) / barBox.width, veil))
      return chooseRegion(element, region)
    }
    const dotInk = choose(bar, barBox.left, barBox.right)
    const tone = dotInk === 255 ? 'dark' : 'light'
    // Each icon samples its own position, including the lower mobile row.
    // Reuse the letters' hysteresis and interrupted colour fade. No timer or
    // animation-frame loop is added to the compositor-driven loading motion.
    const dotSamples = dotBands.map(band => pixels && source && band.right > band.left ? sampleInkBand(source, band, 11, pixels)?.sampled : undefined)
    const dotValues = dots.map((dot, i) => chooseRegion(dot,
      (dotSamples[i] || Array<number>(11).fill(pageLuma)).map(y => veiled(y, veil))))
    const values = fills.map((fill, i) => choose(fill, boxes[i].left, boxes[i].right, rowFor(i)))
    // Snapshot interrupted animations before changing any tone or mask. Reading
    // computed styles between individual writes repeatedly recalculated the
    // toolbar's inherited gradients during the first expansion.
    const dotTones = dots.map((dot, i) => readTone(dot, dotValues[i]))
    const fillTones = fills.map((fill, i) => readTone(fill.parentElement!, values[i], fill))
    const maskProgress = masks.map(state => state.fade?.effect?.getComputedTiming().progress ?? 1)
    if (bar.dataset.tone !== tone) bar.dataset.tone = tone
    dots.forEach((dot, i) => paintTone(dot, dotValues[i], dotTones[i]))
    const labels: { text: string | null; halo: boolean; ink: number }[] = []
    if (expanded) {
      if (bar.dataset.ink !== 'binary') bar.dataset.ink = 'binary'
      // Scan each local pixel ONCE for the whole bar, in small spatial cells.
      // A failing patch enables only that patch's opposite-colour soft shadow.
      // No label-wide outline and no per-frame PNG encoding are needed.
      const count = Math.max(1, Math.ceil(barBox.width / 6))
      const fields = strips.map((strip, rowIndex) => {
        const { whiteMinima, blackMinima } = strip ? cellContrastMinima(strip, barBox.left, barBox.width, count, veil)
          : { whiteMinima: new Float64Array(count).fill(Infinity), blackMinima: new Float64Array(count).fill(Infinity) }
        const dark: number[] = [], light: number[] = []
        for (let i = 0; i < count; i++) {
          dark.push(smooth((5 - whiteMinima[i]) / 2))
          light.push(smooth((5 - blackMinima[i]) / 2))
        }
        // Two continuous axes: scene changes interpolate the local support field;
        // ink changes interpolate polarity using exactly the letters' tone. A
        // single inherited progress animation replaces hundreds of cell timers.
        const resample = (field: number[], i: number) => {
          const x = clamp((i + .5) / count) * field.length - .5
          const a = Math.max(0, Math.min(field.length - 1, Math.floor(x)))
          const b = Math.max(0, Math.min(field.length - 1, Math.ceil(x)))
          return field[a] + (field[b] - field[a]) * (x - Math.floor(x))
        }
        const state = masks[rowIndex]
        const progressProperty = rowIndex === 0 ? '--dock-shadow-progress' : '--dock-meta-shadow-progress'
        const maskTo = state?.to
        const changed = !maskTo || maskTo[0].length !== count || dark.some((v, i) => Math.abs(v - maskTo[0][i]) > .005) ||
          light.some((v, i) => Math.abs(v - maskTo[1][i]) > .005)
        if (changed) {
          const progress = maskProgress[rowIndex] ?? 1
          const previous = maskTo
          const current = previous && state ? state.from.map((field, j) => Array.from({ length: count }, (_, i) =>
            resample(field, i) * (1 - progress) + resample(previous[j], i) * progress)) as [number[], number[]] : [dark, light] as [number[], number[]]
          state?.fade?.cancel()
          const next: MaskState = masks[rowIndex] = { from: current, to: [dark, light] }
          const differs = current.some((field, row) => field.some((v, i) => Math.abs(v - next.to[row][i]) > .005))
          if (previous && differs && !reduced.matches) {
            next.fade = bar.animate([{ [progressProperty]: 0 }, { [progressProperty]: 1 }],
              { duration: 280, easing: EASE_OUT })
          }
        }
        return { whiteMinima, blackMinima, mask: masks[rowIndex], progressProperty }
      })
      for (const [i, fill] of fills.entries()) {
        const box = boxes[i]
        const white = values[i] === 255
        const glyph = fill.parentElement!
        paintTone(glyph, values[i], fillTones[i], fill)
        const { whiteMinima, blackMinima, mask, progressProperty } = fields[rowFor(i)]
        // Each label needs only the cells touching its own ink. Duplicating the
        // whole bar's calc-heavy gradient on every label caused style/layout
        // stalls during the first expansion (especially on narrow screens).
        const first = Math.max(0, Math.floor((box.left - 3 - barBox.left) / barBox.width * count) - 1)
        const last = Math.min(count, Math.ceil((box.right + 3 - barBox.left) / barBox.width * count) + 1)
        const stops: { color: string; position: number }[] = []
        const mix = (a: number, b: number) => Math.abs(a - b) < .0001 ? a.toFixed(4)
          : `(${a.toFixed(4)} + (${(b - a).toFixed(4)}) * var(${progressProperty}))`
        for (let cell = first; cell < last; cell++) {
          const black = mix(mask.from[1][cell], mask.to[1][cell]), inverse = mix(mask.from[0][cell], mask.to[0][cell])
          const alpha = black === inverse ? black
            : black === '0.0000' ? `(${inverse} * var(--dock-tone) / 255)`
            : inverse === '0.0000' ? `(${black} * (1 - var(--dock-tone) / 255))`
            : `(${black} * (1 - var(--dock-tone) / 255) + ${inverse} * var(--dock-tone) / 255)`
          const color = `rgb(0 0 0 / calc(${alpha}))`
          const position = ((cell + .5) / count * barBox.width - (box.left - 3 - barBox.left)) / (box.width + 6) * 100
          stops.push({ color, position })
        }
        const compact = stops.filter((stop, i) => !i || i === stops.length - 1 ||
          stop.color !== stops[i - 1].color || stop.color !== stops[i + 1].color)
        const maskImage = compact.length > 1 ?
          `linear-gradient(90deg,${compact.map(stop => `${stop.color} ${stop.position.toFixed(3)}%`).join(',')})` : 'linear-gradient(transparent,transparent)'
        const a = Math.max(0, Math.floor((box.left - barBox.left) / barBox.width * count))
        const z = Math.min(count, Math.ceil((box.right - barBox.left) / barBox.width * count))
        const halo = fades.has(fill) || (white ? whiteMinima : blackMinima).slice(a, z).some(v => v < 5)
        if (targets[i].hasAttribute('data-halo') !== halo) targets[i].toggleAttribute('data-halo', halo)
        for (const shadow of glyph.querySelectorAll<HTMLElement>('.dockShadow')) {
          // Only this element consumes the gradient. An inherited custom
          // property made every text descendant resolve its many calc/var
          // stops again on each animated progress update.
          set(shadow, 'mask-image', maskImage)
          if (shadow.dataset.label !== fill.textContent) shadow.dataset.label = fill.textContent || ''
        }
        labels.push({ text: fill.textContent, halo, ink: values[i] })
      }
    }
    bar.dispatchEvent(new CustomEvent('dockink', { bubbles: true, detail: { sampled, values, band, labels, veil, source: strip ? nativeReady ? 'photo' : 'fallback-photo' : 'page' } }))
  }
  const schedule = () => { if (!pending && !signal.aborted) pending = requestAnimationFrame(readInk) }
  // Scene changes drive sampling. Text, font and scroll changes need their own
  // invalidation; an unchanged, idle toolbar needs no polling at all.
  root.addEventListener('glassscene', readInk, { signal })
  bar.addEventListener('scroll', schedule, { capture: true, passive: true, signal })
  window.addEventListener('resize', schedule, { passive: true, signal })
  document.fonts.addEventListener('loadingdone', schedule, { signal })
  const content = new MutationObserver(schedule)
  content.observe(bar, { childList: true, subtree: true, characterData: true })
  signal.addEventListener('abort', () => { content.disconnect(); cancelAnimationFrame(pending); fallback?.remove(); cancelFades() }, { once: true })
  return readInk
}

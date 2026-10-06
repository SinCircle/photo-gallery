import { originalUrl, webUrl, type Photo } from '../photos'

// Decode off-DOM and keep the current image visible until its replacement is
// ready. Show the display-sized preview first, then always fetch the original;
// the readiness callback belongs to the original (or an explicit error state).
export function attachPhotoImage(photo: Photo, image: HTMLImageElement, stage: HTMLElement,
  signal: AbortSignal, ready: () => void, status: (failed: boolean) => void) {
  const original = originalUrl(photo)
  const display = webUrl(photo)
  let started = false, busy = false, full = false, failed = false
  let displayPixels = 0, loadedPixels = 0
  let timer = 0, fadeTimer = 0, quietTimer = 0, quietUntil = 0
  let releaseQuiet: (() => void) | undefined
  let paintFrame = 0, releasePaint: (() => void) | undefined
  let pending: HTMLImageElement | undefined

  const load = async (url: string) => {
    if (signal.aborted || busy) return
    busy = true
    const candidate = new Image()
    candidate.decoding = 'async'
    pending = candidate
    try {
      candidate.src = url
      await candidate.decode()
      while (!signal.aborted && performance.now() < quietUntil) {
        await new Promise<void>(resolve => {
          releaseQuiet = resolve
          quietTimer = window.setTimeout(resolve, quietUntil - performance.now())
        })
      }
      if (signal.aborted) return
      image.src = url
      // The off-DOM decode alone does not mean the visible image has painted.
      // Let the replacement decode and commit its first frame before the
      // completion callback starts the toolbar's layout/glass animation.
      await image.decode()
      if (signal.aborted) return
      loadedPixels = candidate.naturalWidth
      full = url === original
      failed = false
      status(false)
      stage.classList.add('hiReady')
      fadeTimer = window.setTimeout(() => {
        if (!signal.aborted) stage.classList.add('hiDone')
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320)
      // The display-sized derivative is only a preview. Keep the loading
      // indicator active until the original has also decoded successfully.
      if (full) {
        await new Promise<void>(resolve => {
          releasePaint = resolve
          paintFrame = requestAnimationFrame(() => {
            paintFrame = requestAnimationFrame(() => { paintFrame = 0; releasePaint = undefined; resolve() })
          })
        })
        if (!signal.aborted) ready()
      }
    } catch {
      if (signal.aborted) return
      if (url !== original && !loadedPixels) {
        busy = false
        void load(original)
        return
      }
      failed = true
      status(true)
      // A failed image must not trap the user inside an endless loading pill.
      ready()
    } finally {
      if (pending === candidate) {
        pending = undefined; busy = false
        if (!failed && !full && loadedPixels) defer(200)
      }
    }
  }
  const request = () => {
    timer = 0
    if (!started || signal.aborted || busy || failed) return
    if (!loadedPixels) void load(display)
    else if (!full) void load(original)
  }
  const defer = (delay = 350) => {
    quietUntil = Math.max(quietUntil, performance.now() + delay)
    clearTimeout(timer)
    if (started && !signal.aborted) timer = window.setTimeout(request, Math.max(0, quietUntil - performance.now()))
  }
  signal.addEventListener('abort', () => {
    clearTimeout(timer)
    clearTimeout(fadeTimer)
    clearTimeout(quietTimer)
    cancelAnimationFrame(paintFrame)
    releasePaint?.()
    releaseQuiet?.()
    if (pending) pending.src = ''
    image.removeAttribute('src')
  }, { once: true })
  return {
    start() { if (!signal.aborted) { started = true; defer(100) } },
    defer,
    resize(cssWidth: number) {
      const pixels = cssWidth * (devicePixelRatio || 1)
      if (Math.abs(displayPixels - pixels) < .5) return
      displayPixels = pixels
      defer()
    },
    retry() { failed = false; status(false); defer(0) },
  }
}

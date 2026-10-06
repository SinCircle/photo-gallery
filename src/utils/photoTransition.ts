import { EASE_IN_OUT, EASE_OUT } from './motion'

export type PhotoDirection = 'open' | 'close'
const DURATION = 680
const owners = new WeakMap<HTMLElement, symbol>()
let activeOwner: symbol | undefined

type Rect = { x: number; y: number; width: number; height: number }
const transform = (r: Rect, width: number, height: number) =>
  `translate3d(${r.x}px,${r.y}px,0) scale(${r.width / width},${r.height / height})`

// Reuse the browser's already-decoded photo. Drawing it into a new 2D canvas
// forces a costly image readback on some GPUs, even for a small output bitmap.
function picture(image: HTMLImageElement) {
  const copy = image.cloneNode() as HTMLImageElement
  copy.removeAttribute('style')
  copy.removeAttribute('srcset')
  copy.className = 'photoTransitionImage'
  copy.loading = 'eager'
  copy.src = image.currentSrc || image.src
  const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  copy.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  copy.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  return copy
}

function background(source: HTMLElement, direction: PhotoDirection) {
  const layer = document.createElement('div')
  layer.className = 'photoTransitionBackdrop'
  layer.style.background = getComputedStyle(document.body).backgroundColor
  if (direction === 'open') {
    // Preserve just the visible cards at their viewport coordinates. Cloning
    // the whole masonry page would keep loading off-screen images during exit.
    for (const tile of source.closest('.shell')!.querySelectorAll<HTMLElement>('.tile')) {
      const r = tile.getBoundingClientRect()
      if (r.bottom <= 0 || r.top >= innerHeight) continue
      const clone = tile.cloneNode(true) as HTMLElement
      clone.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;margin:0`
      layer.append(clone)
    }
  } else {
    const bg = source.closest('.photoShell')?.querySelector('.photoBg')
    if (bg) layer.append(bg.cloneNode(true))
  }
  return layer
}

function toolbar(source: HTMLElement) {
  const slot = source.closest('.photoShell')?.querySelector<HTMLElement>('.toolbarSlot')
  if (!slot) return
  const ghost = document.createElement('div')
  ghost.className = 'photoShell photoTransitionToolbar'
  const clone = slot.cloneNode(true) as HTMLElement
  const originals = [slot, ...slot.querySelectorAll<HTMLElement>('*')]
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  for (const [i, original] of originals.entries()) {
    const copy = copies[i]
    if (original.matches('.dockBar, .dockMeta, .dockAction, .capsuleDot, .capsuleDots i')) {
      const style = getComputedStyle(original)
      copy.style.opacity = style.opacity
      copy.style.filter = style.filter
      copy.style.visibility = style.visibility
      if (original.matches('.dockBar')) {
        copy.style.width = style.width; copy.style.height = style.height
        copy.style.transform = style.transform
        copy.style.setProperty('--glass-material', style.getPropertyValue('--glass-material'))
      }
    }
    if (original.matches('.dockGlyph, .capsuleDot, .capsuleDots')) copy.style.setProperty('--dock-tone', getComputedStyle(original).getPropertyValue('--dock-tone'))
    if (original instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement && original.matches('[data-glass-output], .dockDotInk')) {
      copy.getContext('2d')?.drawImage(original, 0, 0)
    }
  }
  clone.querySelectorAll('[data-glass-scene]').forEach(e => e.remove())
  ghost.append(clone)
  return ghost
}

export async function transitionPhoto(options: {
  direction: PhotoDirection
  source: HTMLElement
  destination: () => HTMLElement | null
  update: () => Promise<void>
  signal: AbortSignal
}) {
  const { direction, source, destination, update, signal } = options
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  if (signal.aborted) return
  if (reduced.matches) { await update(); return }
  const owner = Symbol('photo transition')
  const hidden = new Map<HTMLElement, string>()
  const layers: HTMLElement[] = []
  const animations: Animation[] = []
  const html = document.documentElement
  const hide = (element: HTMLElement) => {
    hidden.set(element, element.style.visibility)
    owners.set(element, owner)
    element.style.visibility = 'hidden'
  }
  let skipped = false
  // The proxy's endpoints are measured once. Wheel input must not move its
  // hidden destination (photo zoom or gallery scroll) before the handoff.
  const freezeScroll = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
  window.addEventListener('wheel', freezeScroll, { capture: true, passive: false })
  window.addEventListener('touchmove', freezeScroll, { capture: true, passive: false })
  const cleanup = () => {
    window.removeEventListener('wheel', freezeScroll, true)
    window.removeEventListener('touchmove', freezeScroll, true)
    animations.forEach(a => a.cancel())
    layers.forEach(e => e.remove())
    for (const [element, visibility] of hidden) {
      if (owners.get(element) === owner) { element.style.visibility = visibility; owners.delete(element) }
    }
    if (activeOwner === owner) { delete html.dataset.photoTransition; activeOwner = undefined }
  }
  const skip = () => { skipped = true; cleanup() }
  signal.addEventListener('abort', skip, { once: true })
  reduced.addEventListener('change', skip)
  window.addEventListener('resize', skip)
  activeOwner = owner
  html.dataset.photoTransition = direction
  try {
    const from = source.getBoundingClientRect()
    const images = source instanceof HTMLImageElement ? [source] : [...source.querySelectorAll<HTMLImageElement>('img')].reverse()
    const image = images.find(img => img.complete && img.naturalWidth && getComputedStyle(img).opacity !== '0')
    if (!image || !from.width || !from.height) { await update(); return }
    const moving = picture(image)
    moving.dataset.photoTransitionImage = direction
    moving.style.transform = transform(from, moving.width, moving.height)
    moving.style.borderRadius = direction === 'open' ? `${12 * moving.width / from.width}px` : '0'
    const ghost = direction === 'close' ? toolbar(source) : undefined
    hide(source)
    const backdrop = background(source, direction)
    // Cloned gallery cards retain the hidden source image, with their date
    // stamp fading together with the rest of the old gallery.
    const surface = document.createElement('div')
    surface.className = 'photoTransitionSurface'
    surface.append(moving)
    layers.push(backdrop, surface)
    if (ghost) layers.push(ghost)
    await update()
    if (signal.aborted || skipped) return
    const target = destination()
    if (!target) return
    const to = target.getBoundingClientRect()
    hide(target)
    for (const layer of layers) {
      layer.inert = true
      layer.setAttribute('aria-hidden', 'true')
      document.body.append(layer)
    }
    const animate = (element: HTMLElement, frames: Keyframe[], duration = DURATION, easing = EASE_OUT) => {
      const animation = element.animate(frames, { duration, easing, fill: 'both' })
      animations.push(animation)
      return animation
    }
    const movement = animate(moving, [
      { transform: transform(from, moving.width, moving.height), borderRadius: direction === 'open' ? `${12 * moving.width / from.width}px` : '0' },
      { transform: transform(to, moving.width, moving.height), borderRadius: direction === 'close' ? `${12 * moving.width / to.width}px` : '0' },
    ], DURATION, EASE_IN_OUT)
    animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], 500)
    if (ghost) animate(ghost, [{ opacity: 1 }, { opacity: 0 }], 200)
    // Animations created in this task share the next compositor start frame.
    // Backdating to timeline.currentTime would skip the start when
    // preparing the view takes longer than one frame on a slower device.
    document.dispatchEvent(new CustomEvent('phototransition', { detail: { phase: 'ready', direction } }))
    await movement.finished.catch(() => {})
  } finally {
    signal.removeEventListener('abort', skip)
    reduced.removeEventListener('change', skip)
    window.removeEventListener('resize', skip)
    cleanup()
    document.dispatchEvent(new CustomEvent('phototransition', { detail: { phase: 'finished', direction } }))
  }
}

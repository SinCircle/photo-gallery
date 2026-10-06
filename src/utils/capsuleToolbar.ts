const IDLE_MS = 2800
const OPEN_MS = 1800
const CLOSE_MS = 1600
const EASING = 'cubic-bezier(.22,.8,.25,1)'
// Slight overshoot so the geometry settles like a spring instead of stopping dead.
const MORPH_EASING = 'cubic-bezier(.32,.72,.24,1)'

import { regularGlassConfig } from './glassConfig'

const IDLE_W = 56
const IDLE_H = 32

// One bar holds every control. Collapsing animates that bar's own width and
// height down to the idle capsule, so the small capsule the user ends up with
// is the same element — there is no second panel to hand off to.
export function attachCapsuleToolbar(root: HTMLElement, signal: AbortSignal) {
  const slot = document.createElement('div')
  slot.className = 'toolbarSlot'
  root.before(slot)
  slot.append(root)
  root.dataset.capsuleRoot = ''
  const bar = root.querySelector<HTMLElement>(':scope > [data-glass-capsule]')!
  const items = [...bar.children].filter((child): child is HTMLElement =>
    child instanceof HTMLElement && !child.classList.contains('capsuleDot'))
  const dot = document.createElement('span')
  dot.className = 'capsuleDot'
  dot.setAttribute('aria-hidden', 'true')
  const dots = document.createElement('span')
  dots.className = 'capsuleDots'
  dots.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 3; i++) dots.append(document.createElement('i'))
  bar.append(dot, dots)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  // The bar straddles whatever the photo happens to be, so one flat colour for
  // the labels is wrong somewhere. Sample the pixels the bar sits on and fill
  // the text with a matching gradient instead: each slice of the gradient takes
  // the opposite tone from the slice of photo behind that part of the bar.
  const SAMPLES = 24
  const metaList = bar.querySelector<HTMLElement>('.dockMeta')
  const inkTargets = () => items.filter((item): item is HTMLElement => item instanceof HTMLElement)
  const inkProbe = document.createElement('canvas')
  inkProbe.width = SAMPLES
  inkProbe.height = 1
  const inkCtx = inkProbe.getContext('2d', { willReadFrequently: true })
  let inkReadAt = 0
  const readInk = () => {
    if (!inkCtx) return
    const now = performance.now()
    if (now - inkReadAt < 220) return
    inkReadAt = now
    const scene = root.querySelector<HTMLCanvasElement>('canvas[data-glass-scene]')
    const sceneBox = scene?.getBoundingClientRect()
    if (!scene?.width || !sceneBox?.width || !sceneBox.height) return
    const barBox = bar.getBoundingClientRect()
    const scale = scene.width / sceneBox.width
    const x = Math.max(0, Math.round((barBox.left - sceneBox.left) * scale))
    const y = Math.min(scene.height - 1, Math.max(0, Math.round((barBox.top + barBox.height / 2 - sceneBox.top) * scale)))
    const width = Math.min(scene.width - x, Math.round(barBox.width * scale))
    if (width < 1) return
    inkCtx.clearRect(0, 0, SAMPLES, 1)
    inkCtx.drawImage(scene, x, y, width, 1, 0, 0, SAMPLES, 1)
    const data = inkCtx.getImageData(0, 0, SAMPLES, 1).data
    // Relative luminance, not raw sRGB: contrast has to be reasoned about in
    // linear light or the ratios below are meaningless.
    const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const sampled = Array.from({ length: SAMPLES }, (_, i) =>
      0.2126 * toLinear(data[i * 4] / 255) + 0.7152 * toLinear(data[i * 4 + 1] / 255) + 0.0722 * toLinear(data[i * 4 + 2] / 255))
    const lumaAt = (i: number) => sampled[Math.min(SAMPLES - 1, Math.max(0, i))]
    const toSrgb = (y: number) => Math.round(255 * (y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055))
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    // Continuity beats maximum contrast: the row commits to one direction and
    // pushes the ink as far as that direction allows (brighter, or darker)
    // before it will turn around. Only a patch where that direction simply
    // cannot deliver a legible ratio gets the opposite one.
    const TARGET_RATIO = 9.5
    const FLOOR_RATIO = 5
    const inkValue = (y: number, light: boolean) =>
      light ? TARGET_RATIO * (y + 0.05) - 0.05 : (y + 0.05) / TARGET_RATIO - 0.05
    const sorted = [...sampled].sort((a, b) => a - b)
    const median = sorted[Math.floor(SAMPLES / 2)]
    const preferLight = median < 0.18
    const choose = (y: number) => {
      const preferred = Math.min(1, Math.max(0, inkValue(y, preferLight)))
      if (contrast(y, preferred) >= FLOOR_RATIO) return preferred
      const other = Math.min(1, Math.max(0, inkValue(y, !preferLight)))
      return contrast(y, other) > contrast(y, preferred) ? other : preferred
    }
    const inkAt = (i: number) => {
      // A short moving average keeps the switch from landing as a hard step.
      let sum = 0
      for (let k = -1; k <= 1; k++) sum += choose(lumaAt(i + k))
      return sum / 3
    }
    const STOPS = 48
    const stops: string[] = []
    for (let i = 0; i < STOPS; i++) {
      const t = (i / (STOPS - 1)) * (SAMPLES - 1)
      const low = Math.floor(t)
      const high = Math.min(SAMPLES - 1, low + 1)
      const ink = inkAt(low) + (inkAt(high) - inkAt(low)) * (t - low)
      // Pure black and white are allowed; the ratio formula still only reaches
      // them where a patch really needs it.
      const value = toSrgb(ink)
      stops.push(`rgb(${value},${value},${value}) ${((i / (STOPS - 1)) * 100).toFixed(2)}%`)
    }
    const barBoxNow = bar.getBoundingClientRect()
    bar.style.setProperty('--dock-ink-gradient', `linear-gradient(90deg, ${stops.join(', ')})`)
    bar.style.setProperty('--dock-ink-size', `${barBoxNow.width}px 100%`)
    const centre = lumaAt(Math.round((SAMPLES - 1) / 2))
    bar.dataset.tone = centre < 0.18 ? 'dark' : 'light'
    bar.dataset.ink = 'gradient'
    // Every label is a window onto that one gradient, so they line up as a
    // single run instead of each picking its own colour.
    const scroll = metaList?.scrollLeft ?? 0
    for (const target of inkTargets()) {
      const box = target.getBoundingClientRect()
      target.style.backgroundPosition = `${-(box.left - barBoxNow.left - (target === metaList ? scroll : 0))}px 0`
    }
  }
  const pointers = new Set<number>()
  // `intent` is what the user asked for; `loading` overrides it while the photo
  // is still arriving, because there is nothing to configure yet.
  let intent = true
  let shown = true
  let nearby = false, keyboardFocus = false
  let lastActivity = performance.now(), timer = 0, generation = 0
  let animations: Animation[] = []
  const loading = () => bar.dataset.loading !== undefined
  const wanted = () => intent && !loading()

  const applyChrome = (expanded: boolean) => {
    // The bevel is sized to the pill it is currently drawn on.
    bar.dataset.config = regularGlassConfig(expanded ? 18 : 14)
    if (expanded) bar.removeAttribute('role')
    else bar.setAttribute('role', 'button')
    bar.setAttribute('aria-label', loading() ? '图片加载中' : '展开工具条')
    bar.tabIndex = expanded ? -1 : 0
    bar.style.cursor = expanded ? '' : 'pointer'
  }
  const settle = (expanded: boolean) => {
    bar.style.width = expanded ? '' : `${IDLE_W}px`
    bar.style.height = expanded ? '' : `${IDLE_H}px`
    for (const item of items) {
      item.style.opacity = ''
      item.style.visibility = expanded ? '' : 'hidden'
      if (item instanceof HTMLButtonElement) item.inert = !expanded
      const label = item.querySelector<HTMLElement>('.dockMeta')
      if (label) label.style.filter = ''
    }
    dot.style.opacity = expanded ? '0' : loading() ? '0' : '1'
    applyChrome(expanded)
    delete root.dataset.moving
    if (expanded) { readInk(); startTone() } else stopTone()
    root.dispatchEvent(new Event('glassrefresh'))
  }
  const morph = () => {
    const expanded = wanted()
    if (shown === expanded) { settle(expanded); return }
    const version = ++generation
    for (const animation of animations) animation.cancel()
    animations = []
    const from = bar.getBoundingClientRect()
    shown = expanded
    root.dataset.toolbar = expanded ? 'expanded' : 'collapsed'
    if (reduced.matches) { settle(expanded); return }
    root.dataset.moving = expanded ? 'opening' : 'closing'
    // The bar sizes itself from its contents, so the open destination has to be
    // measured rather than assumed — clear the idle override and read it back.
    bar.style.width = expanded ? '' : `${IDLE_W}px`
    bar.style.height = expanded ? '' : `${IDLE_H}px`
    const destination = bar.getBoundingClientRect()
    const targetWidth = destination.width
    const targetHeight = destination.height
    applyChrome(expanded)
    for (const item of items) if (item instanceof HTMLButtonElement) item.inert = !expanded
    type Keyframe = [number, number]
    const spring = (from: number, to: number, keys: Keyframe[]) => keys.map(([offset, k]) => {
      const value = from + (to - from) * k
      return { offset, width: `${Math.max(24, value)}px` }
    })
    // One heavy overshoot and a short settling step: the bar reads as having
    // weight rather than bouncing.
    const widthKeys: Keyframe[] = expanded
      ? [[0, 0], [.46, 1.04], [.74, .992], [1, 1]]
      : [[0, 0], [.5, 1.026], [.78, .993], [1, 1]]
    const heightKeys: Keyframe[] = expanded
      ? [[0, 0], [.46, 1.038], [.74, .993], [1, 1]]
      : [[0, 0], [.5, 1.03], [.78, .993], [1, 1]]
    const widthFrames = spring(from.width, targetWidth, widthKeys)
    const heightFrames = spring(from.height, targetHeight, heightKeys)
    animations.push(bar.animate(
      widthFrames.map((frame, i) => ({ ...frame, height: heightFrames[i].width })),
      { duration: expanded ? OPEN_MS : CLOSE_MS, easing: MORPH_EASING, fill: 'backwards' }))
    for (const item of items) {
      item.style.visibility = ''
      if (expanded) {
        item.style.opacity = '1'
        animations.push(item.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: OPEN_MS * .5, delay: OPEN_MS * .32, easing: EASING, fill: 'backwards' }))
      } else {
        item.style.opacity = '0'
        animations.push(item.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: CLOSE_MS * .42, easing: EASING, fill: 'backwards' }))
      }
    }
    const meta = bar.querySelector<HTMLElement>('.dockMeta')
    if (meta) {
      meta.style.filter = expanded ? 'blur(0px)' : 'blur(8px)'
      animations.push(meta.animate(
        [{ filter: expanded ? 'blur(8px)' : 'blur(0px)' }, { filter: expanded ? 'blur(0px)' : 'blur(8px)' }],
        { duration: expanded ? OPEN_MS * .55 : CLOSE_MS * .55, delay: expanded ? OPEN_MS * .25 : 0, easing: EASING, fill: 'backwards' }))
    }
    const marker = expanded ? dots : dot
    marker.style.opacity = expanded ? '1' : '1'
    const fadeOut = expanded ? dots : dot
    animations.push(fadeOut.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: (expanded ? OPEN_MS : CLOSE_MS) * .4, easing: EASING, fill: 'backwards' }))
    animations.push(marker.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: (expanded ? OPEN_MS : CLOSE_MS) * .45, delay: (expanded ? OPEN_MS : CLOSE_MS) * .45, easing: EASING, fill: 'backwards' }))
    void animations[0].finished.then(() => {
      if (generation === version && !signal.aborted) settle(wanted())
    }).catch(() => {})
    root.dispatchEvent(new Event('glassgeometry'))
  }
  let toneTimer = 0
  const startTone = () => { if (!toneTimer) toneTimer = window.setInterval(readInk, 480) }
  const stopTone = () => { if (toneTimer) { window.clearInterval(toneTimer); toneTimer = 0 } }
  const checkIdle = () => {
    timer = 0
    if (signal.aborted) return
    const remaining = IDLE_MS - (performance.now() - lastActivity)
    if (remaining > 0) { timer = window.setTimeout(checkIdle, remaining); return }
    const focused = document.activeElement
    if (pointers.size || nearby || (root.contains(focused) && keyboardFocus)) { arm(); return }
    intent = false
    morph()
  }
  const arm = () => {
    lastActivity = performance.now()
    if (!timer) timer = window.setTimeout(checkIdle, IDLE_MS)
  }
  const wake = () => { intent = true; morph(); arm() }
  bar.addEventListener('click', () => { if (!shown) wake() }, { signal })
  bar.addEventListener('keydown', event => {
    if (!shown && ['Enter', ' '].includes(event.key)) { event.preventDefault(); wake() }
  }, { signal })
  window.addEventListener('pointermove', event => {
    nearby = (shown ? items : [bar]).some(element => {
      const r = element.getBoundingClientRect()
      return event.clientX >= r.left - 40 && event.clientX <= r.right + 40 &&
        event.clientY >= r.top - 40 && event.clientY <= r.bottom + 40
    })
    if (nearby) wake()
    else if (pointers.size) arm()
  }, { passive: true, signal })
  window.addEventListener('pointerdown', event => { keyboardFocus = false; pointers.add(event.pointerId); arm() }, { passive: true, signal })
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); arm() }
  window.addEventListener('pointerup', release, { passive: true, signal })
  window.addEventListener('pointercancel', release, { passive: true, signal })
  // Panning, zooming or scrolling the photo must not summon the toolbar; only
  // the pointer coming near it does. Keyboard access is kept for focus users.
  window.addEventListener('keydown', () => { keyboardFocus = true; wake() }, { signal })
  root.addEventListener('focusin', wake, { signal })
  new MutationObserver(() => {
    // The bar is only idle while there is nothing to configure; once the photo
    // has arrived it opens by itself without waiting for the pointer.
    if (loading()) morph()
    else wake()
  }).observe(bar, { attributes: true, attributeFilter: ['data-loading'] })
  reduced.addEventListener('change', () => {
    generation++
    for (const animation of animations) animation.cancel()
    animations = []
    settle(wanted())
  }, { signal })
  signal.addEventListener('abort', () => {
    clearTimeout(timer)
    stopTone()
    for (const animation of animations) animation.cancel()
  }, { once: true })
  shown = wanted()
  root.dataset.toolbar = shown ? 'expanded' : 'collapsed'
  settle(shown)
  arm()
  return slot
}

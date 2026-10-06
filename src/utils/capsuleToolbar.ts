const IDLE_MS = 2800
const OPEN_MS = 1800
const CLOSE_MS = 1600
const EASING = 'cubic-bezier(.22,.8,.25,1)'
// Slight overshoot so the geometry settles like a spring instead of stopping dead.
const MORPH_EASING = 'cubic-bezier(.32,.72,.24,1)'

import { regularGlassConfig } from './glassConfig'
import { attachToolbarInk } from './toolbarInk'

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
  const readInk = attachToolbarInk(root, bar, signal)
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
    bar.dataset.config = regularGlassConfig(14)
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
    // The dots carry the same computed ink as the labels, so the ink is read in
    // every state; only the open bar (and the arriving photo) needs the top-up.
    readInk()
    if (expanded || loading()) startTone()
    else stopTone()
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

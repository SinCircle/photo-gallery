const IDLE_MS = 2800
import { EASE_OUT as EASING, TOOLBAR_OPEN_MS as OPEN_MS, TOOLBAR_CLOSE_MS as CLOSE_MS, toolbarSpring } from './motion'

import { regularGlassConfig } from './glassConfig'
import { attachToolbarInk } from './toolbarInk'
import { attachLoadingDots } from './loadingDots'
import { attachBlurPresence } from './blurState'

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
  for (let i = 0; i < 4; i++) dots.append(document.createElement('i'))
  bar.append(dot, dots)
  const setDotsLoading = attachLoadingDots(dots, signal)
  const setIdleDot = attachBlurPresence(dot, signal)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const mobile = matchMedia('(max-width: 560px)')
  const readInk = attachToolbarInk(root, bar, signal)
  const pointers = new Set<number>()
  // Begin with the loading capsule. Once metadata and glass are ready, user
  // intent can expand it even while the original is still arriving.
  let intent = !bar.hasAttribute('data-loading')
  let shown = true
  let nearby = false, keyboardFocus = false
  let lastActivity = performance.now(), timer = 0, generation = 0
  let pointerReadyAt = 0
  let animations: Animation[] = []
  const loading = () => bar.dataset.loading !== undefined
  const busy = () => loading() || bar.dataset.busy !== undefined
  const refreshDots = (transitionMs?: number) => {
    const ready = !root.hasAttribute('data-glass-pending')
    setDotsLoading(busy() && !shown && ready, transitionMs)
    void setIdleDot(!busy() && !shown && ready, transitionMs)
  }
  const expandable = () => !loading() || bar.hasAttribute('data-expandable')
  const wanted = () => intent && expandable()

  const applyChrome = (expanded: boolean) => {
    // The bevel is sized to the pill it is currently drawn on.
    const blur = expanded && mobile.matches ? .4 : .15
    const config = regularGlassConfig(expanded && mobile.matches ? 28 : 14, blur)
    if (bar.dataset.config !== config) bar.dataset.config = config
    bar.style.setProperty('--capsule-blur', `${blur}px`)
    if (expanded) bar.removeAttribute('role')
    else bar.setAttribute('role', 'button')
    bar.setAttribute('aria-label', loading() ? '图片加载中' : busy() ? '图片处理中' : '展开工具条')
    bar.tabIndex = expanded ? -1 : 0
    bar.style.cursor = expanded ? '' : 'pointer'
  }
  const settle = (expanded: boolean) => {
    bar.style.maxWidth = ''
    bar.style.width = expanded ? '' : `${IDLE_W}px`
    bar.style.height = expanded ? '' : `${IDLE_H}px`
    for (const item of items) {
      item.style.opacity = ''
      item.style.visibility = expanded ? '' : 'hidden'
      item.inert = !expanded
      item.style.filter = expanded ? '' : 'blur(6px)'
    }
    refreshDots()
    applyChrome(expanded)
    delete root.dataset.moving
    // Sample the new geometry once; later scene/content changes invalidate ink.
    readInk()
    root.dispatchEvent(new Event('glassrefresh'))
  }
  const morph = () => {
    const expanded = wanted()
    // Repeated hover/activity must not settle an in-flight animation, rewrite
    // data-config or repaint a scene whose state has not changed.
    if (shown === expanded) return
    const version = ++generation
    const from = bar.getBoundingClientRect()
    const opacities = items.map(item => {
      const style = getComputedStyle(item)
      return style.visibility === 'hidden' ? '0' : style.opacity
    })
    const filters = items.map(item => getComputedStyle(item).filter)
    for (const animation of animations) animation.cancel()
    animations = []
    shown = expanded
    refreshDots(expanded ? undefined : 280)
    // Hover can reveal a control directly under the pointer. Its first press
    // opens the capsule; it must not accidentally activate that new control.
    if (expanded) pointerReadyAt = performance.now() + 240
    root.dataset.toolbar = expanded ? 'expanded' : 'collapsed'
    if (reduced.matches) { settle(expanded); return }
    root.dataset.moving = expanded ? 'opening' : 'closing'
    // The bar sizes itself from its contents, so the open destination has to be
    // measured rather than assumed — clear the idle override and read it back.
    bar.style.maxWidth = ''
    bar.style.width = expanded ? '' : `${IDLE_W}px`
    bar.style.height = expanded ? '' : `${IDLE_H}px`
    const destination = bar.getBoundingClientRect()
    const targetWidth = destination.width
    const targetHeight = destination.height
    applyChrome(expanded)
    for (const item of items) item.inert = !expanded
    const duration = expanded ? OPEN_MS : CLOSE_MS
    const limit = Math.max(targetWidth, innerWidth - 16)
    // A spring needs a small motion envelope beyond its resting slot; the
    // normal max-width would otherwise flatten the entire overshoot.
    bar.style.maxWidth = `${limit}px`
    // Keep the resting endpoint explicit until settle restores intrinsic size.
    // Otherwise removing the animation can expose an auto width under the
    // temporarily wider max-width for one frame.
    bar.style.width = `${targetWidth}px`
    bar.style.height = `${targetHeight}px`
    animations.push(bar.animate(toolbarSpring(from, { width: targetWidth, height: targetHeight }, duration, limit),
      { duration, fill: 'backwards' }))
    animations.push(bar.animate(toolbarSpring(from, { width: targetWidth, height: targetHeight }, duration, limit, 'height'),
      { duration, fill: 'backwards' }))
    for (const [i, item] of items.entries()) {
      item.style.visibility = ''
      if (expanded) {
        item.style.opacity = '1'
        item.style.filter = 'blur(0px)'
        animations.push(item.animate([{ opacity: opacities[i], filter: filters[i] }, { opacity: 1, filter: 'blur(0px)' }],
          { duration: 1400, easing: EASING, fill: 'backwards' }))
      } else {
        item.style.opacity = '0'
        item.style.filter = 'blur(6px)'
        animations.push(item.animate([{ opacity: opacities[i], filter: filters[i] }, { opacity: 0, filter: 'blur(6px)' }],
          { duration: CLOSE_MS * .42, easing: EASING, fill: 'backwards' }))
      }
    }
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (generation === version && !signal.aborted) settle(wanted())
    }).catch(() => {})
    root.dispatchEvent(new Event('glassgeometry'))
  }
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
  bar.addEventListener('click', event => {
    if (event.detail > 0 && performance.now() < pointerReadyAt) {
      event.preventDefault()
      event.stopImmediatePropagation()
      wake()
    }
  }, { capture: true, signal })
  bar.addEventListener('click', () => { if (!shown) wake() }, { signal })
  bar.addEventListener('keydown', event => {
    if (!shown && ['Enter', ' '].includes(event.key)) { event.preventDefault(); wake() }
  }, { signal })
  window.addEventListener('pointermove', event => {
    // Touch does not have a persistent hover position after the finger lifts.
    if (event.pointerType === 'touch') { nearby = false; return }
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
  window.addEventListener('blur', () => { pointers.clear(); nearby = false; keyboardFocus = false; arm() }, { signal })
  // Panning, zooming or scrolling the photo must not summon the toolbar; only
  // the pointer coming near it does. Keyboard access is kept for focus users.
  window.addEventListener('keydown', () => { keyboardFocus = true; wake() }, { signal })
  root.addEventListener('focusin', wake, { signal })
  let wasLoading = loading()
  let wasBusy = busy()
  let wasExpandable = expandable()
  refreshDots()
  root.addEventListener('glassready', () => refreshDots(), { signal })
  const loadingObserver = new MutationObserver(() => {
    if (wasLoading === loading() && wasBusy === busy() && wasExpandable === expandable()) return
    const imageFinished = wasLoading && !loading()
    const controlsArrived = !wasExpandable && expandable()
    wasLoading = loading()
    wasBusy = busy()
    wasExpandable = expandable()
    refreshDots()
    // Metadata permits expansion even while the original is loading. The
    // same busy state then lives at the download position, or in the idle pill.
    if (controlsArrived) arm()
    if (imageFinished) wake()
    else morph()
    applyChrome(shown)
  })
  loadingObserver.observe(bar, { attributes: true, attributeFilter: ['data-loading', 'data-busy', 'data-expandable'] })
  reduced.addEventListener('change', () => {
    generation++
    for (const animation of animations) animation.cancel()
    animations = []
    settle(wanted())
  }, { signal })
  mobile.addEventListener('change', () => applyChrome(shown), { signal })
  signal.addEventListener('abort', () => {
    clearTimeout(timer)
    loadingObserver.disconnect()
    for (const animation of animations) animation.cancel()
  }, { once: true })
  shown = wanted()
  root.dataset.toolbar = shown ? 'expanded' : 'collapsed'
  settle(shown)
  arm()
  return slot
}

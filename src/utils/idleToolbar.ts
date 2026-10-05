const IDLE_MS = 3500

// Transform-only motion keeps the full control's layout box reserved. Native
// Web Animations run on the compositor; there is no JavaScript animation loop.
export function attachIdleToolbar(bar: HTMLElement, signal: AbortSignal, edge: 'top' | 'bottom') {
  bar.classList.add('idleToolbar')
  bar.style.transformOrigin = `50% ${edge === 'bottom' ? '100%' : '0%'}`
  bar.dataset.toolbar = 'expanded'
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let timer = 0
  let lastActivity = 0
  let animation: Animation | undefined
  let expanded = true
  let held = false
  let keyboardFocus = false

  const controls = () => [...bar.children].filter((child): child is HTMLElement =>
    child instanceof HTMLElement && !child.classList.contains('glassSurface'))
  const setExpanded = (next: boolean) => {
    if (signal.aborted || next === expanded) return
    const current = getComputedStyle(bar).transform
    animation?.cancel()
    expanded = next
    if (next) window.removeEventListener('pointermove', onNearbyPointer)
    else window.addEventListener('pointermove', onNearbyPointer, { passive: true, signal })
    bar.dataset.toolbar = next ? 'expanded' : 'collapsed'
    bar.tabIndex = next ? -1 : 0
    if (next) { bar.removeAttribute('role'); bar.removeAttribute('aria-label') }
    else { bar.setAttribute('role', 'button'); bar.setAttribute('aria-label', controls().map(c => c.textContent?.trim()).join(' ')) }
    for (const child of controls()) { child.inert = !next; if (next) child.removeAttribute('aria-hidden'); else child.setAttribute('aria-hidden', 'true') }
    const sx = Math.min(1, 96 / bar.offsetWidth), sy = Math.min(1, 8 / bar.offsetHeight)
    const target = next ? 'scale(1, 1)' : `scale(${sx}, ${sy})`
    bar.style.transform = target
    if (preference.matches) {
      animation = undefined
      if (next) bar.dispatchEvent(new Event('glassrefresh'))
      return
    }
    const frames = next
      ? [{ transform: current, offset: 0 }, { transform: 'scale(1.045, 1.09)', offset: .60 },
        { transform: 'scale(.985, .97)', offset: .80 }, { transform: target, offset: 1 }]
      : [{ transform: current, offset: 0 }, { transform: 'scale(1.015, 1.025)', offset: .15 },
        { transform: `scale(${sx * .86}, ${sy * .80})`, offset: .68 },
        { transform: `scale(${sx * 1.08}, ${sy * 1.10})`, offset: .84 }, { transform: target, offset: 1 }]
    animation = bar.animate(frames, { duration: next ? 540 : 480, easing: 'cubic-bezier(.2,.75,.25,1)' })
    const active = animation
    active.onfinish = () => {
      if (animation !== active) return
      animation = undefined
      if (next) bar.dispatchEvent(new Event('glassrefresh'))
    }
  }
  const checkIdle = () => {
    timer = 0
    if (signal.aborted) return
    const remaining = IDLE_MS - (performance.now() - lastActivity)
    if (remaining > 0) { timer = window.setTimeout(checkIdle, remaining); return }
    const focused = document.activeElement
    const editing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    if (held || (bar.contains(focused) && (keyboardFocus || editing))) { arm(); return }
    setExpanded(false)
  }
  const arm = () => {
    lastActivity = performance.now()
    if (!timer) timer = window.setTimeout(checkIdle, IDLE_MS)
  }
  const wake = () => { setExpanded(true); arm() }
  function onNearbyPointer(event: PointerEvent) {
    const rect = bar.getBoundingClientRect()
    if (event.clientX >= rect.left - 56 && event.clientX <= rect.right + 56 &&
      event.clientY >= rect.top - 56 && event.clientY <= rect.bottom + 56) wake()
  }
  bar.addEventListener('pointermove', () => { if (expanded) arm() }, { passive: true, signal })
  window.addEventListener('pointerdown', () => { keyboardFocus = false; held = true; wake() }, { passive: true, signal })
  const release = () => { held = false; arm() }
  window.addEventListener('pointerup', release, { passive: true, signal })
  window.addEventListener('pointercancel', release, { passive: true, signal })
  for (const event of ['wheel', 'scroll']) window.addEventListener(event, wake, { passive: true, signal })
  window.addEventListener('keydown', () => { keyboardFocus = true; wake() }, { signal })
  bar.addEventListener('focusin', wake, { signal })
  bar.addEventListener('keydown', event => {
    if (event.target === bar && ['Enter', ' '].includes(event.key)) { event.preventDefault(); wake() }
  }, { signal })
  preference.addEventListener('change', () => {
    animation?.cancel()
    animation = undefined
  }, { signal })
  signal.addEventListener('abort', () => { clearTimeout(timer); animation?.cancel() }, { once: true })
  arm()
}

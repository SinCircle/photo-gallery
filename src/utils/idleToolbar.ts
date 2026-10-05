const IDLE_MS = 2800

// Reserve the expanded footprint, but resize the actual glass box. Scaling a
// full-width canvas into a slit would change both hit targets and refraction.
export function attachIdleToolbar(bar: HTMLElement, signal: AbortSignal, edge: 'top' | 'bottom') {
  const slot = document.createElement('div')
  slot.className = 'toolbarSlot'
  const clip = document.createElement('div')
  clip.className = 'toolbarClip'
  const material = document.createElement('div')
  material.className = 'toolbarMaterial'
  material.setAttribute('aria-hidden', 'true')
  const content = document.createElement('div')
  content.className = 'toolbarContent'
  content.append(...[...bar.children].filter(child => !child.classList.contains('glassRoot')))
  clip.append(content)
  const dot = document.createElement('span')
  dot.className = 'toolbarDot'
  dot.setAttribute('aria-hidden', 'true')
  bar.before(slot)
  slot.append(bar)
  bar.append(material, clip, dot)
  bar.classList.add('idleToolbar')
  bar.dataset.edge = edge
  bar.dataset.toolbar = 'expanded'
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let expanded = true
  let width = 0, height = 0
  let timer = 0, lastActivity = performance.now()
  let keyboardFocus = false
  let nearby = false
  let animations: Animation[] = []
  const pointers = new Set<number>()

  const resize = () => {
    width = slot.clientWidth
    content.style.width = `${Math.max(0, width - 2)}px`
    height = content.offsetHeight + 2
    slot.style.height = `${height}px`
    bar.style.width = `${expanded ? width : 56}px`
    bar.style.height = `${expanded ? height : 32}px`
    bar.dispatchEvent(new Event('glassrefresh'))
  }
  const setExpanded = (next: boolean) => {
    if (signal.aborted || expanded === next) return
    const current = bar.getBoundingClientRect()
    const currentOpacity = getComputedStyle(clip).opacity
    const dotOpacity = getComputedStyle(dot).opacity
    const materialOpacity = getComputedStyle(material).opacity
    const metadata = content.querySelector<HTMLElement>('.dockMeta')
    const currentBlur = metadata ? getComputedStyle(metadata).filter : 'none'
    for (const animation of animations) animation.cancel()
    animations = []
    delete bar.dataset.moving
    expanded = next
    bar.dataset.toolbar = next ? 'expanded' : 'collapsed'
    bar.tabIndex = next ? -1 : 0
    if (next) { bar.removeAttribute('role'); bar.removeAttribute('aria-label') }
    else { bar.setAttribute('role', 'button'); bar.setAttribute('aria-label', content.textContent?.trim() || '') }
    content.inert = !next
    content.setAttribute('aria-hidden', String(!next))
    clip.style.opacity = next ? '1' : '0'
    dot.style.opacity = next ? '0' : '1'
    bar.style.width = `${next ? width : 56}px`
    bar.style.height = `${next ? height : 32}px`
    if (metadata) metadata.style.filter = next ? 'blur(0px)' : 'blur(8px)'
    if (!preference.matches) {
      bar.dataset.moving = ''
      const targetW = next ? width : 56, targetH = next ? height : 32
      const dw = targetW - current.width, dh = targetH - current.height
      const spring = (delta: number, target: number, fraction: number) =>
        Math.sign(delta) * Math.min(Math.abs(delta) * fraction, target * .08)
      const easing = 'cubic-bezier(.22,.8,.25,1)'
      const size = (w: number, h: number, offset: number) => ({ width: `${w}px`, height: `${h}px`, offset })
      animations.push(bar.animate([
        size(current.width, current.height, 0),
        size(targetW + spring(dw, targetW, .035), targetH + spring(dh, targetH, .06), .64),
        size(targetW - spring(dw, targetW, .012), targetH - spring(dh, targetH, .02), .82),
        size(targetW, targetH, 1),
      ], { duration: next ? 540 : 460, easing }))
      animations.push(clip.animate([{ opacity: currentOpacity }, { opacity: next ? 1 : 0 }],
        { duration: next ? 320 : 180, easing }))
      if (metadata) animations.push(metadata.animate([{ filter: currentBlur }, { filter: next ? 'blur(0px)' : 'blur(8px)' }],
        { duration: next ? 380 : 220, easing }))
      for (const [element, opacity] of [[dot, dotOpacity], [material, materialOpacity]] as const) {
        animations.push(element.animate([{ opacity }, { opacity: next ? 0 : 1 }],
          { duration: 200, delay: next ? 0 : 180, easing, fill: 'backwards' }))
      }
      animations[0].onfinish = () => {
        delete bar.dataset.moving
        bar.dispatchEvent(new Event('glassrefresh'))
      }
      bar.dispatchEvent(new Event('glassgeometry'))
    } else bar.dispatchEvent(new Event('glassrefresh'))
  }
  const checkIdle = () => {
    timer = 0
    if (signal.aborted) return
    const remaining = IDLE_MS - (performance.now() - lastActivity)
    if (remaining > 0) { timer = window.setTimeout(checkIdle, remaining); return }
    const focused = document.activeElement
    const editing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
    if (pointers.size || nearby || (bar.contains(focused) && (keyboardFocus || editing))) { arm(); return }
    setExpanded(false)
  }
  const arm = () => {
    lastActivity = performance.now()
    if (!timer) timer = window.setTimeout(checkIdle, IDLE_MS)
  }
  const wake = () => { setExpanded(true); arm() }
  window.addEventListener('pointermove', event => {
    const rect = bar.getBoundingClientRect()
    nearby = event.clientX >= rect.left - 40 && event.clientX <= rect.right + 40 &&
      event.clientY >= rect.top - 40 && event.clientY <= rect.bottom + 40
    if (nearby) wake()
    else if (pointers.size) arm()
  }, { passive: true, signal })
  window.addEventListener('pointerdown', event => { keyboardFocus = false; pointers.add(event.pointerId); wake() }, { passive: true, signal })
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); arm() }
  window.addEventListener('pointerup', release, { passive: true, signal })
  window.addEventListener('pointercancel', release, { passive: true, signal })
  for (const event of ['wheel', 'scroll']) window.addEventListener(event, wake, { passive: true, signal })
  window.addEventListener('keydown', () => { keyboardFocus = true; wake() }, { signal })
  bar.addEventListener('focusin', wake, { signal })
  bar.addEventListener('keydown', event => {
    if (event.target === bar && ['Enter', ' '].includes(event.key)) { event.preventDefault(); wake() }
  }, { signal })
  preference.addEventListener('change', () => {
    for (const animation of animations) animation.cancel()
    animations = []
    delete bar.dataset.moving
    resize()
  }, { signal })
  const observer = new ResizeObserver(resize)
  observer.observe(slot)
  observer.observe(content)
  signal.addEventListener('abort', () => { clearTimeout(timer); observer.disconnect(); for (const animation of animations) animation.cancel() }, { once: true })
  resize()
  arm()
  return slot
}

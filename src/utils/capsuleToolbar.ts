const IDLE_MS = 2800
const OPEN_MS = 810
const CLOSE_MS = 720
const EASING = 'cubic-bezier(.22,.8,.25,1)'

// All four controls stay in their own reserved grid cells. They fade/slide out
// into the single idle capsule. Its reserved centre is clear of all controls,
// so the handoff has neither overlapping glass faces nor a completely blank frame.
export function attachCapsuleToolbar(root: HTMLElement, signal: AbortSignal) {
  const slot = document.createElement('div')
  slot.className = 'toolbarSlot'
  root.before(slot)
  slot.append(root)
  root.dataset.capsuleRoot = ''
  root.dataset.toolbar = 'expanded'
  const controls = [...root.querySelectorAll<HTMLElement>(':scope > [data-glass-capsule]')]
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'glassCapsule dockToggle'
  toggle.dataset.glassCapsule = 'idle'
  toggle.setAttribute('aria-label', '展开工具条')
  const dot = document.createElement('span')
  dot.className = 'capsuleDot'
  dot.setAttribute('aria-hidden', 'true')
  toggle.append(dot)
  toggle.style.visibility = 'hidden'
  toggle.style.translate = '0px -200vh'
  root.append(toggle)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const pointers = new Set<number>()
  let expanded = true, nearby = false, keyboardFocus = false
  let lastActivity = performance.now(), timer = 0, generation = 0
  let animations: Animation[] = []

  const settle = () => {
    for (const control of controls) {
      control.style.visibility = expanded ? '' : 'hidden'
      control.style.opacity = ''
      control.style.translate = expanded ? '' : '0px -200vh'
      const label = control.querySelector<HTMLElement>('.dockMeta')
      if (label) label.style.filter = ''
    }
    toggle.style.visibility = expanded ? 'hidden' : ''
    toggle.style.translate = expanded ? '0px -200vh' : ''
    toggle.style.opacity = ''
    delete root.dataset.moving
    root.dispatchEvent(new Event('glassrefresh'))
  }
  const setExpanded = (next: boolean) => {
    if (expanded === next || signal.aborted) return
    const current = controls.map(control => ({
      opacity: control.style.visibility === 'hidden' ? '0' : getComputedStyle(control).opacity,
      translate: control.style.visibility === 'hidden' ? '0px 14px' : getComputedStyle(control).translate,
      blur: control.style.visibility === 'hidden' ? 'blur(8px)' : getComputedStyle(control.querySelector('.dockMeta') || control).filter,
    }))
    const toggleOpacity = toggle.style.visibility === 'hidden' ? '0' : getComputedStyle(toggle).opacity
    const version = ++generation
    for (const animation of animations) animation.cancel()
    animations = []
    expanded = next
    root.dataset.toolbar = next ? 'expanded' : 'collapsed'
    for (const control of controls) control.inert = !next
    if (reduced.matches) { settle(); return }
    root.dataset.moving = next ? 'opening' : 'closing'
    toggle.style.visibility = ''
    toggle.style.translate = ''
    toggle.style.opacity = next ? '0' : '1'
    let openingCompletion: Animation | undefined
    controls.forEach((control, i) => {
      control.style.visibility = ''
      control.style.opacity = next ? '1' : '0'
      control.style.translate = next ? '0px 0px' : '0px 8px'
      const move = control.animate([
        { translate: current[i].translate === 'none' ? '0px 0px' : current[i].translate, offset: 0 },
        { translate: next ? '0px -3px' : '0px 10px', offset: .64 },
        { translate: next ? '0px 1px' : '0px 7px', offset: .82 },
        { translate: next ? '0px 0px' : '0px 8px', offset: 1 },
      ], { duration: next ? OPEN_MS : CLOSE_MS, easing: 'ease-in-out', fill: 'backwards' })
      openingCompletion ||= move
      animations.push(move)
      const fade = control.animate([{ opacity: current[i].opacity }, { opacity: next ? 1 : 0 }],
        { duration: next ? 570 : 480, delay: next ? 240 : 0, easing: EASING, fill: 'backwards' })
      animations.push(fade)
      if (!next) fade.onfinish = () => {
        if (generation !== version || signal.aborted) return
        control.style.visibility = 'hidden'
        move.cancel()
        control.style.translate = '0px -200vh'
        root.dispatchEvent(new Event('glassrefresh'))
      }
      const label = control.querySelector<HTMLElement>('.dockMeta')
      if (label) {
        label.style.filter = next ? 'blur(0px)' : 'blur(8px)'
        animations.push(label.animate([{ filter: current[i].blur }, { filter: next ? 'blur(0px)' : 'blur(8px)' }],
          { duration: next ? 570 : 480, delay: next ? 240 : 0, easing: EASING, fill: 'backwards' }))
      }
    })
    const toggleFade = toggle.animate([{ opacity: toggleOpacity }, { opacity: next ? 0 : 1 }],
      { duration: next ? 240 : 450, delay: next ? 0 : 270, easing: EASING, fill: 'backwards' })
    animations.push(toggleFade)
    if (next) toggleFade.onfinish = () => {
      if (generation !== version || signal.aborted) return
      toggle.style.visibility = 'hidden'
      toggle.style.translate = '0px -200vh'
      root.dispatchEvent(new Event('glassrefresh'))
    }
    void (next ? openingCompletion! : toggleFade).finished.then(() => {
      if (generation === version && !signal.aborted) settle()
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
    setExpanded(false)
  }
  const arm = () => {
    lastActivity = performance.now()
    if (!timer) timer = window.setTimeout(checkIdle, IDLE_MS)
  }
  const wake = () => { setExpanded(true); arm() }
  toggle.addEventListener('click', wake, { signal })
  window.addEventListener('pointermove', event => {
    nearby = (expanded ? controls : [toggle]).some(control => {
      const r = control.getBoundingClientRect()
      return event.clientX >= r.left - 40 && event.clientX <= r.right + 40 &&
        event.clientY >= r.top - 40 && event.clientY <= r.bottom + 40
    })
    if (nearby) wake()
    else if (pointers.size) arm()
  }, { passive: true, signal })
  window.addEventListener('pointerdown', event => { keyboardFocus = false; pointers.add(event.pointerId); wake() }, { passive: true, signal })
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); arm() }
  window.addEventListener('pointerup', release, { passive: true, signal })
  window.addEventListener('pointercancel', release, { passive: true, signal })
  for (const event of ['wheel', 'scroll']) window.addEventListener(event, wake, { passive: true, signal })
  window.addEventListener('keydown', () => { keyboardFocus = true; wake() }, { signal })
  root.addEventListener('focusin', wake, { signal })
  reduced.addEventListener('change', () => {
    generation++
    for (const animation of animations) animation.cancel()
    animations = []
    settle()
  }, { signal })
  signal.addEventListener('abort', () => {
    clearTimeout(timer)
    for (const animation of animations) animation.cancel()
  }, { once: true })
  arm()
  return slot
}

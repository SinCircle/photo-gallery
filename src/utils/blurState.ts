import { EASE_OUT } from './motion'

export const BLUR_TIME_SCALE = 3
export const STATE_MS = 280 * BLUR_TIME_SCALE

// Retarget from the displayed frame. Outgoing content remains mounted until
// its blur/fade ends, including a loader's existing motion underneath.
export function attachBlurPresence(element: HTMLElement, signal: AbortSignal, initiallyVisible = false, easing = EASE_OUT) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let visible = initiallyVisible, animation: Animation | undefined
  element.style.opacity = visible ? '1' : '0'
  element.style.filter = visible ? 'blur(0px)' : 'blur(6px)'
  const cancel = () => { animation?.cancel(); animation = undefined }
  reduced.addEventListener('change', cancel, { signal })
  signal.addEventListener('abort', cancel, { once: true })
  return (next: boolean, duration = STATE_MS) => {
    if (visible === next || signal.aborted) return animation?.finished.catch(() => {}) ?? Promise.resolve()
    visible = next
    const style = getComputedStyle(element), opacity = style.opacity, filter = style.filter
    cancel()
    element.style.opacity = next ? '1' : '0'
    element.style.filter = next ? 'blur(0px)' : 'blur(6px)'
    if (reduced.matches) return Promise.resolve()
    animation = element.animate([{ opacity, filter }, { opacity: element.style.opacity, filter: element.style.filter }],
      { duration, easing, fill: 'backwards' })
    return animation.finished.catch(() => {})
  }
}

// Text changes share the same blurred crossfade as text/loader/idle changes.
// A short-lived visual copy keeps the outgoing glyphs while the real label
// immediately carries the new accessible text and receives fresh ink sampling.
export function attachBlurText(element: HTMLElement, signal: AbortSignal) {
  let outgoing: HTMLElement | undefined, incoming: Animation | undefined
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const clean = () => { outgoing?.remove(); outgoing = undefined; incoming?.cancel(); incoming = undefined }
  signal.addEventListener('abort', clean, { once: true })
  reduced.addEventListener('change', clean, { signal })
  return (text: string) => {
    if (element.textContent === text || signal.aborted) return
    clean()
    const copy = element.cloneNode(true) as HTMLElement
    // Freeze the inherited tone on the outgoing copy during the short fade.
    copy.style.setProperty('--dock-tone', getComputedStyle(element).getPropertyValue('--dock-tone'))
    element.textContent = text
    if (reduced.matches || !element.isConnected) return
    copy.classList.add('stateOutgoing')
    copy.setAttribute('aria-hidden', 'true')
    copy.inert = true
    element.after(copy)
    outgoing = copy
    const fade = copy.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }],
      { duration: STATE_MS, easing: EASE_OUT, fill: 'forwards' })
    incoming = element.animate([{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)' }],
      { duration: STATE_MS, easing: EASE_OUT })
    void fade.finished.catch(() => {}).then(() => { copy.remove(); if (outgoing === copy) outgoing = undefined })
  }
}

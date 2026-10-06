import { loadingDotMotion, loadingDuration } from './loadingDotMotion'
import { attachBlurPresence } from './blurState'
import { EASE_OUT } from './motion'

// Cubic Hermite interpolation preserves the simulated velocity at every
// keyframe. With Bezier x controls at 1/3 and 2/3, x(time) is exactly linear.
const frames = (component: 1 | 3) => {
  // Keep the ends of each hold, without hundreds of identical keyframes.
  const points = loadingDotMotion.filter((point, i, all) => i === 0 || i === all.length - 1 ||
    point[component + 1] !== 0 || point[component] !== all[i - 1][component] || point[component] !== all[i + 1][component])
  return points.map((point, i) => {
    const x = point[component], velocity = point[component + 1]
    const next = points[Math.min(i + 1, points.length - 1)]
    const distance = next[component] - x, dt = next[0] - point[0]
    const easing = Math.abs(distance) < 1e-7 ? 'linear'
      : `cubic-bezier(.333333333,${(velocity * dt / (3 * distance)).toFixed(8)},.666666667,${(1 - next[component + 1] * dt / (3 * distance)).toFixed(8)})`
    return { offset: point[0] / (loadingDuration / 1000), easing,
      ...(component === 1 ? { translate: `${x}px 0` } : { transform: `scale(${x})` }) }
  })
}
const positionFrames = frames(1), scaleFrames = frames(3)

export function attachLoadingDots(dots: HTMLElement, signal: AbortSignal, fadeEasing = EASE_OUT) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let active = false, animations: Animation[] = []
  let generation = 0
  const show = attachBlurPresence(dots, signal, false, fadeEasing)
  const update = () => {
    const play = active && !reduced.matches && !signal.aborted
    if (play && !animations.length) {
      const start = document.timeline.currentTime
      animations = [...dots.children].flatMap((dot, i) => {
        const timing = { duration: loadingDuration, iterations: Infinity, iterationStart: ((i + 1) % 4) / 4, easing: 'linear' }
        return [positionFrames, scaleFrames].map(keyframes => {
          const animation = dot.animate(keyframes, timing)
          // Shared clock, distinct lifetime phases; no timers or DOM recycling.
          if (typeof start === 'number') animation.startTime = start
          return animation
        })
      })
    } else if (!play) {
      for (const animation of animations) animation.cancel()
      animations = []
    }
  }
  reduced.addEventListener('change', update, { signal })
  signal.addEventListener('abort', update, { once: true })
  let requested = false
  return (loading: boolean, transitionMs?: number) => {
    if (loading === requested) return
    requested = loading
    const version = ++generation
    if (loading) { active = true; update(); void show(true, transitionMs) }
    else void show(false, transitionMs).then(() => {
      if (version === generation) { active = false; update() }
    })
  }
}

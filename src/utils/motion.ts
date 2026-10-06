// Short feedback fades use a quick ease-out; spatial transitions have their
// own slower curves so they retain weight instead of snapping into position.
export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)'
export const EASE_IN_OUT = 'cubic-bezier(.65,0,.16,1)'
export const TOOLBAR_OPEN_MS = 1800
export const TOOLBAR_CLOSE_MS = 1600

type Size = { width: number; height: number }

// Step response of a damped spring, with position AND velocity encoded into
// compositor keyframes. There is no per-frame JavaScript simulation. The final
// tiny correction puts the spring exactly at rest without a last-frame snap.
export function toolbarSpring(from: Size, to: Size, duration: number, limit: number, axis: 'width' | 'height' = 'width'): Keyframe[] {
  const distance = to[axis] - from[axis]
  const allowance = distance >= 0 ? Math.max(0, limit - to.width) : Math.max(0, to.width - 44)
  const overshoot = axis === 'height' ? Math.min(distance >= 0 ? .08 : .23, (distance >= 0 ? 1 : 3) / Math.max(1, Math.abs(distance)))
    : Math.max(.001, Math.min(.068, allowance / Math.max(1, Math.abs(distance))))
  const omega = (axis === 'height' ? 9 : 7.5) * TOOLBAR_OPEN_MS / duration
  return springKeyframes(from[axis], to[axis], duration, overshoot, omega, value => ({ [axis]: `${value}px` }))
}

export const GLASS_RISE_MS = 1100
export function glassRiseSpring(): Keyframe[] {
  return springKeyframes(14, 0, GLASS_RISE_MS, .045, 12.5, value => ({ transform: `translateY(${value}px)` }))
}

function springKeyframes(from: number, to: number, duration: number, overshoot: number,
  omega: number, frame: (value: number) => Keyframe): Keyframe[] {
  const distance = to - from
  const log = -Math.log(overshoot)
  const damping = log / Math.sqrt(Math.PI ** 2 + log ** 2)
  const root = Math.sqrt(1 - damping * damping), frequency = omega * root
  const seconds = duration / 1000
  const raw = (time: number) => {
    const envelope = Math.exp(-damping * omega * time)
    return {
      p: 1 - envelope * (Math.cos(frequency * time) + damping / root * Math.sin(frequency * time)),
      v: omega / root * envelope * Math.sin(frequency * time),
    }
  }
  const last = raw(seconds), dp = 1 - last.p, dv = -last.v
  const state = (time: number) => {
    const u = time / seconds, r = raw(time)
    return {
      p: r.p + dp * (3 * u * u - 2 * u ** 3) + dv * seconds * (u ** 3 - u * u),
      v: r.v + dp * (6 * u - 6 * u * u) / seconds + dv * (3 * u * u - 2 * u),
    }
  }
  const count = Math.ceil(duration / 40)
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = seconds * i / count, a = state(t), b = state(Math.min(seconds, t + seconds / count))
    const step = b.p - a.p, dt = seconds / count
    const easing = i === count || Math.abs(step) < 1e-8 ? 'linear'
      : `cubic-bezier(.333333,${a.v * dt / (3 * step)},.666667,${1 - b.v * dt / (3 * step)})`
    return { offset: i / count, easing, ...frame(from + distance * a.p) }
  })
}

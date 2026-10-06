const timeScale = 1.6
export const loadingBeat = 1000 * timeScale
export const loadingDuration = loadingBeat * 4
// The observed delay is 35ms (half of 70ms), even after slowing the entire
// trajectory. Divide the base delay by the time scale to avoid stretching it.
const lag = .035 / timeScale, travel = .62, grow = .15
const baseBeat = 1

const smooth = (u: number): [number, number] => {
  if (u <= 0) return [0, 0]
  if (u >= 1) return [1, 0]
  return [u ** 3 * (10 - 15 * u + 6 * u * u), 30 * u * u * (1 - u) ** 2]
}
// Unit step of an underdamped spring, starting from rest. Ease out only the
// tiny residual after 480ms so every resting slot has exactly zero velocity.
const spring = (t: number): [number, number] => {
  if (t <= 0) return [0, 0]
  if (t >= travel) return [1, 0]
  const omega = 18, zeta = .64, decay = omega * zeta
  const damped = omega * Math.sqrt(1 - zeta * zeta), e = Math.exp(-decay * t)
  const residual = -e * (Math.cos(damped * t) + decay / damped * Math.sin(damped * t))
  const velocity = e * omega * omega / damped * Math.sin(damped * t)
  const [fade, slope] = smooth((t - .48) / (travel - .48))
  return [1 + residual * (1 - fade), velocity * (1 - fade) - residual * slope / (travel - .48)]
}

// One ball: enter -> slot 1 -> slot 2 -> slot 3 -> exit. The other three
// reuse this trajectory one beat apart. Delayed hops propagate the push right.
// [time in seconds, horizontal offset from center, speed, scale, scale speed].
// Prepared once; playback itself runs entirely on compositor animations.
const sampleTimes = new Set(Array.from({ length: 201 }, (_, i) => i / 50))
for (let hop = 0; hop < 4; hop++) for (const t of [0, grow, .48, travel]) {
  sampleTimes.add(+(hop * (baseBeat + lag) + t).toFixed(6))
}
export const loadingDotMotion = [...sampleTimes].sort((a, b) => a - b).map(t => {
  let x = -28, speed = 0
  for (let hop = 0; hop < 4; hop++) {
    const [position, velocity] = spring(t - hop * (baseBeat + lag))
    x += 14 * position
    speed += 14 * velocity
  }
  const [enter, enterSpeed] = smooth(t / grow)
  const [leave, leaveSpeed] = smooth((t - 3 * (baseBeat + lag)) / grow)
  return [t * timeScale, x, speed / timeScale, enter - leave, (enterSpeed - leaveSpeed) / grow / timeScale] as const
})

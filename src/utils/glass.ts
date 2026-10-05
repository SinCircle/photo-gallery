import { captureGlassScene } from './glassScene'
import { createGlassRenderer } from './glassRenderer'

const REGULAR_GLASS = JSON.stringify({ floating: true, cornerRadius: 40, blurAmount: 0 })
let available: boolean | undefined
function supportsWebGL() {
  if (available !== undefined) return available
  const context = document.createElement('canvas').getContext('webgl')
  available = !!context
  context?.getExtension('WEBGL_lose_context')?.loseContext()
  return available
}

// The public API has init/destroy, but no pause. Render a small, isolated scene,
// copy its documented DOM output, then destroy the instance. The page displays
// refracted pixels without keeping the library's render loop alive.
export async function attachGlass(root: HTMLElement, glass: HTMLElement, signal: AbortSignal) {
  glass.dataset.config = REGULAR_GLASS
  glass.dataset.glass = 'css'
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let timer = 0
  let changedAt = 0
  let busy = false
  let again = false
  let generation = 0
  let previous = ''
  let surface: string | undefined
  const clearSurface = () => {
    if (surface) URL.revokeObjectURL(surface)
    surface = undefined
    glass.style.removeProperty('--glass-refraction')
    glass.style.removeProperty('--glass-refraction-size')
    glass.style.removeProperty('--glass-refraction-position')
  }
  let failed = false
  const pointers = new Set<number>()
  let lifetime = new AbortController()
  signal.addEventListener('abort', () => lifetime.abort(), { once: true })
  let renderer: Awaited<ReturnType<typeof createGlassRenderer>> | undefined

  const render = async () => {
    if (signal.aborted || !glass.isConnected || failed || preference.matches || pointers.size ||
      glass.getAnimations().length || glass.dataset.toolbar === 'collapsed') return
    if (busy) { again = true; return }
    const token = generation
    busy = true
    try {
      const scene = captureGlassScene(root, glass)
      if (!scene || scene.key === previous) return
      if (!supportsWebGL()) { failed = true; return }
      renderer ??= await createGlassRenderer(lifetime.signal)
      const output = await renderer.render(scene)
      if (signal.aborted || token !== generation || preference.matches) return
      const next = URL.createObjectURL(output.blob)
      const image = new Image()
      image.src = next
      try { await image.decode() } catch (error) { URL.revokeObjectURL(next); throw error }
      if (signal.aborted || token !== generation || preference.matches) { URL.revokeObjectURL(next); return }
      const style = document.createElement('span').style
      style.cssText = output.style
      clearSurface()
      surface = next
      // A native background avoids a live canvas and a second rounded clip layer.
      glass.style.setProperty('--glass-refraction', `url("${next}")`)
      glass.style.setProperty('--glass-refraction-size', `${style.width} ${style.height}`)
      glass.style.setProperty('--glass-refraction-position', `${style.left} ${style.top}`)
      glass.dataset.glass = 'webgl'
      previous = scene.key
    } catch {
      if (token === generation && !signal.aborted) {
        failed = true
        lifetime.abort()
        renderer = undefined
        clearSurface()
        previous = ''
        glass.dataset.glass = 'css'
      }
    } finally {
      busy = false
      if (again) { again = false; schedule() }
    }
  }
  const flush = () => {
    timer = 0
    if (signal.aborted || failed || preference.matches) return
    const remaining = 240 - (performance.now() - changedAt)
    if (remaining > 0) { timer = window.setTimeout(flush, remaining); return }
    void render()
  }
  const schedule = () => {
    if (signal.aborted || failed || preference.matches || pointers.size) return
    changedAt = performance.now()
    if (!timer) timer = window.setTimeout(flush, 240)
  }
  signal.addEventListener('abort', () => {
    generation++
    clearTimeout(timer)
    clearSurface()
  }, { once: true })
  preference.addEventListener('change', () => {
    generation++
    previous = ''
    failed = false
    clearSurface()
    glass.dataset.glass = 'css'
    if (preference.matches) { lifetime.abort(); renderer = undefined }
    else {
      if (lifetime.signal.aborted) lifetime = new AbortController()
      schedule()
    }
  }, { signal })
  root.addEventListener('load', schedule, { capture: true, signal })
  root.addEventListener('transitionend', schedule, { signal })
  glass.addEventListener('glassrefresh', schedule, { signal })
  window.addEventListener('pointerdown', event => { pointers.add(event.pointerId) }, { passive: true, signal })
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); schedule() }
  window.addEventListener('pointerup', release, { passive: true, signal })
  window.addEventListener('pointercancel', release, { passive: true, signal })
  for (const event of ['resize', 'scroll', 'wheel']) {
    window.addEventListener(event, schedule, { passive: true, signal })
  }
  await document.fonts.ready
  schedule()
}

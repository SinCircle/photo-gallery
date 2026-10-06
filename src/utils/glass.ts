import { captureGlassScene } from './glassScene'
import { createGlassRenderer } from './glassRenderer'
import { regularGlassConfig } from './glassConfig'
import { EASE_OUT, GLASS_RISE_MS, glassRiseSpring } from './motion'

const REGULAR_GLASS = JSON.stringify({ floating: true, cornerRadius: 40, blurAmount: 0 })
let available: boolean | undefined
function supportsWebGL() {
  if (available !== undefined) return available
  const context = document.createElement('canvas').getContext('webgl')
  available = !!context
  context?.getExtension('WEBGL_lose_context')?.loseContext()
  return available
}

// One native LiquidGlass instance lives until the view is disposed. Dirty scene
// pixels are coalesced into the next eligible frame, including during a drag
// and while collapsed. Its public markChanged API wakes the shader work.
export async function attachGlass(root: HTMLElement, glass: HTMLElement, signal: AbortSignal) {
  const capsules = glass.hasAttribute('data-capsule-root')
  glass.dataset.config = capsules ? regularGlassConfig() : REGULAR_GLASS
  glass.dataset.glass = 'css'
  const lifetime = new AbortController()
  signal.addEventListener('abort', () => lifetime.abort(), { once: true })
  let renderer: Awaited<ReturnType<typeof createGlassRenderer>> | undefined
  let ready = false
  let appearance: Animation[] = []
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const finishAppearance = () => {
    delete glass.dataset.glassAppearing
    if (!signal.aborted) glass.dispatchEvent(new Event('glassrefresh'))
  }
  const reveal = (mode: 'webgl' | 'css') => {
    glass.dataset.glass = mode
    if (!ready && capsules && !reduced.matches) {
      const bar = glass.querySelector<HTMLElement>(':scope > [data-glass-capsule]')!
      glass.dataset.glassAppearing = ''
      appearance = [bar.animate([
        { opacity: 0, '--glass-material': '0' },
        { opacity: 1, '--glass-material': '1' },
      ], { duration: 1400, easing: EASE_OUT, fill: 'backwards' }),
      bar.animate(glassRiseSpring(), { duration: GLASS_RISE_MS, fill: 'backwards' })]
      void Promise.all(appearance.map(animation => animation.finished)).then(finishAppearance).catch(finishAppearance)
    }
    delete glass.dataset.glassPending
    if (!ready) { ready = true; glass.dispatchEvent(new Event('glassready')) }
    glass.dispatchEvent(new Event('glassgeometry'))
  }
  reduced.addEventListener('change', () => { if (reduced.matches) for (const animation of appearance) animation.cancel() }, { signal })
  signal.addEventListener('abort', () => { for (const animation of appearance) animation.cancel() }, { once: true })
  // This event follows the native drawImage into the visible output canvas.
  // A scheduled animation frame by itself is not proof that glass was painted.
  glass.addEventListener('glasspaint', () => {
    if (!ready && renderer?.scene.dataset.ready !== undefined) {
      reveal('webgl')
      glass.dispatchEvent(new Event('glassscene'))
    }
  }, { signal })
  let dirty = false
  let force = false
  let previous = ''
  let motionFrame = 0
  let lastFrame = -Infinity
  const animated = new Map<Element, Set<string>>()
  const moving = () => animated.size > 0 || glass.dataset.moving !== undefined || glass.dataset.glassAppearing !== undefined
  const update = () => {
    dirty = false
    if (signal.aborted || !glass.isConnected) return
    // The same photo invalidations drive ink in CSS fallback mode too.
    if (!renderer) { glass.dispatchEvent(new Event('glassscene')); return }
    try {
      const scene = captureGlassScene(root, glass)
      if (!scene) return
      if (!force && previous === scene.key) {
        // A capsule can move over an unchanged shared scene. Its own sampling
        // position still needs the native shader, without repainting the source.
        if (moving()) {
          renderer.changed()
          glass.dispatchEvent(new Event('glassscene'))
        }
        return
      }
      force = false
      scene.draw(renderer.scene)
      renderer.scene.dataset.ready = ''
      glass.dispatchEvent(new Event('glassscene'))
      renderer.changed()
      previous = scene.key
    } catch {
      lifetime.abort()
      renderer = undefined
      reveal('css')
    }
  }
  const schedule = (refresh = false) => {
    force ||= refresh
    dirty = true
    if (!motionFrame) motionFrame = requestAnimationFrame(followMotion)
  }
  const followMotion = (now: number) => {
    motionFrame = 0
    if (signal.aborted) return
    // The photo's transform stays on the compositor at the display refresh
    // rate. Its small refracted strip needs at most one fresh sample per 16ms.
    if (now - lastFrame < 1000 / 60 - .5) {
      motionFrame = requestAnimationFrame(followMotion)
      return
    }
    lastFrame = now
    if (dirty || moving()) update()
    if ((dirty || moving()) && !motionFrame) motionFrame = requestAnimationFrame(followMotion)
  }
  // Observe only the few visual nodes whose transforms/opacities drive the
  // photo. No whole-tree attributes/subtree observer, no pointermove redraws.
  const observer = new MutationObserver(() => schedule())
  for (const element of root.querySelectorAll('.photoPan,.photoZoom,.photoStage,.photoImg,.photoBg')) {
    observer.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'src'] })
  }
  root.addEventListener('transitionrun', event => {
    if (!(event.target instanceof Element) || (!capsules && glass.contains(event.target))) return
    const properties = animated.get(event.target) ?? new Set<string>()
    properties.add(event.propertyName)
    animated.set(event.target, properties)
    schedule()
  }, { signal })
  const stopMotion = (event: TransitionEvent) => {
    if (event.target instanceof Element) {
      const properties = animated.get(event.target)
      properties?.delete(event.propertyName)
      if (!properties?.size) animated.delete(event.target)
    }
    schedule()
  }
  root.addEventListener('transitionend', stopMotion, { signal })
  root.addEventListener('transitioncancel', stopMotion, { signal })
  root.addEventListener('load', () => schedule(true), { capture: true, signal })
  glass.addEventListener('glassrefresh', () => schedule(true), { signal })
  glass.addEventListener('glassgeometry', () => schedule(true), { signal })
  for (const event of ['resize', 'scroll']) window.addEventListener(event, () => schedule(), { passive: true, signal })
  const resize = new ResizeObserver(() => schedule(true))
  resize.observe(glass)
  signal.addEventListener('abort', () => {
    observer.disconnect(); resize.disconnect(); cancelAnimationFrame(motionFrame)
  }, { once: true })
  if (!supportsWebGL()) { reveal('css'); schedule(true); return }
  try {
    renderer = await createGlassRenderer(glass, lifetime.signal)
    if (signal.aborted) return
    // Populate the canvas before the native renderer's first scheduled frame.
    force = true
    update()
    // The glasspaint listener reveals the surface after the first real draw.
  } catch { if (!signal.aborted) reveal('css') }
}

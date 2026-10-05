import { captureGlassScene } from './glassScene'
import { createGlassRenderer } from './glassRenderer'
import { GLASS_BLUR_PX, regularGlassConfig } from './glassConfig'

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
// pixels are updated in the current event turn, including while a pointer is
// held and while collapsed. Its public markChanged API wakes the shader work.
export async function attachGlass(root: HTMLElement, glass: HTMLElement, signal: AbortSignal) {
  const capsules = glass.hasAttribute('data-capsule-root')
  glass.dataset.config = capsules ? regularGlassConfig() : REGULAR_GLASS
  if (capsules) glass.style.setProperty('--capsule-blur', `${GLASS_BLUR_PX}px`)
  glass.dataset.glass = 'css'
  if (!supportsWebGL()) return
  const lifetime = new AbortController()
  signal.addEventListener('abort', () => lifetime.abort(), { once: true })
  let renderer: Awaited<ReturnType<typeof createGlassRenderer>> | undefined
  let queued = false
  let force = false
  let previous = ''
  let motionFrame = 0
  const animated = new Set<Element>()
  const update = () => {
    queued = false
    if (!renderer || signal.aborted || !glass.isConnected) return
    try {
      const scene = captureGlassScene(root, glass)
      if (!scene) return
      if (!force && previous === scene.key) {
        // A capsule can move over an unchanged shared scene. Its own sampling
        // position still needs the native shader, without repainting the source.
        if (animated.size) renderer.changed()
        return
      }
      force = false
      scene.draw(renderer.scene)
      renderer.changed()
      previous = scene.key
    } catch {
      lifetime.abort()
      renderer = undefined
      glass.dataset.glass = 'css'
    }
  }
  const schedule = (refresh = false) => {
    force ||= refresh
    if (!queued) { queued = true; queueMicrotask(update) }
  }
  const followMotion = () => {
    motionFrame = 0
    schedule()
    for (const element of animated) if (!element.getAnimations({ subtree: true }).length) animated.delete(element)
    if (animated.size) motionFrame = requestAnimationFrame(followMotion)
  }
  const startMotion = (element: Element) => {
    animated.add(element)
    if (!motionFrame) motionFrame = requestAnimationFrame(followMotion)
  }
  // Observe only the few visual nodes whose transforms/opacities drive the
  // photo. No whole-tree attributes/subtree observer, no pointermove redraws.
  const observer = new MutationObserver(() => schedule())
  for (const element of root.querySelectorAll('.photoPan,.photoZoom,.photoStage,.photoImg,.photoBg')) {
    observer.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'src'] })
  }
  root.addEventListener('transitionrun', event => {
    if (event.target instanceof Element && (capsules || !glass.contains(event.target))) startMotion(event.target)
  }, { signal })
  root.addEventListener('transitionend', () => schedule(), { signal })
  root.addEventListener('load', () => schedule(true), { capture: true, signal })
  glass.addEventListener('glassrefresh', () => schedule(true), { signal })
  glass.addEventListener('glassgeometry', () => { schedule(true); startMotion(glass) }, { signal })
  for (const event of ['resize', 'scroll']) window.addEventListener(event, () => schedule(), { passive: true, signal })
  const resize = new ResizeObserver(() => schedule(true))
  resize.observe(glass)
  signal.addEventListener('abort', () => {
    observer.disconnect(); resize.disconnect(); cancelAnimationFrame(motionFrame)
  }, { once: true })
  try {
    renderer = await createGlassRenderer(glass, lifetime.signal)
    if (signal.aborted) return
    schedule(true)
    // The library's own next frame paints the now-dirty live source.
    requestAnimationFrame(() => { if (!signal.aborted && renderer) glass.dataset.glass = 'webgl' })
  } catch { glass.dataset.glass = 'css' }
}

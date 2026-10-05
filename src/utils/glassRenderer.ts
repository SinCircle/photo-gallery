import { LiquidGlass } from '@ybouane/liquidglass'
import { regularGlassConfig } from './glassConfig'

// Both sampled pixels and the glass are direct children of this root. Keeping
// controls outside it avoids rasterising changing EXIF/buttons into the glass.
// The scene canvas is a live pixel source, not a PNG or CSS background snapshot.
export async function createGlassRenderer(glass: HTMLElement, signal: AbortSignal) {
  const capsules = [...glass.querySelectorAll<HTMLElement>(':scope > [data-glass-capsule]')]
  if (capsules.length) {
    // These are the actual EXIF/button elements, not proxy glass surfaces.
    // The native instance owns their canvas output and stacking composition.
    const scene = document.createElement('canvas')
    scene.dataset.glassScene = ''
    scene.style.cssText = 'position:absolute;opacity:0;pointer-events:none;z-index:0;'
    glass.prepend(scene)
    for (const capsule of capsules) capsule.dataset.config = regularGlassConfig()
    let instance: LiquidGlass | undefined
    const cleanup = () => { instance?.destroy(); scene.remove() }
    signal.addEventListener('abort', cleanup, { once: true })
    try {
      instance = await LiquidGlass.init({ root: glass, glassElements: capsules })
      if (signal.aborted) { cleanup(); throw new DOMException('Aborted', 'AbortError') }
      for (const capsule of capsules) {
        const output = capsule.querySelector('canvas')!
        output.getContext('2d', { willReadFrequently: true })
        output.dataset.glassOutput = capsule.dataset.glassCapsule
      }
      return { scene, changed: () => instance!.markChanged(scene) }
    } catch (error) { cleanup(); throw error }
  }
  const root = document.createElement('div')
  root.className = 'glassRoot'
  root.setAttribute('aria-hidden', 'true')
  const scene = document.createElement('canvas')
  scene.dataset.glassScene = ''
  scene.style.cssText = 'position:absolute;left:-20px;top:-20px;opacity:0;pointer-events:none;'
  const panel = document.createElement('div')
  panel.className = 'glassSurface'
  panel.dataset.config = glass.dataset.config
  panel.style.cssText = 'position:absolute;inset:0;background:transparent;pointer-events:none;'
  root.append(scene, panel)
  glass.prepend(root)
  let instance: LiquidGlass | undefined
  signal.addEventListener('abort', () => { instance?.destroy(); root.remove() }, { once: true })
  try {
    instance = await LiquidGlass.init({ root, glassElements: [panel] })
    if (signal.aborted) { instance.destroy(); root.remove(); throw new DOMException('Aborted', 'AbortError') }
    const output = panel.querySelector('canvas')!
    // A stable, read-friendly backing avoids the GPU readback stalls measured
    // on this small output. Keep the large photo and scene canvases accelerated.
    output.getContext('2d', { willReadFrequently: true })
    output.dataset.glassOutput = ''
    return {
      scene,
      changed: () => instance!.markChanged(scene),
    }
  } catch (error) { instance?.destroy(); root.remove(); throw error }
}

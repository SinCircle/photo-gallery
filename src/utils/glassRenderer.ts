import { LiquidGlass } from '@ybouane/liquidglass'

// Both sampled pixels and the glass are direct children of this root. Keeping
// controls outside it avoids rasterising changing EXIF/buttons into the glass.
// The scene canvas is a live pixel source, not a PNG or CSS background snapshot.
export async function createGlassRenderer(glass: HTMLElement, signal: AbortSignal) {
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
    output.dataset.glassOutput = ''
    return {
      scene,
      changed: () => instance!.markChanged(scene),
    }
  } catch (error) { instance?.destroy(); root.remove(); throw error }
}

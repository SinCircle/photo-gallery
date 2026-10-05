import { captureGlassScene } from './glassScene'

const REGULAR_GLASS = JSON.stringify({ floating: true, cornerRadius: 40, blurAmount: 0 })

// The public API has init/destroy, but no pause. Render a small, isolated scene,
// copy its documented DOM output, then destroy the instance. The page displays
// refracted pixels without keeping the library's render loop alive.
export async function attachGlass(root: HTMLElement, glass: HTMLElement, signal: AbortSignal) {
  glass.dataset.config = REGULAR_GLASS
  glass.dataset.glass = 'css'
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let timer = 0
  let busy = false
  let again = false
  let generation = 0
  let previous = ''
  let surface: HTMLElement | undefined

  const render = async () => {
    if (signal.aborted || preference.matches || glass.dataset.toolbar === 'collapsed') return
    if (busy) { again = true; return }
    const token = generation
    let sample: HTMLElement | undefined
    let instance: Awaited<ReturnType<typeof import('@ybouane/liquidglass').LiquidGlass.init>> | undefined
    busy = true
    try {
      const scene = captureGlassScene(root, glass)
      if (!scene || scene.key === previous) return
      const { LiquidGlass } = await import('@ybouane/liquidglass')
      if (signal.aborted || token !== generation || preference.matches) return
      sample = document.createElement('div')
      sample.setAttribute('aria-hidden', 'true')
      sample.style.cssText = `position:fixed;left:${scene.x}px;top:${scene.y}px;width:${scene.width}px;height:${scene.height}px;opacity:0;pointer-events:none;z-index:-1;`
      const panel = document.createElement('div')
      panel.dataset.config = REGULAR_GLASS
      panel.style.cssText = `position:absolute;left:20px;top:20px;width:${scene.width - 40}px;height:${scene.height - 40}px;background:transparent;`
      sample.append(scene.canvas, panel)
      document.body.append(sample)
      instance = await LiquidGlass.init({ root: sample, glassElements: [panel] })
      // init resolves before the first paint; read only the documented DOM output.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (signal.aborted || token !== generation || preference.matches) return
      const output = panel.querySelector('canvas')
      if (!output?.width || !output.height) throw new Error('No glass output')
      const canvas = document.createElement('canvas')
      canvas.width = output.width
      canvas.height = output.height
      canvas.style.cssText = output.style.cssText
      canvas.style.zIndex = '0'
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.drawImage(output, 0, 0)
      const next = document.createElement('span')
      next.className = 'glassSurface'
      next.setAttribute('aria-hidden', 'true')
      next.append(canvas)
      surface?.remove()
      surface = next
      glass.prepend(next)
      glass.dataset.glass = 'webgl'
      previous = scene.key
    } catch {
      surface?.remove()
      surface = undefined
      previous = ''
      glass.dataset.glass = 'css'
    } finally {
      instance?.destroy()
      sample?.remove()
      busy = false
      if (again) { again = false; schedule() }
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => { void render() }, 240)
  }
  signal.addEventListener('abort', () => {
    generation++
    clearTimeout(timer)
    surface?.remove()
  }, { once: true })
  preference.addEventListener('change', () => {
    generation++
    previous = ''
    surface?.remove()
    surface = undefined
    glass.dataset.glass = 'css'
    if (!preference.matches) schedule()
  }, { signal })
  root.addEventListener('load', schedule, { capture: true, signal })
  root.addEventListener('transitionend', schedule, { signal })
  glass.addEventListener('glassrefresh', schedule, { signal })
  for (const event of ['resize', 'scroll', 'pointerup', 'wheel']) {
    window.addEventListener(event, schedule, { passive: true, signal })
  }
  await document.fonts.ready
  schedule()
}

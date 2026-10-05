import type { LiquidGlass as GlassInstance } from '@ybouane/liquidglass'

// 1.0.3 has a perpetual loop and no public pause API. Keep its renderer intact,
// but cancel its next frame after each event-driven paint. Version is pinned.
type ScheduledGlass = {
  _rafId: number
  _renderLoop: () => void
  _captureGlassContent: (...args: unknown[]) => Promise<void>
}

export async function attachGlass(root: HTMLElement, glass: HTMLElement, signal: AbortSignal) {
  glass.dataset.config = JSON.stringify({ floating: true, cornerRadius: 40, blurAmount: 0 })
  glass.dataset.glass = 'css'
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  let dispose = () => {}
  let generation = 0
  const local = new AbortController()
  signal.addEventListener('abort', () => {
    generation++
    local.abort()
    dispose()
  }, { once: true })

  // Regular Glass's floating gesture must not capture clicks from old buttons.
  glass.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button, a, input, textarea')) event.stopPropagation()
  }, { signal: local.signal })

  const start = async () => {
    const token = ++generation
    dispose()
    glass.dataset.glass = 'css'
    if (signal.aborted || preference.matches) return
    const probe = document.createElement('canvas').getContext('webgl')
    if (!probe) return
    probe.getExtension('WEBGL_lose_context')?.loseContext()
    let instance: GlassInstance | undefined
    const rootStyle = root.getAttribute('style')
    const glassStyle = glass.getAttribute('style')
    const restoreStyles = () => {
      if (rootStyle === null) root.removeAttribute('style'); else root.setAttribute('style', rootStyle)
      if (glassStyle === null) glass.removeAttribute('style'); else glass.setAttribute('style', glassStyle)
    }
    try {
      await document.fonts.ready
      if (token !== generation || signal.aborted) return
      const { LiquidGlass } = await import('@ybouane/liquidglass')
      instance = await LiquidGlass.init({ root, glassElements: [glass] })
      if (token !== generation || signal.aborted) { instance.destroy(); restoreStyles(); return }
      const scheduled = instance as unknown as ScheduledGlass
      if (typeof scheduled._renderLoop !== 'function' || typeof scheduled._rafId !== 'number') {
        throw new Error('Unsupported LiquidGlass scheduler')
      }
      cancelAnimationFrame(scheduled._rafId)
      const paint = scheduled._renderLoop.bind(instance)
      const events = new AbortController()
      let frame = 0
      let stopped = false
      const wake = () => {
        if (stopped || frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          paint()
          cancelAnimationFrame(scheduled._rafId)
        })
      }
      scheduled._renderLoop = wake
      const capture = scheduled._captureGlassContent.bind(instance)
      scheduled._captureGlassContent = async (...args) => {
        await capture(...args)
        if (!stopped) { instance!.markChanged(); wake() }
      }
      const cacheUpdate = instance.capture.onCacheUpdate
      instance.capture.onCacheUpdate = (element) => { cacheUpdate?.(element); wake() }
      const changed = () => { instance!.markChanged(); wake() }
      const observer = new MutationObserver((records) => {
        const relevant = records.filter(r => !(r.target instanceof HTMLCanvasElement) && r.target !== root)
        if (!relevant.length) return
        for (const child of root.children) {
          if (child !== glass && child instanceof HTMLElement) instance!.capture.invalidateCache(child)
        }
        changed()
      })
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['src', 'class', 'style'] })
      for (const event of ['resize', 'scroll', 'pointerdown', 'pointermove', 'pointerup', 'wheel']) {
        window.addEventListener(event, changed, { passive: true, signal: events.signal })
      }
      root.addEventListener('load', changed, { capture: true, signal: events.signal })
      root.addEventListener('transitionend', changed, { signal: events.signal })
      instance.renderer.canvas.addEventListener('webglcontextlost', () => {
        dispose()
        glass.dataset.glass = 'css'
      }, { signal: events.signal })
      dispose = () => {
        stopped = true
        cancelAnimationFrame(frame)
        cancelAnimationFrame(scheduled._rafId)
        observer.disconnect()
        events.abort()
        instance!.destroy()
        restoreStyles()
      }
      glass.dataset.glass = 'webgl'
      changed()
    } catch {
      instance?.destroy()
      for (const canvas of glass.querySelectorAll('canvas')) canvas.remove()
      restoreStyles()
      glass.dataset.glass = 'css'
    }
  }
  preference.addEventListener('change', () => { void start() }, { signal: local.signal })
  await start()
}

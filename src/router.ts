import { renderGalleryView, galleryPhotoElement, rememberGalleryScroll } from './views/gallery.ts'
import { renderPhotoView } from './views/photo.ts'
import { transitionPhoto } from './utils/photoTransition.ts'

type Route = { kind: 'gallery' | 'admin' } | { kind: 'photo'; photoId: string }
function routeFromHash(): Route {
  const hash = location.hash || '#/'
  if (hash === '#/admin') return { kind: 'admin' }
  const match = hash.match(/^#\/photo\/(.+)$/)
  if (match) {
    try { return { kind: 'photo', photoId: decodeURIComponent(match[1]) } } catch { /* Invalid URL: show gallery. */ }
  }
  return { kind: 'gallery' }
}

export function startRouter(container: HTMLElement) {
  let scope = new AbortController()
  let navigation = new AbortController()
  history.scrollRestoration = 'manual'

  const render = async () => {
    navigation.abort()
    navigation = new AbortController()
    const signal = navigation.signal
    const route = routeFromHash()
    const oldPhotoId = container.querySelector<HTMLElement>('.photoShell')?.dataset.photoId
    const gallery = !!container.querySelector('.masonry:not(.adminShell .masonry)')
    if (gallery) rememberGalleryScroll()
    const direction = gallery && route.kind === 'photo' ? 'open' : oldPhotoId && route.kind === 'gallery' ? 'close' : undefined
    const source = direction === 'open' && route.kind === 'photo'
      ? galleryPhotoElement(container, route.photoId)?.querySelector<HTMLElement>('img')
      : direction === 'close' ? container.querySelector<HTMLElement>('.photoZoom') : undefined
    let finish!: () => void
    const settled = new Promise<void>(resolve => { finish = resolve })

    const update = async () => {
      if (signal.aborted) return
      scope.abort()
      scope = new AbortController()
      const viewScope = scope
      const viewSignal = scope.signal
      const cancelPendingView = () => viewScope.abort()
      signal.addEventListener('abort', cancelPendingView, { once: true })
      document.body.classList.toggle('isPhoto', route.kind === 'photo')
      try {
        if (route.kind === 'gallery') {
          await renderGalleryView(container, viewSignal, { revealPhotoId: oldPhotoId, settled })
        } else if (route.kind === 'photo') {
          window.scrollTo({ top: 0, behavior: 'instant' })
          await renderPhotoView(container, route, viewSignal, { settled })
        } else {
          window.scrollTo({ top: 0, behavior: 'instant' })
          const { renderAdminView } = await import('./views/admin.ts')
          if (viewSignal.aborted) return
          await renderAdminView(container, viewSignal)
        }
      } finally {
        // Once displayed, keep the view alive until its outgoing snapshot is
        // captured. Pending fetches still abort immediately on newer input.
        signal.removeEventListener('abort', cancelPendingView)
      }
    }

    try {
      if (direction && source && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await transitionPhoto({ direction, source, update, signal,
          destination: () => direction === 'open' ? container.querySelector('.photoZoom')
            : galleryPhotoElement(container, oldPhotoId!)?.querySelector('img') ?? null,
        })
      } else await update()
    } catch {
      if (!signal.aborted) {
        scope.abort()
        document.body.classList.remove('isPhoto')
        const error = document.createElement('div')
        error.className = 'empty'
        error.textContent = '照片读取失败'
        container.replaceChildren(error)
      }
    } finally {
      finish()
      if (!signal.aborted) {
        delete document.documentElement.dataset.photoTransition
      }
    }
  }

  window.addEventListener('hashchange', () => { void render() })
  void render()
}

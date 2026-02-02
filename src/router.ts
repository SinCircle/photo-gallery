import { renderGalleryView } from './views/gallery.ts'
import { renderPhotoView } from './views/photo.ts'

export function startRouter(container: HTMLElement) {
  let transitionTimer: number | null = null
  let renderToken = 0

  const render = () => {
    renderToken += 1
    const token = renderToken

    document.body.classList.add('isTransitioning')
    if (transitionTimer) window.clearTimeout(transitionTimer)

    transitionTimer = window.setTimeout(() => {
      if (token !== renderToken) return

      const hash = window.location.hash || '#/'
      if (hash === '#/' || hash === '#') {
        document.body.classList.remove('isPhoto')
        void renderGalleryView(container)
      } else {
        const photoMatch = hash.match(/^#\/photo\/(.+)$/)
        if (photoMatch) {
          document.body.classList.add('isPhoto')
          void renderPhotoView(container, { photoId: photoMatch[1] })
        } else {
          document.body.classList.remove('isPhoto')
          window.location.hash = '#/'
        }
      }

      requestAnimationFrame(() => {
        if (token !== renderToken) return
        document.body.classList.remove('isTransitioning')
      })
    }, 120)

    return

    const hash = window.location.hash || '#/'
    if (hash === '#/' || hash === '#') {
      document.body.classList.remove('isPhoto')
      void renderGalleryView(container)
      return
    }

    const photoMatch = hash.match(/^#\/photo\/(.+)$/)
    if (photoMatch) {
      document.body.classList.add('isPhoto')
      void renderPhotoView(container, { photoId: photoMatch[1] })
      return
    }

    // Fallback
    document.body.classList.remove('isPhoto')
    window.location.hash = '#/'
  }

  window.addEventListener('hashchange', render)
  render()
}

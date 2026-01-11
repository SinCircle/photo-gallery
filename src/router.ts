import { renderGalleryView } from './views/gallery.ts'
import { renderPhotoView } from './views/photo.ts'

export function startRouter(container: HTMLElement) {
  const render = () => {
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

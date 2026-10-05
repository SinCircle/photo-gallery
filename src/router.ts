import { renderGalleryView } from './views/gallery.ts'
import { renderPhotoView } from './views/photo.ts'

export function startRouter(container: HTMLElement) {
  let transitionTimer: number | null = null
  let renderToken = 0
  let scope = new AbortController()

  const render = () => {
    scope.abort()
    scope = new AbortController()
    const signal = scope.signal
    renderToken += 1
    const token = renderToken

    const showError = () => {
      if (signal.aborted) return
      container.replaceChildren()
      const error = document.createElement('div')
      error.className = 'empty'
      error.textContent = '照片读取失败'
      container.append(error)
    }
    document.body.classList.add('isTransitioning')
    if (transitionTimer) window.clearTimeout(transitionTimer)

    transitionTimer = window.setTimeout(() => {
      if (token !== renderToken) return

      const hash = window.location.hash || '#/'
      if (hash === '#/' || hash === '#') {
        document.body.classList.remove('isPhoto')
        void renderGalleryView(container, signal).catch(showError)
      } else {
        const photoMatch = hash.match(/^#\/photo\/(.+)$/)
        if (photoMatch) {
          document.body.classList.add('isPhoto')
          void renderPhotoView(container, { photoId: decodeURIComponent(photoMatch[1]) }, signal).catch(showError)
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
  }

  window.addEventListener('hashchange', render)
  render()
}

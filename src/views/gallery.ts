import { getAllPhotos, getKnownPhotos, thumbnailUrl, photoFileName } from '../photos'
import { clear, el } from '../utils/dom'
import { pickReadableInkFromBottomLeft } from '../utils/color'
import { formatDateOnly } from '../utils/exif'

let cachedRoot: HTMLElement | null = null
let cachedKey = ''
let cachedScrollY = 0

export function rememberGalleryScroll() { cachedScrollY = window.scrollY }

export function galleryPhotoElement(container: HTMLElement, photoId: string) {
  return [...container.querySelectorAll<HTMLElement>('.tile')]
    .find(tile => tile.dataset.photoId === photoId)
}

type GalleryOptions = { revealPhotoId?: string; settled?: Promise<void> }

export function invalidateGallery() {
  cachedRoot = null
  cachedKey = ''
}

export async function renderGalleryView(container: HTMLElement, signal: AbortSignal, options: GalleryOptions = {}) {
  const restorePosition = () => {
    if (signal.aborted) return
    window.scrollTo({ top: cachedScrollY, behavior: 'instant' })
    const tile = options.revealPhotoId ? galleryPhotoElement(container, options.revealPhotoId) : undefined
    if (tile) {
      const r = tile.getBoundingClientRect()
      if (r.bottom <= 0 || r.top >= innerHeight) tile.scrollIntoView({ block: 'center', behavior: 'instant' })
      tile.focus({ preventScroll: true })
    }
  }
  if (cachedRoot) {
    clear(container)
    container.append(cachedRoot)
    restorePosition()
    // The cached grid is ready now. Network revalidation must not hold the
    // transition's screenshot, or replace its target halfway through motion.
    void (async () => {
      try {
        const photos = await getAllPhotos()
        await options.settled
        if (!signal.aborted && JSON.stringify(photos) !== cachedKey) {
          rememberGalleryScroll()
          invalidateGallery()
          await renderGalleryView(container, signal, options)
        }
      } catch { /* Keep the visible gallery if revalidation is unavailable. */ }
    })()
    return
  }

  // Direct links already fetched this list for the photo view. Returning must
  // not wait for another API round trip before the first animation frame.
  const photos = (options.revealPhotoId ? getKnownPhotos() : undefined) ?? await getAllPhotos()
  if (signal.aborted) return
  clear(container)
  const shell = el('div', { className: 'shell' })
  const content = el('main', { className: 'content contentNoTopbar' })
  const masonry = el('div', { className: 'masonry' })
  content.append(masonry)
  shell.append(content)
  cachedRoot = shell
  cachedKey = JSON.stringify(photos)

  if (photos.length === 0) content.append(el('div', { className: 'glass empty' }, ['未找到图片。']))

  for (const photo of photos) {
    const link = el('a', {
      href: `#/photo/${encodeURIComponent(photo.id)}`,
      className: 'tile',
      title: photoFileName(photo),
    })
    if (photo.id.startsWith('!')) link.classList.add('isFeatured')
    link.dataset.photoId = photo.id

    const media = el('div', { className: 'tileMedia' })
    media.style.aspectRatio = `${photo.width} / ${photo.height}`
    const img = el('img', {
      alt: photoFileName(photo),
      loading: 'lazy',
      decoding: 'async',
      width: photo.width,
      height: photo.height,
    })
    const dt = photo.takenAt ? new Date(photo.takenAt) : null
    const date = el('div', { className: 'tileDate', title: '拍摄日期' }, [
      dt && !Number.isNaN(dt.getTime()) ? formatDateOnly(dt) : '',
    ])
    date.dataset.role = 'date'
    img.addEventListener('load', () => {
      img.classList.add('isLoaded')
      const colorDate = () => {
        if (!img.isConnected) return
        try {
          const ink = pickReadableInkFromBottomLeft(img)
          date.style.color = ink.color
          date.style.textShadow = `0 1px 10px ${ink.shadow}`
        } catch { /* Keep CSS ink if sampling fails. */ }
      }
      // A first visit can decode many tiles together. Date colour readbacks
      // must not interrupt the shared photo's return to the grid.
      void (options.settled ?? Promise.resolve()).then(() => {
        if ('requestIdleCallback' in window) requestIdleCallback(colorDate)
        else setTimeout(colorDate, 0)
      })
    }, { once: true })
    // Failed thumbnails keep the same reserved rectangle and date stamp.
    img.src = thumbnailUrl(photo)
    media.append(img, date)
    link.append(media)
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      rememberGalleryScroll()
      window.location.hash = link.hash
    })
    masonry.append(link)
  }
  container.append(shell)
  restorePosition()
}

import { getAllPhotos, thumbnailUrl } from '../photos'
import { clear, el } from '../utils/dom'
import { pickReadableInkFromBottomLeft } from '../utils/color'
import { formatDateOnly } from '../utils/exif'

let cachedRoot: HTMLElement | null = null
let cachedKey = ''
let cachedScrollY = 0

export function invalidateGallery() {
  cachedRoot = null
  cachedKey = ''
}

export async function renderGalleryView(container: HTMLElement, signal: AbortSignal) {
  if (cachedRoot) {
    clear(container)
    container.append(cachedRoot)
    requestAnimationFrame(() => {
      if (!signal.aborted) window.scrollTo({ top: cachedScrollY })
    })
    try {
      const photos = await getAllPhotos()
      if (!signal.aborted && JSON.stringify(photos) !== cachedKey) {
        invalidateGallery()
        await renderGalleryView(container, signal)
      }
    } catch {
      // Keep the already displayed gallery when revalidation is unavailable.
    }
    return
  }

  const photos = await getAllPhotos()
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
      title: photo.id,
    })
    if (photo.id.startsWith('!')) link.classList.add('isFeatured')
    link.dataset.photoId = photo.id

    const media = el('div', { className: 'tileMedia' })
    media.style.aspectRatio = `${photo.width} / ${photo.height}`
    const img = el('img', {
      alt: photo.id,
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
      try {
        const ink = pickReadableInkFromBottomLeft(img)
        date.style.color = ink.color
        date.style.textShadow = `0 1px 10px ${ink.shadow}`
      } catch {
        // Keep the original CSS white ink and shadow if canvas sampling fails.
      }
    }, { once: true })
    // Failed thumbnails keep the same reserved rectangle and date stamp.
    img.src = thumbnailUrl(photo)
    media.append(img, date)
    link.append(media)
    link.addEventListener('click', (event) => {
      event.preventDefault()
      cachedScrollY = window.scrollY
      window.location.hash = link.hash
    })
    masonry.append(link)
  }
  container.append(shell)
}

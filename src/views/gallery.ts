import { getAllPhotos } from '../photos'
import { clear, el } from '../utils/dom'
import { pickReadableInkFromBottomLeft } from '../utils/color'
import { getThumbnailUrl } from '../utils/thumbs'
import { formatDateOnly } from '../utils/exif'

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

let cachedRoot: HTMLElement | null = null
let cachedKey = ''
let cachedScrollY = 0

export async function renderGalleryView(container: HTMLElement) {
  // Keep the gallery DOM in memory so going back doesn't reload everything.
  if (cachedRoot) {
    clear(container)
    container.append(cachedRoot)

    // Restore previous scroll position.
    requestAnimationFrame(() => {
      window.scrollTo({ top: cachedScrollY })
    })

    // Revalidate in the background: only rebuild if the manifest changed.
    void (async () => {
      const next = await getAllPhotos()
      const nextKey = next.map((p) => p.id).join('|')
      if (nextKey !== cachedKey) {
        cachedRoot = null
        cachedKey = ''
        await renderGalleryView(container)
      }
    })()

    return
  }

  clear(container)
  const shell = el('div', { className: 'shell' })
  const content = el('main', { className: 'content contentNoTopbar' })
  const loading = el('div', { className: 'glass empty' }, ['正在加载图片…'])
  content.append(loading)
  shell.append(content)
  container.append(shell)
  cachedRoot = shell

  const photos = await getAllPhotos()
  cachedKey = photos.map((p) => p.id).join('|')

  loading.remove()

  if (photos.length === 0) {
    content.append(
      el('div', { className: 'glass empty' }, [
        el('div', {}, ['未找到图片。']),
        el('div', {}, ['把照片放入 images 后刷新页面即可。']),
      ]),
    )
    return
  }

  const masonry = el('div', { className: 'masonry' })
  content.append(masonry)

  const viewportMargin = () => `${window.innerHeight}px 0px ${window.innerHeight}px 0px`
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const tile = entry.target as HTMLElement
        if (!entry.isIntersecting) continue

        const img = tile.querySelector('img') as HTMLImageElement | null
        const dateEl = tile.querySelector('[data-role="date"]') as HTMLElement | null

        const markDone = (key: 'thumb' | 'date') => {
          tile.dataset[key] = '1'
          if (tile.dataset.thumb === '1' && tile.dataset.date === '1') {
            tile.classList.add('isReady')
            io.unobserve(tile)
          }
        }

        // Load thumbnail (ONLY pre-generated thumbnails, never original images)
        if (img && !img.dataset.loaded) {
          img.dataset.loaded = '1'
          const thumbUrl = tile.getAttribute('data-thumb-url')
          
          if (!thumbUrl) {
            console.error('[gallery] No thumbnail URL for tile')
            io.unobserve(tile)
            tile.remove()
            return
          }

          void (async () => {
            try {
              // Load ONLY the pre-generated thumbnail
              const objectUrl = await getThumbnailUrl(thumbUrl)
              
              img.addEventListener(
                'load',
                () => {
                  const ink = pickReadableInkFromBottomLeft(img)
          
                  if (dateEl) {
                    dateEl.style.color = ink.color
                    dateEl.style.textShadow = `0 1px 10px ${ink.shadow}`
                  }

                  markDone('thumb')
                },
                { once: true },
              )

              // Set thumbnail as image source (never original image)
              img.src = objectUrl
            } catch (err) {
              console.error('[gallery] Failed to load thumbnail:', thumbUrl, err)
              // Remove the tile if thumbnail loading fails
              io.unobserve(tile)
              tile.remove()
            }
          })()
        }

        // Date is already set during tile creation, just mark as done
        if (dateEl && !dateEl.dataset.loaded) {
          dateEl.dataset.loaded = '1'
          markDone('date')
        }
      }
    },
    { rootMargin: viewportMargin(), threshold: 0.01 },
  )

  // Create tiles for each photo
  for (const photo of photos) {
    // Skip photos without thumbnail URLs (shouldn't happen with proper build)
    if (!photo.thumbUrl) {
      console.warn('[gallery] Photo missing thumbnail URL:', photo.fileName)
      continue
    }

    const link = el('a', {
      href: `#/photo/${photo.id}`,
      className: 'tile',
      title: photo.fileName,
    })
    
    if (photo.isFeatured) link.classList.add('isFeatured')
    link.setAttribute('data-photo-id', photo.id)
    link.setAttribute('data-thumb-url', photo.thumbUrl)

    const media = el('div', { className: 'tileMedia' })
    const img = el('img', {
      alt: photo.fileName,
      loading: 'lazy',
      decoding: 'async',
    })
    // Prevent some browsers from rendering a broken image icon before src is set.
    img.src = TRANSPARENT_PIXEL
    
    // Format date from pre-extracted metadata
    let dateText = ''
    if (photo.date) {
      try {
        const dt = new Date(photo.date)
        if (!isNaN(dt.getTime())) {
          dateText = formatDateOnly(dt)
        }
      } catch {
        // ignore invalid dates
      }
    }
    
    const date = el('div', { className: 'tileDate', title: '拍摄日期' }, [dateText])
    date.setAttribute('data-role', 'date')
    media.append(img, date)
    link.append(media)

    link.addEventListener('click', (e) => {
      if (!img) return
      e.preventDefault()
      cachedScrollY = window.scrollY

      // Pass along the thumbnail blob URL to photo view for initial display
      try {
        if (img.src) sessionStorage.setItem(`photo-thumb:${photo.id}`, img.src)
      } catch {
        // ignore
      }

      window.location.hash = `#/photo/${photo.id}`
    })

    masonry.append(link)
    io.observe(link)
  }
}

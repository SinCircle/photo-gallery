import { getAllPhotos } from '../photos'
import { clear, el } from '../utils/dom'
import { pickReadableInkFromBottomLeft } from '../utils/color'
import { loadThumbnailOnly } from '../utils/thumbs'
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

        if (!img || img.dataset.loaded === '1') continue
        img.dataset.loaded = '1'

        // Get the THUMBNAIL URL from the tile (NOT the original image URL!)
        const thumbUrl = tile.getAttribute('data-thumb-url')
        
        if (!thumbUrl) {
          console.warn('[Gallery] No thumbnail URL found for tile, skipping')
          tile.classList.add('isReady')
          io.unobserve(tile)
          continue
        }

        void (async () => {
          try {
            // ONLY load the pre-generated thumbnail, NEVER the original
            const thumbObjUrl = await loadThumbnailOnly(thumbUrl)
            
            img.addEventListener(
              'load',
              () => {
                const ink = pickReadableInkFromBottomLeft(img)
        
                if (dateEl) {
                  dateEl.style.color = ink.color
                  dateEl.style.textShadow = `0 1px 10px ${ink.shadow}`
                }

                tile.classList.add('isReady')
                io.unobserve(tile)
              },
              { once: true },
            )

            // Set thumbnail URL (never original image!)
            img.src = thumbObjUrl
          } catch (err) {
            console.warn('[Gallery] Failed to load thumbnail:', err)
            tile.classList.add('isReady')
            io.unobserve(tile)
          }
        })()
      }
    },
    { rootMargin: viewportMargin(), threshold: 0.01 },
  )

  for (const photo of photos) {
    // Skip photos without thumbnail URLs
    if (!photo.thumbUrl) {
      console.warn(`[Gallery] Photo ${photo.fileName} has no thumbnail, skipping`)
      continue
    }

    const link = el('a', {
      href: `#/photo/${photo.id}`,
      className: 'tile',
      title: photo.fileName,
    })
    if (photo.isFeatured) link.classList.add('isFeatured')
    link.setAttribute('data-photo-id', photo.id)
    // Store ONLY the thumbnail URL, NOT the original image URL
    link.setAttribute('data-thumb-url', photo.thumbUrl)

    const media = el('div', { className: 'tileMedia' })
    const img = el('img', {
      alt: photo.fileName,
      loading: 'lazy',
      decoding: 'async',
    })
    // Start with transparent pixel
    img.src = TRANSPARENT_PIXEL
    
    // Use pre-extracted metadata from manifest for date display
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

      // Pass along the thumbnail blob URL to reduce flash in photo view
      try {
        if (img.src && img.src !== TRANSPARENT_PIXEL) {
          sessionStorage.setItem(`photo-thumb:${photo.id}`, img.src)
        }
      } catch {
        // ignore storage errors
      }

      window.location.hash = `#/photo/${photo.id}`
    })

    masonry.append(link)
    io.observe(link)
  }
}

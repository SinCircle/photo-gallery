import { getAllPhotos } from '../photos'
import { clear, el } from '../utils/dom'
import { pickReadableInkFromBottomLeft } from '../utils/color'
import { getThumbnailObjectUrl } from '../utils/thumbs'
import { formatDateOnly, readShootDateTime } from '../utils/exif'
 

let cachedRoot: HTMLElement | null = null
let cachedKey = ''
const dateCache = new Map<string, string>()
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
        const photoUrl = tile.getAttribute('data-url')

        if (img && photoUrl && !img.dataset.loaded) {
          img.dataset.loaded = '1'
          void (async () => {
            try {
              const thumbUrl = await getThumbnailObjectUrl(photoUrl)
              img.addEventListener(
                'load',
                () => {
                  const ink = pickReadableInkFromBottomLeft(img)
                  if (dateEl) {
                    dateEl.style.color = ink.color
                    dateEl.style.textShadow = `0 1px 10px ${ink.shadow}`
                  }
                },
                { once: true },
              )

              img.src = thumbUrl
            } catch {
              // If thumbnail generation fails, fall back to original.
              img.src = photoUrl
            }
          })()
        }

        if (dateEl && photoUrl && !dateEl.dataset.loaded) {
          dateEl.dataset.loaded = '1'
          void (async () => {
            const hit = dateCache.get(photoUrl)
            if (hit) {
              dateEl.textContent = hit
              return
            }

            const dt = await readShootDateTime(photoUrl)
            if (dt) {
              const text = formatDateOnly(dt)
              dateCache.set(photoUrl, text)
              dateEl.textContent = text
            }
          })()
        }

      }
    },
    { rootMargin: viewportMargin(), threshold: 0.01 },
  )

  for (const photo of photos) {
    const link = el('a', {
      href: `#/photo/${photo.id}`,
      className: 'tile',
      title: photo.fileName,
    })
    link.setAttribute('data-photo-id', photo.id)
    link.setAttribute('data-url', photo.url)

    const media = el('div', { className: 'tileMedia' })
    const img = el('img', {
      alt: photo.fileName,
      loading: 'lazy',
      decoding: 'async',
    })
    const date = el('div', { className: 'tileDate', title: '拍摄日期' }, [''])
    date.setAttribute('data-role', 'date')
    media.append(img, date)
    link.append(media)

    link.addEventListener('click', (e) => {
      if (!img) return
      e.preventDefault()
      cachedScrollY = window.scrollY

      // Pass along whatever is currently displayed (often a cached thumbnail blob URL)
      // to reduce the initial flash in the photo view.
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

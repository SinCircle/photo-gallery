type Rect = { left: number; top: number; width: number; height: number }

let lastThumbImg: HTMLImageElement | null = null
let lastPhotoId: string | null = null
let lastGalleryScrollY = 0

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function makeOverlay(imgSrc: string, from: Rect): HTMLImageElement {
  const overlay = document.createElement('img')
  overlay.src = imgSrc
  overlay.style.position = 'fixed'
  overlay.style.left = `${from.left}px`
  overlay.style.top = `${from.top}px`
  overlay.style.width = `${from.width}px`
  overlay.style.height = `${from.height}px`
  overlay.style.objectFit = 'cover'
  overlay.style.borderRadius = 'var(--radius)'
  overlay.style.boxShadow = 'var(--shadow)'
  overlay.style.zIndex = '9999'
  overlay.style.pointerEvents = 'none'
  document.body.appendChild(overlay)
  return overlay
}

function targetRectForCenter(from: Rect): Rect {
  const maxW = Math.min(980, window.innerWidth - 36)
  const aspect = from.width > 0 ? from.height / from.width : 0.75
  const w = Math.max(240, maxW)
  const h = Math.max(160, Math.round(w * aspect))
  const left = (window.innerWidth - w) / 2
  const top = Math.max(18, (window.innerHeight - h) / 2)
  return { left, top, width: w, height: h }
}

export function snapshotGalleryState(params: { thumbImg: HTMLImageElement; photoId: string }) {
  lastThumbImg = params.thumbImg
  lastPhotoId = params.photoId
  lastGalleryScrollY = window.scrollY
}

export function restoreGalleryScroll() {
  window.scrollTo({ top: lastGalleryScrollY })
}

export async function animateOpenToPhoto(params: {
  thumbImg: HTMLImageElement
  photoId: string
  navigate: () => void
}): Promise<void> {
  const from = rectOf(params.thumbImg)
  snapshotGalleryState({ thumbImg: params.thumbImg, photoId: params.photoId })

  const overlay = makeOverlay(params.thumbImg.currentSrc || params.thumbImg.src, from)
  const to = targetRectForCenter(from)

  const anim = overlay.animate(
    [
      { transform: 'translate3d(0,0,0)', borderRadius: '18px' },
      {
        transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) scale(${to.width / from.width}, ${to.height / from.height})`,
        borderRadius: '18px',
      },
    ],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  )

  await anim.finished.catch(() => {})
  overlay.remove()
  params.navigate()
}

export async function animateCloseToGallery(params: {
  photoImg: HTMLImageElement
  navigate: () => void
}): Promise<void> {
  const photoId = lastPhotoId
  const thumb = lastThumbImg
  const from = rectOf(params.photoImg)
  const overlay = makeOverlay(params.photoImg.currentSrc || params.photoImg.src, from)

  params.navigate()

  // Wait for gallery to be visible and scroll restored.
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  restoreGalleryScroll()
  await new Promise((r) => requestAnimationFrame(() => r(null)))

  let to: Rect | null = null
  if (photoId && thumb && thumb.isConnected) {
    to = rectOf(thumb)
  } else if (photoId) {
    const el = document.querySelector(`[data-photo-id="${CSS.escape(photoId)}"] img`) as HTMLImageElement | null
    if (el) to = rectOf(el)
  }

  if (!to) {
    overlay.remove()
    return
  }

  const anim = overlay.animate(
    [
      { transform: 'translate3d(0,0,0)', borderRadius: '18px', opacity: 1 },
      {
        transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) scale(${to.width / from.width}, ${to.height / from.height})`,
        borderRadius: '18px',
        opacity: 1,
      },
    ],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  )

  await anim.finished.catch(() => {})
  overlay.remove()
}

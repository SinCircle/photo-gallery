import { clear, el } from '../utils/dom'
import {
  generateBorderedBlob,
  isMobileDevice,
  saveBorderedImage,
  supportsAlbumSave,
} from '../utils/download'
import { formatDateTime, photoMetadata } from '../utils/exif'
import { getAllPhotos, getKnownPhotos, thumbnailUrl, originalUrl, photoFileName } from '../photos'
import { attachGlass } from '../utils/glass'
import { attachCapsuleToolbar } from '../utils/capsuleToolbar'
import { attachPhotoImage } from '../utils/photoImage'
import { attachLoadingDots } from '../utils/loadingDots'
import { attachBlurPresence, attachBlurText } from '../utils/blurState'
import { EASE_IN_OUT } from '../utils/motion'

type FitMode = 'contain' | 'fitHeight' | 'fitWidth' | 'oneToOne'

const FIT_ORDER: FitMode[] = ['contain', 'fitHeight', 'fitWidth', 'oneToOne']

function nextFitMode(mode: FitMode): FitMode {
  switch (mode) {
    case 'contain':
      return 'fitHeight'
    case 'fitHeight':
      return 'fitWidth'
    case 'fitWidth':
      return 'oneToOne'
    case 'oneToOne':
      return 'contain'
  }
}

function labelForMode(mode: FitMode): string {
  switch (mode) {
    case 'contain':
      return '适应'
    case 'fitHeight':
      return '高度'
    case 'fitWidth':
      return '宽度'
    case 'oneToOne':
      return '完全'
  }
}

/**
 * Mobile fallback when the share sheet can't save the image (e.g. Huawei's
 * built-in browser has no working Web Share file support). Shows the already
 * generated WATERMARKED image full-screen so the user can long-press and pick
 * "保存图片" — the only reliable way to get it into the album on such browsers.
 */
function showLongPressSaveOverlay(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob)

  const overlay = el('div', { className: 'saveOverlay' })
  const img = el('img', {
    src: objectUrl,
    alt: '长按保存图片',
    className: 'saveOverlayImg',
    draggable: false,
  })
  const hint = el('div', { className: 'saveOverlayHint' }, [
    '长按图片，选择「保存图片」存入相册',
  ])
  const closeBtn = el('button', { className: 'btn saveOverlayClose', type: 'button' }, ['关闭'])

  const close = () => {
    overlay.remove()
    URL.revokeObjectURL(objectUrl)
    window.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  closeBtn.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  window.addEventListener('keydown', onKey)

  overlay.append(img, hint, closeBtn)
  document.body.append(overlay)
}

export async function renderPhotoView(
  container: HTMLElement,
  params: { photoId: string },
  signal: AbortSignal,
  options: { settled?: Promise<void> } = {},
) {
  const shell = el('div', { className: 'shell photoShell' })
  shell.dataset.entering = ''
  const bg = el('div', { className: 'photoBg' })
  bg.setAttribute('aria-hidden', 'true')

  const content = el('main', { className: 'content contentWithDock contentFull' })

  // Get photo from the full list to have thumbUrl
  const allPhotos = getKnownPhotos() ?? await getAllPhotos()
  if (signal.aborted) return
  clear(container)
  const photo = allPhotos.find(p => p.id === params.photoId)
  shell.dataset.photoId = params.photoId
  
  if (!photo) {
    content.append(
      el('div', { className: 'glass empty' }, [
        el('div', {}, ['找不到这张照片。']),
        el('a', { className: 'btn', href: '#/' }, ['返回画廊']),
      ]),
    )
    shell.append(content)
    container.append(shell)
    return
  }

  // Blur background should stay on the thumbnail (never the full-res).
  bg.style.backgroundImage = ''

  const stage = el('div', { className: 'photoStage' })
  stage.classList.add('noAnim')
  const pan = el('div', { className: 'photoPan' })
  const zoom = el('div', { className: 'photoZoom' })

  const imgLow = el('img', {
    alt: photoFileName(photo),
    className: 'photoImg photoImgLow',
    loading: 'eager',
    decoding: 'async',
    draggable: false,
  })

  const imgHigh = el('img', {
    alt: photoFileName(photo),
    className: 'photoImg photoImgHigh',
    loading: 'eager',
    decoding: 'async',
    draggable: false,
  })

  zoom.append(imgLow, imgHigh)
  pan.append(zoom)
  stage.append(pan)
  content.append(stage)

  // Bottom fixed dock: back + metadata + download.
  const dockInner = el('div', { className: 'dockInner capsuleDock' })
  dockInner.dataset.glassPending = ''
  const dockBar = el('div', { className: 'dockBar' })
  dockBar.dataset.glassCapsule = 'bar'
  // Start in the loading capsule, without first flashing the full toolbar and
  // running a close animation while its image requests are still pending.
  dockBar.dataset.loading = ''
  const backBtn = el('button', { className: 'dockAction dockBack', type: 'button' }, [
    el('span', { className: 'capsuleLabel' }, ['返回']),
  ])
  backBtn.addEventListener('click', async () => {
    window.location.hash = '#/'
  })

  const metaList = el('div', { className: 'dockMeta' })
  metaList.tabIndex = 0
  const metaLoading = el('div', { className: 'dockMetaLoading' }, [
    el('span', { className: 'dockMetaLoadingDot' }),
    el('span', { className: 'dockMetaLoadingDot' }),
    el('span', { className: 'dockMetaLoadingDot' }),
    el('span', { className: 'dockMetaLoadingDot' }),
    el('span', { className: 'dockMetaLoadingDot' }),
  ])
  metaLoading.setAttribute('role', 'status')
  metaLoading.setAttribute('aria-live', 'polite')
  const metaPromise = Promise.resolve(photoMetadata(photo))

  const updateDockStacking = () => dockInner.dispatchEvent(new Event('glassrefresh'))

  let mode: FitMode = 'contain'
  let scale = 1
  let translateX = 0
  let translateY = 0
  let isFreeZoom = false
  let imageReady = false
  let glassReady = false
  let preparingDownload = false
  let renderedMeta = false
  let metaReady = false
  let metaItems: Array<{ label: string; value: string }> = []

  const labelForCurrentScale = () => (isFreeZoom ? '自由' : labelForMode(mode))

  function updateMetaDisplay() {
    dockBar.toggleAttribute('data-loading', !imageReady)
    dockBar.toggleAttribute('data-expandable', metaReady && glassReady)
    updateDownloadLoading()
    if (!metaReady) {
      metaList.hidden = false
      if (metaList.firstChild !== metaLoading || metaList.childNodes.length !== 1) {
        metaList.replaceChildren(metaLoading)
      }
      updateDockStacking()
      return
    }
    const items = metaItems
    if (items.length === 0) {
      metaList.hidden = true
      updateDockStacking()
      return
    }

    metaList.hidden = false
    // Show the fallback font immediately. The font event already invalidates
    // ink and the ResizeObserver updates layout when the webfont arrives.
    if (!renderedMeta) metaList.replaceChildren(
      ...items.map((it) =>
        el('span', { className: 'dockMetaItem', title: it.label }, [it.value]),
      ),
    )
    renderedMeta = true
    requestAnimationFrame(() => updateDockStacking())
  }

  // Virtual box used for layout (resolution-independent).
  let boxW = 1200
  let boxH = 900

  // Full-res natural size (used only for 1:1 mode).
  let fullNaturalW = 0

  // Measured stage metrics.
  let layoutMetrics: { stageW: number; stageH: number } | undefined

  // Decide one redundant mode (fitHeight or fitWidth) under contain's safe area.
  // This must be stable across all current modes, otherwise the skipped option can “come back”
  // when cycling from a different mode.
  let redundantMode: FitMode = 'fitWidth'

  const enableAnimSoon = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => stage.classList.remove('noAnim'))
    })
  }

  function setBoxFromAspect(aspect: number) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
    boxW = 1200
    boxH = Math.max(1, Math.round(boxW / a))
    zoom.style.width = `${boxW}px`
    zoom.style.height = `${boxH}px`
  }

  function measureLayout() {
    // Transforms do not change the stage. Refresh these only on layout/size
    // changes, instead of forcing reads on every drag event.
    if (layoutMetrics) return layoutMetrics
    const stageRect = stage.getBoundingClientRect()
    return layoutMetrics = { stageW: stageRect.width, stageH: stageRect.height }
  }

  function safeMetrics(stageW: number, stageH: number, _mode: FitMode) {
    const side = 18
    const gutter = 18

    const w = Math.max(1, stageW - side * 2)
    // The bar floats over the photo, so the image keeps equal top and bottom
    // margins rather than reserving a strip for the dock.
    const h = Math.max(1, stageH - gutter * 2)
    return { w, h, centerOffsetY: 0 }
  }

  function computeScaleFor(m: FitMode, stageW: number, stageH: number) {
    const safe = safeMetrics(stageW, stageH, m)
    const sx = safe.w / boxW
    const sy = safe.h / boxH

    const nextScale =
      m === 'contain'
        ? Math.min(sx, sy)
        : m === 'fitHeight'
          ? sy
          : m === 'fitWidth'
            ? sx
            : fullNaturalW > 0
              ? fullNaturalW / boxW
              : 1

    return nextScale
  }

  function redundantModeUnderContain(stageW: number, stageH: number): FitMode {
    // Decide ONE redundant option (height vs width) under contain's own safe area.
    // This avoids weird aspect-ratio cases where both get skipped or the wrong one is skipped.
    const safe = safeMetrics(stageW, stageH, 'contain')
    const safeAspect = safe.w / Math.max(1, safe.h)
    const imgAspect = boxW / Math.max(1, boxH)
    const eps = 1e-4

    // If the image is wider than the safe area, contain is width-limited => fitWidth redundant.
    // If it's taller, contain is height-limited => fitHeight redundant.
    if (imgAspect > safeAspect + eps) return 'fitWidth'
    if (imgAspect < safeAspect - eps) return 'fitHeight'

    // Near-equal: both would look almost identical; skip one deterministically.
    return 'fitWidth'
  }

  function updateRedundantMode(stageW: number, stageH: number) {
    // Only meaningful when we know the image aspect.
    if (!boxReady) return
    redundantMode = redundantModeUnderContain(stageW, stageH)
  }

  function canPan(stageW: number, stageH: number) {
    const safe = safeMetrics(stageW, stageH, mode)
    return boxW * scale > safe.w + 0.5 || boxH * scale > safe.h + 0.5
  }

  function scaleBounds(stageW: number, stageH: number) {
    const containScale = computeScaleFor('contain', stageW, stageH)
    const oneToOneScale = computeScaleFor('oneToOne', stageW, stageH)
    const minScale = Math.max(0.04, containScale * 0.5)
    const maxScale = Math.max(minScale * 12, containScale * 20, oneToOneScale * 6)
    return { minScale, maxScale }
  }

  function applyScaleAtPoint(
    stageW: number,
    stageH: number,
    anchorX: number,
    anchorY: number,
    targetScale: number,
  ) {
    if (!boxReady) return false

    const oldScale = scale
    if (!Number.isFinite(targetScale) || !Number.isFinite(oldScale) || oldScale <= 0) {
      return false
    }

    const { minScale, maxScale } = scaleBounds(stageW, stageH)
    const nextScale = Math.min(maxScale, Math.max(minScale, targetScale))
    if (Math.abs(nextScale - oldScale) < 1e-4) return false

    const oldSafe = safeMetrics(stageW, stageH, mode)
    const relX = anchorX - stageW / 2
    const relY = anchorY - stageH / 2
    const imageX = (relX - translateX) / oldScale
    const imageY = (relY - (translateY + oldSafe.centerOffsetY)) / oldScale

    scale = nextScale
    const newSafe = safeMetrics(stageW, stageH, mode)
    translateX = relX - imageX * scale
    translateY = relY - newSafe.centerOffsetY - imageY * scale

    clampPan(stageW, stageH)
    apply(stageW, stageH)

    const fitScale = computeScaleFor(mode, stageW, stageH)
    isFreeZoom = Math.abs(scale - fitScale) > 1e-3
    return true
  }

  function clampPan(stageW: number, stageH: number) {
    const safe = safeMetrics(stageW, stageH, mode)
    const dispW = boxW * scale
    const dispH = boxH * scale

    if (dispW <= safe.w) {
      translateX = 0
    } else {
      const maxX = (dispW - safe.w) / 2
      translateX = Math.min(maxX, Math.max(-maxX, translateX))
    }

    if (dispH <= safe.h) {
      translateY = 0
    } else {
      const maxY = (dispH - safe.h) / 2
      translateY = Math.min(maxY, Math.max(-maxY, translateY))
    }
  }

  function apply(stageW: number, stageH: number) {
    const safe = safeMetrics(stageW, stageH, mode)
    pan.style.transform = `translate3d(${translateX}px, ${translateY + safe.centerOffsetY}px, 0)`
    zoom.style.transform = `translate3d(-50%, -50%, 0) scale(${scale})`
    imageLoader.resize(boxW * scale)
  }

  function relayout(resetToCenter: boolean) {
    layoutMetrics = undefined
    const { stageW, stageH } = measureLayout()

    updateRedundantMode(stageW, stageH)

    if (resetToCenter) {
      translateX = 0
      translateY = 0
      isFreeZoom = false
    }

    if (!isFreeZoom) {
      scale = computeScaleFor(mode, stageW, stageH)
    }

    clampPan(stageW, stageH)
    apply(stageW, stageH)
  }

  // Reserve indexed dimensions before either image arrives.
  let boxReady = true
  setBoxFromAspect(photo.width / photo.height)
  fullNaturalW = photo.width
  const lowSrc = thumbnailUrl(photo)
  imgLow.src = lowSrc
  bg.style.backgroundImage = `url(${lowSrc})`

  const imageStatus = el('div', { className: 'photoStatus' })
  imageStatus.setAttribute('role', 'status')
  imageStatus.hidden = true
  const retryImage = el('button', { className: 'btn', type: 'button' }, ['重试'])
  imageStatus.append('清晰图片加载失败，当前保留预览。', retryImage)
  content.append(imageStatus)
  const imageLoader = attachPhotoImage(photo, imgHigh, stage, signal, () => {
    if (imageReady || signal.aborted) return
    const finish = () => { if (!signal.aborted && !imageReady) { imageReady = true; updateMetaDisplay() } }
    // Updating the original can require one expensive canvas readback. Keep
    // the loading state until that glass frame is really painted, then start
    // expansion, instead of doing both jobs in its first animation frame.
    if (dockInner.dataset.glass === 'webgl') {
      let prepared = false
      const afterPaint = () => {
        if (!prepared && dockInner.dataset.glass !== 'css') return
        dockInner.removeEventListener('glasspaint', afterPaint)
        dockInner.removeEventListener('glassscene', afterScene)
        finish()
      }
      const afterScene = () => { prepared = true; if (dockInner.dataset.glass === 'css') afterPaint() }
      dockInner.addEventListener('glassscene', afterScene, { signal })
      dockInner.addEventListener('glasspaint', afterPaint, { signal })
      dockInner.dispatchEvent(new Event('glassrefresh'))
    } else finish()
  }, failed => { imageStatus.hidden = !failed })
  retryImage.addEventListener('click', () => { imageReady = false; updateMetaDisplay(); imageLoader.retry() }, { signal })
  const scheduleHiStart = (delay: number) => imageLoader.defer(delay)

  const fitLabel = el('span', { className: 'capsuleLabel' }, [`比例：${labelForCurrentScale()}`])
  const updateFitLabel = () => {
    const text = `比例：${labelForCurrentScale()}`
    // A wheel/pinch usually leaves the label at “自由”. Replacing identical
    // text would make LiquidGlass rasterise its entire content again.
    if (fitLabel.textContent !== text) fitLabel.textContent = text
  }
  const fitBtn = el('button', { className: 'dockAction dockFit', type: 'button' }, [fitLabel])
  fitBtn.addEventListener('click', () => {
    if (!boxReady || document.documentElement.dataset.photoTransition) return

    // If user is actively tapping, delay hi-res start to avoid main-thread stutter.
    scheduleHiStart(650)

    const { stageW, stageH } = measureLayout()

    // Skip “高度/宽度” when they are redundant under “适应”.
    // This must be determined inside contain's own safe area (above the dock),
    // otherwise panoramas can behave incorrectly.
    updateRedundantMode(stageW, stageH)
    const currentScale = scale

    // Keep the same visual center while switching between preset fit modes.
    const oldSafe = safeMetrics(stageW, stageH, mode)
    const centerX = -translateX / Math.max(scale, 1e-6)
    const centerY = -(translateY + oldSafe.centerOffsetY) / Math.max(scale, 1e-6)

    let candidate = mode
    for (let i = 0; i < FIT_ORDER.length; i++) {
      candidate = nextFitMode(candidate)

      // Always skip the redundant option no matter current mode.
      if (candidate === redundantMode) continue

      const nextScale = computeScaleFor(candidate, stageW, stageH)
      if (Math.abs(nextScale - currentScale) > 1e-3) break
    }

    mode = candidate
    isFreeZoom = false
    scale = computeScaleFor(mode, stageW, stageH)
    const newSafe = safeMetrics(stageW, stageH, mode)

    // Restore the same center point in the new scale
    translateX = -centerX * scale
    translateY = -newSafe.centerOffsetY - centerY * scale

    updateFitLabel()
    clampPan(stageW, stageH)
    apply(stageW, stageH)
  })

  // Drag/pan and pinch-zoom interactions.
  let dragging = false
  let startX = 0
  let startY = 0
  let startTX = 0
  let startTY = 0
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinching = false
  let pinchStartDistance = 0
  let pinchStartScale = 1

  const setDragging = (nextDragging: boolean) => {
    dragging = nextDragging
    stage.classList.toggle('isDragging', nextDragging)
  }

  const tryStartDragging = (clientX: number, clientY: number) => {
    const { stageW, stageH } = measureLayout()
    if (!canPan(stageW, stageH)) {
      setDragging(false)
      return
    }

    setDragging(true)
    startX = clientX
    startY = clientY
    startTX = translateX
    startTY = translateY
  }

  const beginPinch = () => {
    const points = [...activePointers.values()]
    if (points.length < 2) return

    const dx = points[1].x - points[0].x
    const dy = points[1].y - points[0].y

    pinchStartDistance = Math.max(1, Math.hypot(dx, dy))
    pinchStartScale = scale

    pinching = true
    setDragging(false)
    scheduleHiStart(650)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (document.documentElement.dataset.photoTransition) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    stage.setPointerCapture(e.pointerId)

    if (activePointers.size >= 2) {
      beginPinch()
      return
    }

    scheduleHiStart(650)
    tryStartDragging(e.clientX, e.clientY)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!activePointers.has(e.pointerId)) return
    scheduleHiStart(650)
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const { stageW, stageH } = measureLayout()

    if (pinching && activePointers.size >= 2) {
      const points = [...activePointers.values()]
      const centerClientX = (points[0].x + points[1].x) / 2
      const centerClientY = (points[0].y + points[1].y) / 2
      const stageRect = stage.getBoundingClientRect()
      const centerX = centerClientX - stageRect.left
      const centerY = centerClientY - stageRect.top
      const dx = points[1].x - points[0].x
      const dy = points[1].y - points[0].y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const nextScale = pinchStartScale * (distance / pinchStartDistance)

      const changed = applyScaleAtPoint(stageW, stageH, centerX, centerY, nextScale)
      if (changed) updateFitLabel()
      return
    }

    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    translateX = startTX + dx
    translateY = startTY + dy
    clampPan(stageW, stageH)
    apply(stageW, stageH)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!activePointers.has(e.pointerId)) return
    activePointers.delete(e.pointerId)
    scheduleHiStart(650)
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId)

    if (pinching && activePointers.size < 2) {
      pinching = false
      if (activePointers.size === 1) {
        const remaining = [...activePointers.values()][0]
        tryStartDragging(remaining.x, remaining.y)
      } else {
        setDragging(false)
      }
      return
    }

    if (activePointers.size === 0) setDragging(false)
  }

  const onWheel = (e: WheelEvent) => {
    if (!boxReady) return

    let delta = e.deltaY
    const stageRect = stage.getBoundingClientRect()
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16
    if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= stageRect.height
    if (delta === 0) return

    e.preventDefault()
    scheduleHiStart(650)

    const zoomFactor = Math.exp(-delta * 0.0018)
    const { stageW, stageH } = measureLayout()
    const anchorX = e.clientX - stageRect.left
    const anchorY = e.clientY - stageRect.top
    const changed = applyScaleAtPoint(stageW, stageH, anchorX, anchorY, scale * zoomFactor)
    if (changed) updateFitLabel()
  }

  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('pointercancel', onPointerUp)
  stage.addEventListener('lostpointercapture', onPointerUp)
  stage.addEventListener('wheel', onWheel, { passive: false })

  window.addEventListener('blur', () => {
    activePointers.clear()
    pinching = false
    setDragging(false)
    scheduleHiStart(650)
  }, { signal })

  window.addEventListener('resize', () => relayout(false), { signal })

  // On mobile the button always saves to the photo album (share sheet, or a
  // long-press fallback where Web Share isn't available); desktop downloads.
  const albumSave = supportsAlbumSave()
  const downloadLabel = albumSave ? '保存' : '下载'

  const downloadText = el('span', { className: 'capsuleLabel' }, [downloadLabel])
  const showDownloadText = attachBlurPresence(downloadText, signal, false, EASE_IN_OUT)
  const setDownloadText = attachBlurText(downloadText, signal)
  const downloadBtn = el('button', { className: 'dockAction dockDownload', type: 'button' }, [downloadText])
  const downloadDots = el('span', { className: 'capsuleDots downloadLoading' })
  downloadDots.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 4; i++) downloadDots.append(document.createElement('i'))
  downloadBtn.append(downloadDots)
  const setDownloadLoading = attachLoadingDots(downloadDots, signal, EASE_IN_OUT)
  const updateDownloadLoading = () => {
    const busy = !imageReady || preparingDownload
    downloadBtn.toggleAttribute('data-busy', busy)
    dockBar.toggleAttribute('data-busy', preparingDownload)
    downloadBtn.disabled = busy
    setDownloadLoading(busy && glassReady)
    void showDownloadText(!busy)
    if (busy) {
      downloadBtn.setAttribute('aria-busy', 'true')
      downloadBtn.setAttribute('aria-label', preparingDownload ? '正在准备图片' : '正在加载原图')
    } else {
      downloadBtn.removeAttribute('aria-busy')
      downloadBtn.removeAttribute('aria-label')
    }
  }
  downloadBtn.addEventListener('click', async () => {
    preparingDownload = true
    updateDownloadLoading()
    let blob: Blob | null = null
    try {
      const meta = await metaPromise
      const stamp = meta.date ? `SinCircle  ${formatDateTime(meta.date)}` : 'SinCircle'
      blob = await generateBorderedBlob({ url: originalUrl(photo), stampText: stamp })
      await saveBorderedImage(blob)
      setDownloadText(downloadLabel)
    } catch (err) {
      // Mobile has no download fallback — surface the failure so it's visible.
      const reason = err instanceof Error ? err.name : '未知错误'
      console.error('保存到相册失败', err)
      setDownloadText(`失败(${reason})`)
      window.setTimeout(() => {
        if (!downloadBtn.disabled && !signal.aborted) setDownloadText(downloadLabel)
      }, 2000)
      // If the watermarked image was generated but saving failed (e.g. no Web
      // Share on Huawei's browser), fall back to a long-press hint. It shows
      // the bordered blob itself, so the watermark is preserved.
      if (blob && isMobileDevice()) showLongPressSaveOverlay(blob)
    } finally {
      preparingDownload = false
      updateDownloadLoading()
    }
  })

  dockBar.append(backBtn, fitBtn, metaList, downloadBtn)
  dockInner.append(dockBar)
  shell.append(bg, content, dockInner)
  container.append(shell)
  dockInner.addEventListener('glassready', () => {
    glassReady = true
    updateMetaDisplay()
  }, { once: true, signal })
  const dockSlot = attachCapsuleToolbar(dockInner, signal)
  // Shared-image motion needs only the thumbnail. Heavy canvas/shader
  // setup and display-image decoding start after that motion has finished.
  let enhanceTimer = 0
  void (options.settled ?? Promise.resolve()).then(() => {
    if (signal.aborted) return
    enhanceTimer = window.setTimeout(() => {
      if (signal.aborted) return
      delete shell.dataset.entering
      void attachGlass(shell, dockInner, signal)
      imageLoader.start()
    }, 0)
  })

  // Re-layout when dock wraps (e.g., narrow widths).
  const ro = new ResizeObserver(() => {
    updateDockStacking()
    if (boxReady) relayout(false)
  })
  ro.observe(dockSlot)
  signal.addEventListener('abort', () => {
    ro.disconnect()
    window.clearTimeout(enhanceTimer)
  }, { once: true })

  // Preserve keyboard navigation without accumulating handlers on route changes.
  window.addEventListener('keydown', (event) => {
    if (document.querySelector('.saveOverlay')) return
    if (event.key === 'Escape') window.location.hash = '#/'
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    const next = allPhotos[allPhotos.findIndex(p => p.id === photo.id) + step]
    if (next) window.location.hash = `#/photo/${encodeURIComponent(next.id)}`
  }, { signal })
  relayout(true)
  enableAnimSoon()

  window.addEventListener('resize', updateDockStacking, { signal })

  // Populate metadata (show only what exists).
  updateMetaDisplay()

  void (async () => {
    const meta = await metaPromise
    if (signal.aborted) return
    const items: Array<{ label: string; value: string }> = []
    if (meta.date) items.push({ label: '日期', value: formatDateTime(meta.date) })
    items.push(...meta.fields)

    metaItems = items
    metaReady = true
    updateMetaDisplay()
  })()
}

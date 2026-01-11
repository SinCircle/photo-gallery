import { getPhotoById } from '../photos'
import { clear, el } from '../utils/dom'
import { downloadWithBorder } from '../utils/download'
import { formatDateTime, readPhotoMetadata } from '../utils/exif'
import { getThumbnailObjectUrl } from '../utils/thumbs'

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

export async function renderPhotoView(
  container: HTMLElement,
  params: { photoId: string },
) {
  clear(container)

  const shell = el('div', { className: 'shell photoShell' })
  const bg = el('div', { className: 'photoBg' })
  bg.setAttribute('aria-hidden', 'true')

  const content = el('main', { className: 'content contentWithDock contentFull' })

  const photo = getPhotoById(params.photoId)
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
    alt: photo.fileName,
    className: 'photoImg photoImgLow',
    loading: 'eager',
    decoding: 'async',
    draggable: false,
  })

  const imgHigh = el('img', {
    alt: photo.fileName,
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
  const dock = el('div', { className: 'dock' })
  const dockInner = el('div', { className: 'glass dockInner' })

  const backBtn = el('button', { className: 'btn', type: 'button' }, ['返回'])
  backBtn.addEventListener('click', async () => {
    window.location.hash = '#/'
  })

  const metaList = el('div', { className: 'dockMeta', hidden: true })
  const metaPromise = readPhotoMetadata(photo.url)

  let mode: FitMode = 'contain'
  let scale = 1
  let translateX = 0
  let translateY = 0

  // Virtual box used for layout (resolution-independent).
  let boxW = 1200
  let boxH = 900

  // Full-res natural size (used only for 1:1 mode).
  let fullNaturalW = 0

  // Measured layout metrics (avoid hard-coded dock geometry).
  let dockInnerTop = 0

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
    const stageRect = stage.getBoundingClientRect()
    const dockInnerRect = dockInner.getBoundingClientRect()
    // stage is fixed inset:0, so top is ~0; still keep it relative.
    dockInnerTop = Math.max(0, dockInnerRect.top - stageRect.top)
    return { stageW: stageRect.width, stageH: stageRect.height }
  }

  function safeMetrics(stageW: number, stageH: number, m: FitMode) {
    const side = 18
    const gutter = 18

    const w = Math.max(1, stageW - side * 2)
    if (m === 'contain') {
      // Center within the region above the dock glass (not including dock padding).
      const bottom = Math.max(gutter, Math.min(stageH - gutter, dockInnerTop - gutter))
      const top = gutter
      const h = Math.max(1, bottom - top)
      const centerOffsetY = (top + bottom) / 2 - stageH / 2
      return { w, h, centerOffsetY }
    }

    // Other modes may render behind the dock.
    const h = Math.max(1, stageH - gutter * 2)
    const centerOffsetY = 0
    return { w, h, centerOffsetY }
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
  }

  function relayout(resetToCenter: boolean) {
    const { stageW, stageH } = measureLayout()

    updateRedundantMode(stageW, stageH)

    scale = computeScaleFor(mode, stageW, stageH)
    if (resetToCenter) {
      translateX = 0
      translateY = 0
    }
    clampPan(stageW, stageH)
    apply(stageW, stageH)
  }

  // Load thumb first (stable aspect), then crossfade to full.
  let lowSrc = ''
  try {
    lowSrc = sessionStorage.getItem(`photo-thumb:${photo.id}`) || ''
  } catch {
    lowSrc = ''
  }

  if (lowSrc) {
    imgLow.src = lowSrc
    bg.style.backgroundImage = `url(${lowSrc})`
  } else {
    void (async () => {
      try {
        lowSrc = await getThumbnailObjectUrl(photo.url)
        imgLow.src = lowSrc
        bg.style.backgroundImage = `url(${lowSrc})`
      } catch {
        // ignore
      }
    })()
  }

  let boxReady = false
  imgLow.addEventListener(
    'load',
    () => {
      const aspect = imgLow.naturalWidth / Math.max(1, imgLow.naturalHeight)
      setBoxFromAspect(aspect)
      boxReady = true
      updateRedundantMode(measureLayout().stageW, measureLayout().stageH)
      relayout(true)
      enableAnimSoon()
    },
    { once: true },
  )

  // Start hi-res loading only when the user isn't actively interacting, to avoid stutter.
  let hiStarted = false
  let hiReady = false
  let hiStartTimer: number | undefined

  const startHi = () => {
    if (hiStarted) return
    hiStarted = true
    const pre = new Image()
    pre.decoding = 'async'
    pre.onload = () => {
      imgHigh.src = photo.url
    }
    pre.src = photo.url
  }

  const scheduleHiStart = (delayMs: number) => {
    if (hiStarted) return
    if (hiStartTimer) window.clearTimeout(hiStartTimer)
    hiStartTimer = window.setTimeout(() => startHi(), delayMs)
  }

  imgHigh.addEventListener(
    'load',
    async () => {
      try {
        await imgHigh.decode?.()
      } catch {
        // ignore
      }

      fullNaturalW = imgHigh.naturalWidth

      if (!boxReady) {
        const aspect = imgHigh.naturalWidth / Math.max(1, imgHigh.naturalHeight)
        setBoxFromAspect(aspect)
        boxReady = true
        relayout(true)
        enableAnimSoon()
      }

      // Delay then crossfade (no hard cut).
      window.setTimeout(() => {
        if (hiReady) return
        hiReady = true
        stage.classList.add('hiReady')
        // If user is in 1:1, update scale based on real pixels.
        if (mode === 'oneToOne') relayout(false)

        // Only after the high layer has started fading in do we fade out the low layer.
        window.setTimeout(() => {
          stage.classList.add('hiDone')
        }, 280)
      }, 180)
    },
    { once: true },
  )

  // Kick off hi-res after thumb is up (or a short delay if thumb isn't ready).
  scheduleHiStart(260)

  const fitBtn = el('button', { className: 'btn', type: 'button' }, [`比例：${labelForMode(mode)}`])
  fitBtn.addEventListener('click', () => {
    if (!boxReady) return

    // If user is actively tapping, delay hi-res start to avoid main-thread stutter.
    scheduleHiStart(650)

    const { stageW, stageH } = measureLayout()

    // Skip “高度/宽度” when they are redundant under “适应”.
    // This must be determined inside contain's own safe area (above the dock),
    // otherwise panoramas can behave incorrectly.
    updateRedundantMode(stageW, stageH)
    const currentScale = computeScaleFor(mode, stageW, stageH)
    let candidate = mode
    for (let i = 0; i < FIT_ORDER.length; i++) {
      candidate = nextFitMode(candidate)

      // Always skip the redundant option no matter current mode.
      if (candidate === redundantMode) continue

      const nextScale = computeScaleFor(candidate, stageW, stageH)
      if (Math.abs(nextScale - currentScale) > 1e-3) break
    }

    mode = candidate
    fitBtn.textContent = `比例：${labelForMode(mode)}`
    relayout(true)
  })

  // Drag/pan when image can exceed safe area.
  let dragging = false
  let startX = 0
  let startY = 0
  let startTX = 0
  let startTY = 0

  const onPointerDown = (e: PointerEvent) => {
    if (mode === 'contain') return
    scheduleHiStart(650)
    dragging = true
    stage.classList.add('isDragging')
    stage.setPointerCapture(e.pointerId)
    startX = e.clientX
    startY = e.clientY
    startTX = translateX
    startTY = translateY
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    translateX = startTX + dx
    translateY = startTY + dy
    const r = stage.getBoundingClientRect()
    clampPan(r.width, r.height)
    apply(r.width, r.height)
  }

  const onPointerUp = () => {
    dragging = false
    stage.classList.remove('isDragging')
  }

  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('pointercancel', onPointerUp)

  window.addEventListener('resize', () => relayout(false))

  const downloadBtn = el('button', { className: 'btn', type: 'button' }, ['下载'])
  downloadBtn.addEventListener('click', async () => {
    downloadBtn.textContent = '等待'
    downloadBtn.disabled = true
    try {
      const meta = await metaPromise
      const stamp = "SinCircle" + "  " + (meta.date ? formatDateTime(meta.date) : undefined)
      await downloadWithBorder({ url: photo.url, fileName: photo.fileName, stampText: stamp })
    } finally {
      downloadBtn.disabled = false
      downloadBtn.textContent = '下载'
    }
  })

  dockInner.append(backBtn, fitBtn, metaList, downloadBtn)
  dock.append(dockInner)

  shell.append(bg, content, dock)
  container.append(shell)

  // Re-layout when dock wraps (e.g., narrow widths).
  const ro = new ResizeObserver(() => {
    if (boxReady) relayout(false)
  })
  ro.observe(dockInner)

  // Populate metadata (show only what exists).
  void (async () => {
    const meta = await metaPromise
    const items: Array<{ label: string; value: string }> = []
    if (meta.date) items.push({ label: '日期', value: formatDateTime(meta.date) })
    if (meta.fields) items.push(...meta.fields)

    if (items.length === 0) {
      metaList.hidden = true
      return
    }

    metaList.hidden = false
    metaList.replaceChildren(
      ...items.map((it) =>
        el('span', { className: 'dockMetaItem' }, [`${it.label}：${it.value}`]),
      ),
    )
  })()
}

function srgbToLin(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(r: number, g: number, b: number): number {
  const R = srgbToLin(r)
  const G = srgbToLin(g)
  const B = srgbToLin(b)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

export function pickReadableInkFromBottomLeft(img: HTMLImageElement): {
  color: string
  shadow: string
} {
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return { color: 'rgba(255,255,255,0.92)', shadow: 'rgba(0,0,0,0.38)' }

    const canvas = document.createElement('canvas')
    const sampleW = 48
    const sampleH = 48
    canvas.width = sampleW
    canvas.height = sampleH

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { color: 'rgba(255,255,255,0.92)', shadow: 'rgba(0,0,0,0.38)' }

    // sample bottom-left patch
    const sx = 0
    const sy = Math.max(0, h - Math.floor(h * 0.22))
    const sw = Math.max(1, Math.floor(w * 0.22))
    const sh = Math.max(1, h - sy)

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sampleW, sampleH)
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data

    let lr = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] ?? 0
      if (a < 16) continue
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      lr += luminance(r, g, b)
      count++
    }

    const avg = count > 0 ? lr / count : 0.3

    // If patch is bright, use dark ink; else use light ink.
    if (avg > 0.5) {
      return { color: 'rgba(17,17,17,0.82)', shadow: 'rgba(255,255,255,0.42)' }
    }
    return { color: 'rgba(255,255,255,0.92)', shadow: 'rgba(0,0,0,0.38)' }
  } catch {
    return { color: 'rgba(255,255,255,0.92)', shadow: 'rgba(0,0,0,0.38)' }
  }
}

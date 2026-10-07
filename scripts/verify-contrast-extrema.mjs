import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = (await readFile('src/utils/toolbarInk.ts', 'utf8')).replace(/^import .*$/gm, '')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { sampleInkBand, cellContrastMinima, luminance, veiled, contrast } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
let seed = 123456789
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
const reference = (strip, left, width, count, veil) => {
  const lookup = Float64Array.from({ length: 4097 }, (_, i) => veiled(i / 4096, veil))
  const whiteMinima = new Float64Array(count).fill(Infinity), blackMinima = new Float64Array(count).fill(Infinity)
  for (let col = 0; col < strip.width; col++) {
    const px = strip.box.left + (strip.x + col + .5) / strip.sx
    const cell = Math.min(count - 1, Math.floor(Math.max(0, Math.min(1, (px - left) / width)) * count))
    for (let row = 0; row < strip.height; row++) {
      const backdrop = lookup[Math.round(luminance(strip.data, strip.offset + row * strip.stride + col * 4) * 4096)]
      whiteMinima[cell] = Math.min(whiteMinima[cell], contrast(1, backdrop))
      blackMinima[cell] = Math.min(blackMinima[cell], contrast(0, backdrop))
    }
  }
  return { whiteMinima, blackMinima }
}
for (let i = 0; i < 160; i++) {
  const width = 1 + Math.floor(random() * 1100), height = 1 + Math.floor(random() * 60)
  const sx = .75 + random() * 3, sy = .75 + random() * 3
  const box = { left: random() * 20, top: random() * 20, width: width / sx, height: height / sy }
  const pixels = { x: 0, y: 0, stride: width * 4, box, data: Uint8ClampedArray.from({ length: width * height * 4 }, () => i < 2 ? i * 255 : random() * 256) }
  const canvas = { width, height, getBoundingClientRect: () => box, getContext: () => ({ getImageData: (x, y, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let row = 0; row < h; row++) data.set(pixels.data.subarray((y + row) * pixels.stride + x * 4, (y + row) * pixels.stride + (x + w) * 4), row * w * 4)
    return { data }
  } }) }
  const band = { left: box.left + random() * box.width * .3, right: box.left + box.width * (.7 + random() * .3), top: box.top + random() * box.height * .3, bottom: box.top + box.height * (.7 + random() * .3) }
  const separate = sampleInkBand(canvas, band, 24)
  const strip = sampleInkBand(canvas, band, 24, pixels, true)
  assert.deepEqual(strip.sampled, separate.sampled, 'Shared readback must preserve fractional area means exactly')
  const args = [box.left, box.width, 1 + Math.floor(random() * 200), i % 2 ? .1 : .415]
  assert.deepEqual(cellContrastMinima(strip, ...args), reference(separate, ...args), 'Fused extrema must exactly preserve both contrast fields, including empty cells')
  assert.deepEqual(cellContrastMinima(separate, ...args), reference(separate, ...args))
}
console.log('160 shared readbacks, fractional area means and contrast fields match the original pixel scan exactly')

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Reproducible internal buffer optimization for the pinned upstream bundle.
// No application code reads or changes a LiquidGlass instance's private fields.
const file = new URL('../node_modules/@ybouane/liquidglass/dist/index.js', import.meta.url)
const marker = '// photo-gallery: native buffer reuse v1'
let source = await readFile(file, 'utf8')
if (source.startsWith(marker)) {
  console.log('LiquidGlass 1.0.3 buffer patch already applied')
} else {
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '9630e5af0e9c27c3a88a2c4a7096a4f5e0f12e92afc6333f1552835dcc399bed',
    'Upstream LiquidGlass bundle changed; review this narrow patch before applying it')
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace(`    this.cropCanvas.width = W;
    this.cropCanvas.height = H;
    this.cropCtx.clearRect(0, 0, W, H);
    this.cropCtx.drawImage(sourceCanvas, -sourceX, -sourceY);`,
`    let uploadCanvas = sourceCanvas;
    if (sourceX !== 0 || sourceY !== 0 || sourceCanvas.width !== W || sourceCanvas.height !== H) {
      if (this.cropCanvas.width !== W) this.cropCanvas.width = W;
      if (this.cropCanvas.height !== H) this.cropCanvas.height = H;
      this.cropCtx.clearRect(0, 0, W, H);
      this.cropCtx.drawImage(sourceCanvas, -sourceX, -sourceY);
      uploadCanvas = this.cropCanvas;
    }`)
  replace('gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cropCanvas);',
    'gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadCanvas);')
  replace(`    if (this._sceneCanvas.width !== width || this._sceneCanvas.height !== height) {
      this._sceneCanvas.width = width;
      this._sceneCanvas.height = height;
    } else {
      this._sceneCtx.clearRect(0, 0, width, height);
    }`,
`    this._sceneBuffers ??= new Map();
    const key = width + "x" + height;
    let buffer = this._sceneBuffers.get(key);
    if (!buffer) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      buffer = { canvas, ctx: canvas.getContext("2d") };
      if (this._sceneBuffers.size >= 12) this._sceneBuffers.delete(this._sceneBuffers.keys().next().value);
      this._sceneBuffers.set(key, buffer);
    }
    this._sceneCanvas = buffer.canvas;
    this._sceneCtx = buffer.ctx;
    this._sceneCtx.clearRect(0, 0, width, height);`)
  replace('    this.capture.destroy();', '    this._sceneBuffers?.clear();\n    this.capture.destroy();')
  source = source.replace('//# sourceMappingURL=index.js.map', '// Original source map omitted: bundle has the documented local buffer patch.')
  await writeFile(file, marker + '\n' + source)
  console.log('Applied LiquidGlass 1.0.3 native buffer patch')
}

// With an already-blurred input, the two identity FBO blits add no information.
// Bind the same uploaded texture to both shader samplers in this exact case.
source = await readFile(file, 'utf8')
const fastMarker = '// photo-gallery: zero-blur identity fast path v1'
if (!source.includes(fastMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Fast-path patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace('    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);\n    gl.bindFramebuffer(gl.FRAMEBUFFER, fboSet.bg.fbo);',
    '    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);\n    this._zeroBlur = blurAmount === 0;\n    if (this._zeroBlur) return;\n    gl.bindFramebuffer(gl.FRAMEBUFFER, fboSet.bg.fbo);')
  replace('    gl.activeTexture(gl.TEXTURE0);\n    gl.bindTexture(gl.TEXTURE_2D, fboSet.bg.tex);',
    '    gl.activeTexture(gl.TEXTURE0);\n    gl.bindTexture(gl.TEXTURE_2D, this._zeroBlur ? this.bgTex : fboSet.bg.tex);')
  replace('    gl.activeTexture(gl.TEXTURE1);\n    gl.bindTexture(gl.TEXTURE_2D, fboSet.blurA.tex);',
    '    gl.activeTexture(gl.TEXTURE1);\n    gl.bindTexture(gl.TEXTURE_2D, this._zeroBlur ? this.bgTex : fboSet.blurA.tex);')
  source = source.replace(marker, marker + '\n' + fastMarker)
  await writeFile(file, source)
  console.log('Applied exact zero-blur identity fast path')
}

// The panel is drawn once onto a cleared buffer. SRC_ALPHA blending here
// premultiplies its colour and squares its alpha, although this context declares
// premultipliedAlpha:false. Canvas copies then produce a dark hairline. Keep the
// shader's straight RGBA so its existing SDF mask gives a clean, soft edge.
source = await readFile(file, 'utf8')
const alphaMarker = '// photo-gallery: preserve straight-alpha panel edges v1'
if (!source.includes(alphaMarker)) {
  const before = '    gl.enable(gl.BLEND);\n    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);'
  assert.equal(source.split(before).length, 2, 'Panel blend target must match exactly once')
  source = source.replace(before, '    gl.disable(gl.BLEND);')
  source = source.replace(marker, marker + '\n' + alphaMarker)
  await writeFile(file, source)
  console.log('Fixed straight-alpha panel edges')
}

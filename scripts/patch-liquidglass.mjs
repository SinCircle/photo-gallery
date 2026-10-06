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

// Content snapshots are used only by _drawPriorGlassToScene: a later glass
// refracting an earlier glass's DOM labels. A single panel has no such consumer.
// Avoid serialising fonts, masks and text to SVG on every morph size change.
// Keep the upstream capture path intact for instances with multiple panels.
source = await readFile(file, 'utf8')
const singleMarker = '// photo-gallery: skip unused single-panel content capture v1'
if (!source.includes(singleMarker)) {
  const before = '  async _captureGlassContent(targets = null) {\n    if (this._capturingGlassContent) return;'
  assert.equal(source.split(before).length, 2, 'Single-panel capture target must match exactly once')
  source = source.replace(before,
    '  async _captureGlassContent(targets = null) {\n    if (this.glassSet.size <= 1) return;\n    if (this._capturingGlassContent) return;')
  source = source.replace(marker, marker + '\n' + singleMarker)
  await writeFile(file, source)
  console.log('Skipped unused single-panel DOM snapshots')
}

// Opt-in scheduling for application-owned scene canvases. Every public and
// internal dirty path wakes the renderer; static frames do not poll layout.
source = await readFile(file, 'utf8')
const demandMarker = '// photo-gallery: demand-driven scene scheduling v1'
if (!source.includes(demandMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Demand-render patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace('    this.root = root;\n    this.defaults =',
    '    this.root = root;\n    this._onDemand = root.hasAttribute("data-glass-on-demand");\n    this.defaults =')
  replace('    await this.capture.prefetchFontEmbedCSS();',
    '    if (this.glassSet.size > 1 || this._sortedChildren.some(el => !this.glassSet.has(el) && !["CANVAS", "IMG", "VIDEO"].includes(el.tagName))) await this.capture.prefetchFontEmbedCSS();')
  replace('      this._glassCache.clear();\n      this._globalDirty = true;',
    '      this._glassCache.clear();\n      this._globalDirty = true;\n      this._wake();')
  replace('      this._sortedChildren = this._getSortedChildren();\n      this._globalDirty = true;',
    '      this._sortedChildren = this._getSortedChildren();\n      this._globalDirty = true;\n      this._wake();')
  for (const signature of ['_markGlassAndDependents(element, rectOverride)', '_markGlassesIntersecting(element)', 'markChanged(element)', '_handleResize()']) {
    replace(`  ${signature} {`, `  ${signature} {\n    this._wake();`)
  }
  replace('    this._globalDirty = true;\n    this._rafId = requestAnimationFrame(() => this._renderLoop());',
    '    this._globalDirty = true;\n    this._wake();')
  replace('  _renderLoop() {\n    if (!this._running) return;',
    '  _wake() {\n    if (!this._running || this._rafId || this._inFrame) return;\n    this._rafId = requestAnimationFrame(() => this._renderLoop());\n  }\n  _renderLoop() {\n    this._rafId = 0;\n    if (!this._running) return;\n    this._inFrame = true;')
  replace('    this._rafId = requestAnimationFrame(() => this._renderLoop());\n  }\n  _renderFrame()',
    '    this._inFrame = false;\n    if (!this._onDemand || this._hasDynamic || this._drag.active || this._globalDirty || this._userMarkedChanged.size || this._glassDirty.size || this._glassContentDirty.size) this._wake();\n  }\n  _renderFrame()')
  source = source.replace(marker, marker + '\n' + demandMarker)
  await writeFile(file, source)
  console.log('Enabled opt-in demand-driven glass rendering')
}

// The zero-blur path samples bgTex directly and never uses an FBO. Allocating
// three textures for every intermediate morph width wasted GPU memory/time.
source = await readFile(file, 'utf8')
const allocationMarker = '// photo-gallery: skip identity FBO allocation v1'
if (!source.includes(allocationMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Allocation patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace('    if (!this._setActiveSize(width, height)) return;', '    if (!this._setActiveSize(width, height, blurAmount === 0)) return;')
  replace('  _setActiveSize(w, h) {', '  _setActiveSize(w, h, identity = false) {')
  replace('    const key = `${w}x${h}`;\n    let fboSet', '    if (identity) { this.activeFBOs = null; return true; }\n    const key = `${w}x${h}`;\n    let fboSet')
  replace('      this.fboCache.set(key, fboSet);', '      if (this.fboCache.size >= 12) {\n        const oldest = this.fboCache.keys().next().value;\n        this._freeFBOSet(this.fboCache.get(oldest));\n        this.fboCache.delete(oldest);\n      }\n      this.fboCache.set(key, fboSet);')
  replace('    this._inFrame = true;\n    const now = performance.now();', '    const now = performance.now();\n    if (this._onDemand && now - (this._lastPaint ?? -Infinity) < 1000 / 60 - .5) { this._wake(); return; }\n    this._lastPaint = now;\n    this._inFrame = true;')
  source = source.replace(marker, marker + '\n' + allocationMarker)
  await writeFile(file, source)
  console.log('Removed unused FBOs and bounded demand rendering to 60Hz')
}

// A single centered capsule can reuse the root's fixed-size shader surface
// throughout its width/height morph. Its actual SDF size remains unchanged;
// only the transparent canvas margins grow, with matching sample coordinates.
source = await readFile(file, 'utf8')
const stableMarker = '// photo-gallery: stable capsule render bounds v1'
if (!source.includes(stableMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Stable-bounds patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace('    const padW = SHADOW_PAD * 2;\n    const padH = SHADOW_PAD * 2;',
    '    const stable = this.glassSet.size === 1 && this.root.hasAttribute("data-glass-stable-bounds");\n    const surfaceW = stable ? Math.max(elW, this.root.clientWidth) : elW;\n    const surfaceH = stable ? Math.max(elH, this.root.clientHeight) : elH;\n    const padW = SHADOW_PAD * 2 + surfaceW - elW;\n    const padH = SHADOW_PAD * 2 + surfaceH - elH;')
  replace('    canvas.width = Math.round((elW + padW) * dpr);\n    canvas.height = Math.round((elH + padH) * dpr);',
    '    const width = Math.round((elW + padW) * dpr), height = Math.round((elH + padH) * dpr);\n    if (canvas.width !== width) canvas.width = width;\n    if (canvas.height !== height) canvas.height = height;')
  replace('      `left:${-SHADOW_PAD}px`,\n      `top:${-SHADOW_PAD}px`,',
    '      `left:${-padW / 2}px`,\n      `top:${-padH / 2}px`,')
  replace('    const sampleRect = this._getPixelRect(elRect, rootRect, dpr, SHADOW_PAD);',
    '    let sampleRect = this._getPixelRect(elRect, rootRect, dpr, SHADOW_PAD);\n    if (this.glassSet.size === 1 && this.root.hasAttribute("data-glass-stable-bounds") && glassCanvas) {\n      sampleRect = { x: Math.round(centerX * dpr - glassCanvas.width / 2), y: Math.round(centerY * dpr - glassCanvas.height / 2), w: glassCanvas.width, h: glassCanvas.height };\n    }')
  source = source.replace(marker, marker + '\n' + stableMarker)
  await writeFile(file, source)
  console.log('Reused fixed-size capsule render surfaces')
}

source = await readFile(file, 'utf8')
const placementMarker = '// photo-gallery: stable canvas placement v1'
if (!source.includes(placementMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Placement patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace('    canvas.style.cssText = [\n      "position:absolute",', '    const canvasStyle = [\n      "position:absolute",')
  replace('      `left:${-padW / 2}px`,\n      `top:${-padH / 2}px`,',
    '      `left:${stable ? "50%" : -padW / 2 + "px"}`,\n      `top:${stable ? "50%" : -padH / 2 + "px"}`,\n      `transform:${stable ? "translate(-50%,-50%)" : "none"}`,')
  replace('    this._glassLastSize.set(el, { w: elW, h: elH });',
    '    if (canvas.dataset.glassPlacement !== canvasStyle) { canvas.style.cssText = canvasStyle; canvas.dataset.glassPlacement = canvasStyle; }\n    this._glassLastSize.set(el, { w: elW, h: elH });')
  source = source.replace(marker, marker + '\n' + placementMarker)
  await writeFile(file, source)
  console.log('Avoided per-frame canvas style invalidation')
}

// Reserve the wide surface only while morphing. A settled 56px pill should
// refract a 56px region when the photo moves, not shade the full toolbar slot.
source = await readFile(file, 'utf8')
const compactMarker = '// photo-gallery: compact settled capsule surfaces v1'
if (!source.includes(compactMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Compact-surface target must match exactly once')
    source = source.replace(before, after)
  }
  replace('    const stable = this.glassSet.size === 1 && this.root.hasAttribute("data-glass-stable-bounds");',
    '    const stable = this._usesStableBounds();')
  replace('    this._glassLastSize.set(el, { w: elW, h: elH });',
    '    this._glassLastSize.set(el, { w: elW, h: elH, stable });')
  replace('  _checkGlassSizeChanges() {',
    '  _usesStableBounds() { return this.glassSet.size === 1 && this.root.hasAttribute("data-glass-stable-bounds") && this.root.hasAttribute("data-moving"); }\n  _checkGlassSizeChanges() {')
  replace('      if (!last || Math.abs(last.w - w) > 0.5 || Math.abs(last.h - h) > 0.5) {',
    '      if (!last || last.stable !== this._usesStableBounds() || Math.abs(last.w - w) > 0.5 || Math.abs(last.h - h) > 0.5) {')
  replace('    if (this.glassSet.size === 1 && this.root.hasAttribute("data-glass-stable-bounds") && glassCanvas) {',
    '    if (this._usesStableBounds() && glassCanvas) {')
  source = source.replace(marker, marker + '\n' + compactMarker)
  await writeFile(file, source)
  console.log('Restored compact surfaces after capsule motion')
}

// Warm the full motion envelope before the first visible glass frame. The
// spring may briefly exceed BOTH resting dimensions; sizing to the resting
// slot alone allocated fresh FBOs during that first overshoot on mobile.
source = await readFile(file, 'utf8')
const envelopeMarker = '// photo-gallery: prewarmed spring envelope v1'
if (!source.includes(envelopeMarker)) {
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Spring-envelope patch target must match exactly once')
    source = source.replace(before, after)
  }
  replace('const surfaceW = stable ? Math.max(elW, this.root.clientWidth) : elW;',
    'const surfaceW = stable ? Math.max(elW, Math.ceil(this.root.clientWidth * 1.07)) : elW;')
  replace('const surfaceH = stable ? Math.max(elH, this.root.clientHeight) : elH;',
    'const surfaceH = stable ? Math.max(elH, this.root.clientHeight + 6) : elH;')
  replace('&& this.root.hasAttribute("data-moving"); }',
    '&& (this.root.hasAttribute("data-moving") || this.root.hasAttribute("data-glass-pending") || this.root.hasAttribute("data-glass-appearing")); }')
  source = source.replace(marker, marker + '\n' + envelopeMarker)
  await writeFile(file, source)
  console.log('Prewarmed stable buffers for the entire spring envelope')
}

// Consumers reveal the surface only after a real output copy. A next-rAF
// guess can run before the native renderer and expose an empty white capsule.
source = await readFile(file, 'utf8')
const paintMarker = '// photo-gallery: painted surface notification v1'
if (!source.includes(paintMarker)) {
  const before = '      renderedThisFrame.push({ rect: sampleRect });'
  assert.equal(source.split(before).length, 2, 'Paint notification target must match exactly once')
  source = source.replace(before, before + '\n      this.root.dispatchEvent(new Event("glasspaint", { bubbles: true }));')
  source = source.replace(marker, marker + '\n' + paintMarker)
  await writeFile(file, source)
  console.log('Notify after native glass output is painted')
}

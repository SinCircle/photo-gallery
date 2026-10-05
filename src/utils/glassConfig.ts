// Material blur in CSS pixels. This is the single visual tuning control.
export const GLASS_BLUR_PX = 2

// LiquidGlass 1.0.3: six 9-tap passes per axis, kernel variance 2.854048,
// sampling spread = blurAmount * 2.5. Sigma is therefore about 10.35 * amount
// in device pixels; use the DPR to preserve the same visual CSS-pixel blur.
export function regularGlassConfig() {
  return JSON.stringify({
    floating: false,
    cornerRadius: 40,
    blurAmount: Math.min(1, GLASS_BLUR_PX * (devicePixelRatio || 1) / 10.35),
    edgeHighlight: 0,
    fresnel: 0,
    specular: 0,
  })
}

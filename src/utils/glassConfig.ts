// Blur lives in the material itself; the scene is no longer pre-blurred, so the
// CSS fallback carries its own blur independently of this value.
export const GLASS_BLUR_PX = 0

// Regular Glass, using the reference preset from the liquid-glass demo site.
// The only change is blurAmount (0.25 -> 0.15). The CSS hairline border is gone;
// the material's own rim highlight and grazing reflection stay.
export function regularGlassConfig() {
  return JSON.stringify({
    floating: false,
    blurAmount: 0.15,
    refraction: 0.95,
    chromAberration: 0.055,
    edgeHighlight: 0.3,
    specular: 0,
    fresnel: 1,
    distortion: 0,
    cornerRadius: 40,
    zRadius: 40,
    opacity: 1,
    saturation: 0,
    brightness: 0,
    shadowOpacity: 0.3,
    shadowSpread: 10,
    bevelMode: 0,
  })
}

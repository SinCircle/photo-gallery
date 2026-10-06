// Blur lives in the material itself; the scene is no longer pre-blurred, so the
// CSS fallback carries its own blur independently of this value.
export const GLASS_BLUR_PX = 0

// Regular Glass, using the reference preset from the liquid-glass demo site.
// The only change is blurAmount (0.25 -> 0.15). The CSS hairline border is gone;
// the material's own rim highlight and grazing reflection stay.
export function regularGlassConfig(zRadius = 18) {
  return JSON.stringify({
    floating: false,
    blurAmount: 0.15,
    refraction: 0.95,
    chromAberration: 0.055,
    edgeHighlight: 0.3,
    specular: 0,
    fresnel: 1,
    distortion: 0,
    // The bar is 44px tall, so the corner radius is the pill's own half-height
    // and the bevel is scaled to match; the demo's 40px pair sits on a much
    // taller component and put the bevel crest across the middle of this bar.
    cornerRadius: 22,
    zRadius,
    opacity: 1,
    // The refracted photo carries its own colour cast, which reads as grubby
    // against the page; desaturate it and lift it so the bar stays clean.
    saturation: -0.4,
    brightness: 0.12,
    shadowOpacity: 0.3,
    shadowSpread: 10,
    bevelMode: 0,
  })
}

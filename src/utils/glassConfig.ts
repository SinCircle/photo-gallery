// Material blur in CSS pixels. This is the single visual tuning control.
export const GLASS_BLUR_PX = 2

// Regular Glass, minus the CSS hairline border: the rim lighting and the
// grazing-angle reflection are the material's own highlights and stay on.
// Native amount 2/10.35 ≈ .193 corresponds to about 2px at DPR=1, but its
// six H/V iterations repeat for every capsule. Gaussian-blur the shared live
// source once instead; native panels still own all refraction and composition.
export function regularGlassConfig() {
  return JSON.stringify({
    floating: false,
    cornerRadius: 40,
    blurAmount: 0,
    edgeHighlight: 0.05,
    chromAberration: 0.05,
    fresnel: 1,
    specular: 0,
    shadowOpacity: 0.3,
    // Lifts the refracted pixels under the bar so dark photos still leave the
    // labels readable without a plate behind the text.
    brightness: 0.34,
  })
}

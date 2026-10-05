// Material blur in CSS pixels. This is the single visual tuning control.
export const GLASS_BLUR_PX = 2

// Native amount 2/10.35 ≈ .193 corresponds to about 2px at DPR=1, but its
// six H/V iterations repeat for every capsule. Gaussian-blur the shared live
// source once instead; native panels still own all refraction and composition.
export function regularGlassConfig() {
  return JSON.stringify({
    floating: false,
    cornerRadius: 40,
    blurAmount: 0,
    edgeHighlight: 0,
    fresnel: 0,
    specular: 0,
    shadowOpacity: 0,
  })
}

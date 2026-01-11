export const CONFIG = {
  // Preview: white frame around the photo (CSS value).
  // You can tweak this later to make the border thicker.
  previewFrameCss: 'clamp(14px, 2.2vw, 26px)',

  // Download (bordered version): border thickness in image pixels.
  // Keep it larger than preview for a “matte” feel.
  downloadBorderPx: 96,

  // Used by both the bottom dock metadata (CSS) and the downloaded border stamp (canvas).
  stampFontFamilyCss: 'Cinzel Decorative, Cormorant SC, serif',
  stampFontFamilyCanvas: '"Cinzel Decorative", "Cormorant SC", serif',
} as const

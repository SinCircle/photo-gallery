// Gallery thumbnail loading - ONLY loads pre-generated thumbnails
// This module is specifically for the gallery view and NEVER loads original images

const mem = new Map<string, string>()

// Transparent 1x1 pixel fallback
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

/**
 * Load ONLY the pre-generated thumbnail for gallery display.
 * This function is designed to NEVER load original images.
 * 
 * @param thumbUrl - The pre-generated thumbnail URL (from manifest)
 * @returns Object URL for the thumbnail, or transparent pixel if unavailable
 */
export async function loadThumbnailOnly(thumbUrl: string): Promise<string> {
  // Check memory cache first
  const cached = mem.get(thumbUrl)
  if (cached) return cached

  try {
    const res = await fetch(thumbUrl, { cache: 'force-cache' })
    if (!res.ok) {
      console.warn(`[Gallery] Thumbnail not found: ${thumbUrl}`)
      return TRANSPARENT_PIXEL
    }
    
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    mem.set(thumbUrl, objUrl)
    return objUrl
  } catch (err) {
    console.warn(`[Gallery] Failed to load thumbnail: ${thumbUrl}`, err)
    return TRANSPARENT_PIXEL
  }
}

/**
 * Legacy function for photo detail view that generates thumbnails from originals.
 * DO NOT USE THIS IN GALLERY VIEW.
 */
export async function getThumbnailObjectUrl(originalUrl: string, pregenThumbUrl?: string): Promise<string> {
  // If we have a pre-generated thumbnail, use the new function
  if (pregenThumbUrl) {
    return loadThumbnailOnly(pregenThumbUrl)
  }
  
  // For photo detail view without pre-generated thumbnail, load the original
  // (This should only happen in the detail view, never in gallery)
  console.warn('[Photo Detail] Loading original image:', originalUrl)
  return originalUrl
}

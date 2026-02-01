/**
 * Thumbnail utility - loads ONLY pre-generated thumbnails, never original images
 */

const mem = new Map<string, string>()

/**
 * Get thumbnail URL. This function ONLY loads pre-generated thumbnails.
 * It will NOT fallback to loading original images.
 * 
 * @param thumbUrl - Pre-generated thumbnail URL (required)
 * @returns Object URL of the thumbnail blob
 * @throws Error if thumbnail cannot be loaded
 */
export async function getThumbnailUrl(thumbUrl: string): Promise<string> {
  // Check memory cache first
  const cached = mem.get(thumbUrl)
  if (cached) return cached

  try {
    // Fetch the pre-generated thumbnail
    const res = await fetch(thumbUrl, { cache: 'force-cache' })
    if (!res.ok) {
      throw new Error(`Failed to load thumbnail: ${res.status} ${res.statusText}`)
    }
    
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    
    // Cache the object URL
    mem.set(thumbUrl, objectUrl)
    
    return objectUrl
  } catch (err) {
    console.error('[thumbs] Failed to load thumbnail:', thumbUrl, err)
    throw err
  }
}

/**
 * Clear memory cache (useful for cleanup)
 */
export function clearThumbnailCache(): void {
  for (const url of mem.values()) {
    URL.revokeObjectURL(url)
  }
  mem.clear()
}

/**
 * Legacy function for photo view - loads any image URL (including originals)
 * This is kept for compatibility with photo.ts which needs to load full-res images
 * 
 * @deprecated Use getThumbnailUrl for gallery view
 */
export async function getThumbnailObjectUrl(url: string, thumbUrl?: string): Promise<string> {
  // Photo view can load any image including originals
  const targetUrl = thumbUrl || url
  return getThumbnailUrl(targetUrl)
}
